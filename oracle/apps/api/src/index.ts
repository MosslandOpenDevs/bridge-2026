import "dotenv/config";
import express, { Express } from "express";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

// Import database
import {
  signalDb,
  issueDb,
  proposalDb,
  decisionHistoryDb,
  issueFollowupDb,
  serializeSignal,
  deserializeSignal,
  serializeIssue,
  deserializeIssue,
} from "./db.js";

// Import learning service
import {
  enrichContextWithHistory,
  recordDecision,
  recordOutcome,
  recordOutcomeByIssueId,
  getAgentTrustScores,
} from "./learning.js";

// Import blockchain service
import {
  blockchainService,
  parseVoteChoice,
  VoteChoice,
} from "./blockchain.js";

// Import security utilities
import {
  verifyVoteSignature,
  isVoteSignatureRequired,
  requireAdminKey,
  isAdminAuthEnabled,
  sanitizeError,
  canonicalJson,
} from "./security.js";

// Import ORACLE modules
import {
  SignalRegistry,
  MockAdapter,
  EtherscanAdapter,
  MosslandAdapter,
  GitHubAdapter,
  SocialAdapter,
} from "@oracle/reality-oracle";
import {
  AnomalyDetector,
  ThresholdDetector,
  TrendDetector,
  ProposalGenerator,
} from "@oracle/inference-mining";
import {
  RiskAgent,
  TreasuryAgent,
  CommunityAgent,
  ProductAgent,
  Moderator,
} from "@oracle/agentic-consensus";
import { VotingSystem, DelegationManager } from "@oracle/human-governance";
import { OutcomeTrackerImpl, TrustManager } from "@oracle/proof-of-outcome";

// Initialize services
const signalRegistry = new SignalRegistry();

// Register adapters based on available API keys
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY;
const TWITTER_BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const MOSSLAND_API_URL = process.env.MOSSLAND_API_URL || "https://disclosure.moss.land";

// Language setting from environment (default: en)
const SIGNAL_LANGUAGE = (process.env.SIGNAL_LANGUAGE || "en") as "en" | "ko";
console.log(`🌐 Signal language: ${SIGNAL_LANGUAGE}`);

// Always register MockAdapter for demo fallback
const mockAdapter = new MockAdapter({ signalCount: 3, language: SIGNAL_LANGUAGE });
signalRegistry.registerAdapter(mockAdapter);

// Register real data adapters if API keys are available
if (ETHERSCAN_API_KEY) {
  const etherscanAdapter = new EtherscanAdapter({
    apiKey: ETHERSCAN_API_KEY,
    minTransferAmount: 50000, // 50K MOC minimum for alerts
    language: SIGNAL_LANGUAGE,
  });
  signalRegistry.registerAdapter(etherscanAdapter);
  console.log("✅ EtherscanAdapter registered");
}

// MosslandAdapter doesn't require API key
const mosslandAdapter = new MosslandAdapter({
  apiUrl: MOSSLAND_API_URL,
  language: SIGNAL_LANGUAGE,
});
signalRegistry.registerAdapter(mosslandAdapter);
console.log("✅ MosslandAdapter registered");

// GitHubAdapter works without token but with rate limits
const githubAdapter = new GitHubAdapter({
  token: GITHUB_TOKEN,
  organization: "mossland",
  language: SIGNAL_LANGUAGE,
});
signalRegistry.registerAdapter(githubAdapter);
console.log("✅ GitHubAdapter registered");

// SocialAdapter for Medium (always) and Twitter (if token available and not disabled)
const TWITTER_DISABLED = process.env.DISABLE_TWITTER === "1";
const effectiveTwitterToken = TWITTER_DISABLED ? undefined : TWITTER_BEARER_TOKEN;
const socialAdapter = new SocialAdapter({
  mediumRssUrl: "https://medium.com/feed/mossland-blog",
  twitterBearerToken: effectiveTwitterToken,
  twitterUsername: "TheMossland",
  language: SIGNAL_LANGUAGE,
});
signalRegistry.registerAdapter(socialAdapter);
const twitterStatus = TWITTER_DISABLED
  ? " (Twitter disabled via DISABLE_TWITTER=1)"
  : effectiveTwitterToken
    ? " (with Twitter)"
    : " (Medium only)";
console.log("✅ SocialAdapter registered" + twitterStatus);

const anomalyDetector = new AnomalyDetector({ minSamples: 3 });
const thresholdDetector = new ThresholdDetector({
  rules: [
    // Price alerts - more likely to trigger
    {
      category: "moc_price",
      operator: "gt",
      value: 45,
      priority: "medium",
      message: "MOC price above 45 KRW - monitor closely",
      suggestedActions: ["Monitor market conditions", "Check for unusual trading activity"],
    },
    {
      category: "moc_price",
      operator: "lt",
      value: 55,
      priority: "low",
      message: "MOC price under 55 KRW",
      suggestedActions: ["Monitor price stability", "Review market sentiment"],
    },
    // Token transfer alerts
    {
      category: "moc_transfer",
      operator: "gt",
      value: 100000,
      priority: "high",
      message: "Large MOC transfer detected (>100K)",
      suggestedActions: ["Verify transfer legitimacy", "Check for whale activity"],
    },
    // Gas price alerts
    {
      category: "network_gas",
      operator: "gt",
      value: 30,
      priority: "medium",
      message: "Elevated gas prices detected",
      suggestedActions: ["Consider transaction timing", "Monitor network congestion"],
    },
    // Mock data thresholds - more likely to trigger
    {
      category: "governance_participation",
      operator: "gt",
      value: 30,
      priority: "medium",
      message: "Governance participation increase detected",
      suggestedActions: ["Review active proposals", "Ensure voting system is handling load"],
    },
    {
      category: "token_price",
      operator: "gt",
      value: 50,
      priority: "high",
      message: "Significant token price movement",
      suggestedActions: ["Monitor market conditions", "Review trading volumes"],
    },
    {
      category: "treasury_balance",
      operator: "gt",
      value: 30,
      priority: "medium",
      message: "Treasury activity detected",
      suggestedActions: ["Review recent transactions", "Verify fund allocation"],
    },
    // Medium/Social alerts
    {
      category: "medium_activity",
      operator: "lte",
      value: 2,
      priority: "low",
      message: "Low blog activity this week",
      suggestedActions: ["Consider publishing new content", "Review content strategy"],
    },
  ],
});
const trendDetector = new TrendDetector();
const proposalGenerator = new ProposalGenerator();

// LLM Configuration from environment
const LLM_API_KEY = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;
const LLM_PROVIDER = process.env.LLM_PROVIDER as "anthropic" | "openai" | "ollama" | undefined;
const LLM_MODEL = process.env.LLM_MODEL;
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL;
const OLLAMA_MODEL = process.env.OLLAMA_MODEL;

// Prefer Ollama when OLLAMA_BASE_URL is set, otherwise fall back to Anthropic/OpenAI
const llmConfig = OLLAMA_BASE_URL
  ? {
      provider: "ollama" as const,
      baseURL: OLLAMA_BASE_URL,
      model: OLLAMA_MODEL || LLM_MODEL,
    }
  : LLM_API_KEY
    ? {
        apiKey: LLM_API_KEY,
        provider: LLM_PROVIDER,
        model: LLM_MODEL,
      }
    : {};

// Initialize agents with LLM config
const riskAgent = new RiskAgent(llmConfig);
const treasuryAgent = new TreasuryAgent(llmConfig);
const communityAgent = new CommunityAgent(llmConfig);
const productAgent = new ProductAgent(llmConfig);
const moderator = new Moderator(llmConfig);

// Log LLM status
if (LLM_API_KEY) {
  console.log(`🤖 LLM enabled: ${moderator.llmProvider} (${moderator.llmModel})`);
} else {
  console.log("⚠️  LLM disabled: Set ANTHROPIC_API_KEY or OPENAI_API_KEY to enable");
}

moderator.registerAgent(riskAgent);
moderator.registerAgent(treasuryAgent);
moderator.registerAgent(communityAgent);
moderator.registerAgent(productAgent);

const votingSystem = new VotingSystem();
const delegationManager = new DelegationManager();
const outcomeTracker = new OutcomeTrackerImpl();
const trustManager = new TrustManager();

// Create Express app with Socket.IO
const app: Express = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: [
      "http://localhost:3100",
      "http://localhost:4001",
      "http://localhost:3000",
      "https://bridge.moss.land",
    ],
    methods: ["GET", "POST"],
    credentials: true,
  },
});

app.use(helmet());
app.use(cors({
  origin: [
    "http://localhost:3100",
    "http://localhost:4001",
    "http://localhost:3000",
    "https://bridge.moss.land",
  ],
  credentials: true,
}));
app.use(express.json({ limit: "100kb" }));

// Trust the first proxy hop so rate limiting sees the real client IP behind nginx.
app.set("trust proxy", 1);

// Rate limit caps are env-tunable so tests / load benchmarks can relax them.
const RATE_LIMIT_GLOBAL = parseInt(process.env.RATE_LIMIT_GLOBAL || "120", 10);
const RATE_LIMIT_LLM = parseInt(process.env.RATE_LIMIT_LLM || "6", 10);
const RATE_LIMIT_VOTE = parseInt(process.env.RATE_LIMIT_VOTE || "20", 10);

// Upper bound for client-supplied voting weight in non-MOC (demo) mode.
// Defaults to MOC total supply (500M * 1e18). Rejecting absurd/negative
// values prevents tally corruption; note demo mode is NOT sybil-resistant —
// enable MOC verification and REQUIRE_VOTE_SIGNATURE=always in production.
const MAX_VOTE_WEIGHT = BigInt(
  process.env.MAX_VOTE_WEIGHT || "500000000000000000000000000",
);

// Clamp a client-supplied list limit into a sane range so a caller can't ask
// for an unbounded / negative SQL LIMIT.
function clampLimit(raw: unknown, fallback: number, max = 500): number {
  const n = parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

// Global rate limiter — protects every endpoint from naive flooding.
app.use(
  "/api/",
  rateLimit({
    windowMs: 60 * 1000,
    max: RATE_LIMIT_GLOBAL,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests" },
  }),
);

// LLM endpoints are expensive — much stricter cap to protect API credits.
app.use(
  ["/api/deliberate", "/api/debate"],
  rateLimit({
    windowMs: 60 * 1000,
    max: RATE_LIMIT_LLM,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "LLM rate limit exceeded; please retry shortly" },
  }),
);

// Vote endpoint — bounded per minute to prevent vote spam.
app.use(
  "/api/proposals/:id/vote",
  rateLimit({
    windowMs: 60 * 1000,
    max: RATE_LIMIT_VOTE,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Voting rate limit exceeded" },
  }),
);

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);

  // Send current stats on connection
  const signalCount = signalDb.count.get() as { count: number };
  const issueCount = issueDb.count.get() as { count: number };
  const proposals = votingSystem.listProposals();

  socket.emit("stats:update", {
    signals: signalCount.count,
    issues: issueCount.count,
    proposals: proposals.length,
    activeProposals: proposals.filter(p => p.status === "active").length,
  });

  socket.on("disconnect", () => {
    console.log(`🔌 Client disconnected: ${socket.id}`);
  });
});

// JSON-only error handler — catches body-parser/payload errors so we never leak HTML stacks.
app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!err) {
    next();
    return;
  }
  const status = err.status || err.statusCode || 500;
  const message =
    status === 413
      ? "Request body too large"
      : status >= 500
        ? "Internal server error"
        : sanitizeError(err, "Request failed");
  res.status(status).json({ error: message });
});

// Health check
// Registered under /api as well, since nginx only proxies /api/* to this app
const healthHandler = (req: express.Request, res: express.Response) => {
  res.json({
    status: "ok",
    version: "0.1.0",
    timestamp: new Date().toISOString(),
  });
};
app.get("/health", healthHandler);
app.get("/api/health", healthHandler);

// Signal endpoints
app.get("/api/signals", async (req, res) => {
  try {
    const limit = clampLimit(req.query.limit, 100);
    const category = req.query.category as string;

    let rows;
    if (category) {
      rows = signalDb.getByCategory.all(category, limit);
    } else {
      rows = signalDb.getRecent.all(limit);
    }

    const signals = rows.map(deserializeSignal);
    res.json({ signals, count: signals.length });
  } catch (error) {
    console.error("Failed to fetch signals:", error);
    res.status(500).json({ error: "Failed to fetch signals" });
  }
});

app.post("/api/signals/collect", requireAdminKey, async (req, res) => {
  try {
    const signals = await signalRegistry.collectSignals();

    // Save to database
    for (const signal of signals) {
      signalDb.insert.run(serializeSignal(signal));
    }

    // Emit real-time event
    const signalCount = signalDb.count.get() as { count: number };
    io.emit("signals:collected", {
      count: signals.length,
      total: signalCount.count,
      signals: signals.slice(0, 5), // Send latest 5 for preview
    });

    res.json({ collected: signals.length, signals });
  } catch (error) {
    console.error("Failed to collect signals:", error);
    res.status(500).json({ error: "Failed to collect signals" });
  }
});

// Helper to populate signals for an issue
function populateIssueSignals(issue: any) {
  if (issue.signalIds && issue.signalIds.length > 0) {
    const signals = issue.signalIds
      .map((id: string) => {
        const row = signalDb.getById.get(id);
        return row ? deserializeSignal(row) : null;
      })
      .filter((s: any) => s !== null);
    return { ...issue, signals };
  }
  return { ...issue, signals: [] };
}

// Issue endpoints
app.get("/api/issues", async (req, res) => {
  try {
    const limit = clampLimit(req.query.limit, 50);
    const status = req.query.status as string;
    const includeSignals = req.query.includeSignals !== "false"; // Include signals by default

    let rows;
    if (status) {
      rows = issueDb.getByStatus.all(status, limit);
    } else {
      rows = issueDb.getActive.all(limit);
    }

    let issues = rows.map(deserializeIssue);

    // Populate signals if requested
    if (includeSignals) {
      issues = issues.map(populateIssueSignals);
    }

    res.json({ issues, count: issues.length });
  } catch (error) {
    console.error("Failed to fetch issues:", error);
    res.status(500).json({ error: "Failed to fetch issues" });
  }
});

app.post("/api/issues/detect", requireAdminKey, async (req, res) => {
  try {
    // Get signals from database
    const signalRows = signalDb.getRecent.all(1000);
    const signals = signalRows.map(deserializeSignal);

    // Detect issues
    const detectedIssues = [
      ...anomalyDetector.analyze(signals),
      ...thresholdDetector.analyze(signals),
      ...trendDetector.analyze(signals),
    ];

    // Save new issues to database (avoid duplicates)
    const savedIssues = [];
    for (const issue of detectedIssues) {
      // Check if similar issue already exists
      const existing = issueDb.findSimilar.get(issue.category);
      if (!existing) {
        issueDb.insert.run(serializeIssue(issue));
        savedIssues.push(issue);
      }
    }

    // Return all active issues
    const allIssues = issueDb.getActive.all(50).map(deserializeIssue);

    // Emit real-time event if new issues were saved
    if (savedIssues.length > 0) {
      io.emit("issues:detected", {
        newCount: savedIssues.length,
        totalCount: allIssues.length,
        issues: savedIssues,
      });
    }

    res.json({
      detected: detectedIssues.length,
      saved: savedIssues.length,
      issues: allIssues,
      count: allIssues.length,
    });
  } catch (error) {
    console.error("Failed to detect issues:", error);
    res.status(500).json({ error: "Failed to detect issues" });
  }
});

const VALID_ISSUE_STATUSES = ["detected", "deliberating", "proposed", "resolved"];

app.patch("/api/issues/:id", requireAdminKey, async (req, res) => {
  try {
    const { status, decisionPacket } = req.body;

    if (status !== undefined && !VALID_ISSUE_STATUSES.includes(String(status))) {
      return res.status(400).json({
        error: `status must be one of: ${VALID_ISSUE_STATUSES.join(", ")}`,
      });
    }

    const issue = issueDb.getById.get(req.params.id) as any;

    if (!issue) {
      return res.status(404).json({ error: "Issue not found" });
    }

    issueDb.update.run({
      id: req.params.id,
      status: status || issue.status,
      resolvedAt: status === "resolved" ? new Date().toISOString() : null,
      decisionPacket: decisionPacket ? JSON.stringify(decisionPacket) : issue.decision_packet,
    });

    const updated = issueDb.getById.get(req.params.id);
    res.json({ issue: deserializeIssue(updated) });
  } catch (error) {
    console.error("Failed to update issue:", error);
    res.status(500).json({ error: "Failed to update issue" });
  }
});

// In-memory LRU for debate sessions — avoids unbounded growth on long-running servers.
const DEBATE_SESSION_LIMIT = parseInt(process.env.DEBATE_SESSION_LIMIT || "100", 10);
class LRUMap<K, V> extends Map<K, V> {
  constructor(private readonly max: number) {
    super();
  }
  override get(key: K): V | undefined {
    if (!super.has(key)) return undefined;
    const value = super.get(key)!;
    super.delete(key);
    super.set(key, value);
    return value;
  }
  override set(key: K, value: V): this {
    if (super.has(key)) super.delete(key);
    else if (this.size >= this.max) {
      const oldest = this.keys().next().value;
      if (oldest !== undefined) super.delete(oldest);
    }
    super.set(key, value);
    return this;
  }
}
const debateSessions = new LRUMap<string, any>(DEBATE_SESSION_LIMIT);

// Deliberation endpoints
app.post("/api/deliberate", async (req, res) => {
  try {
    const { issue, context } = req.body;
    if (!issue) {
      return res.status(400).json({ error: "Issue is required" });
    }

    // Enrich context with historical data for agent learning
    const enrichedContext = enrichContextWithHistory(
      issue.category || "general",
      issue.priority || "medium",
      context || {}
    );

    const decisionPacket = await moderator.deliberate(issue, enrichedContext);

    // Record decision for learning
    if (decisionPacket) {
      const agentOpinions = (decisionPacket.agentOpinions || []).map(
        (op: any) => ({
          role: op.role,
          stance: op.stance,
          confidence: op.confidence,
        })
      );

      recordDecision(
        issue.id || `issue-${Date.now()}`,
        issue.category || "general",
        issue.priority || "medium",
        decisionPacket.consensusScore || 0,
        (decisionPacket.recommendation as any)?.type || "investigation",
        agentOpinions
      );
    }

    res.json({ decisionPacket });
  } catch (error) {
    console.error("Failed to deliberate:", error);
    res.status(500).json({ error: "Failed to deliberate" });
  }
});

// Debate endpoints - multi-round agent discussion
app.post("/api/debate", async (req, res) => {
  try {
    const { issue, context, maxRounds = 3 } = req.body;
    if (!issue) {
      return res.status(400).json({ error: "Issue is required" });
    }

    // Enrich context with historical data for agent learning
    const enrichedContext = enrichContextWithHistory(
      issue.category || "general",
      issue.priority || "medium",
      context || {}
    );

    // Conduct the debate with real-time updates via WebSocket
    const debateSession = await moderator.conductDebate(
      issue,
      enrichedContext,
      maxRounds,
      (round, session) => {
        // Emit real-time updates for each round
        io.emit("debate:round_completed", {
          sessionId: session.id,
          round: {
            roundNumber: round.roundNumber,
            topic: round.topic,
            messages: round.messages,
            consensusShift: round.consensusShift,
            keyInsights: round.keyInsights,
            unresolvedPoints: round.unresolvedPoints,
          },
          currentRound: session.currentRound,
          maxRounds: session.maxRounds,
          positionChanges: session.positionChanges,
        });
      }
    );

    // Store the session
    debateSessions.set(debateSession.id, debateSession);

    // Also generate a decision packet from the debate
    const decisionPacket = moderator.getDecisionPacketFromDebate(debateSession);

    // Record decision for learning
    if (decisionPacket) {
      const agentOpinions = (decisionPacket.agentOpinions || []).map(
        (op: any) => ({
          role: op.role,
          stance: op.stance,
          confidence: op.confidence,
        })
      );

      recordDecision(
        issue.id || `issue-${Date.now()}`,
        issue.category || "general",
        issue.priority || "medium",
        decisionPacket.consensusScore || debateSession.finalConsensusScore || 0,
        (decisionPacket.recommendation as any)?.type || "investigation",
        agentOpinions
      );
    }

    // Emit completion event
    io.emit("debate:completed", {
      sessionId: debateSession.id,
      finalConsensusScore: debateSession.finalConsensusScore,
      positionChanges: debateSession.positionChanges.length,
      totalRounds: debateSession.rounds.length,
    });

    res.json({
      debateSession,
      decisionPacket,
    });
  } catch (error) {
    console.error("Failed to conduct debate:", error);
    res.status(500).json({ error: "Failed to conduct debate" });
  }
});

app.get("/api/debate/:sessionId", (req, res) => {
  try {
    const session = debateSessions.get(req.params.sessionId);
    if (!session) {
      return res.status(404).json({ error: "Debate session not found" });
    }
    res.json({ debateSession: session });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch debate session" });
  }
});

app.get("/api/debates", (req, res) => {
  try {
    const sessions = Array.from(debateSessions.values())
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .slice(0, 20); // Return last 20 sessions
    res.json({ debateSessions: sessions, count: sessions.length });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch debate sessions" });
  }
});

// Proposal endpoints
app.get("/api/proposals", (req, res) => {
  try {
    const status = req.query.status as string | undefined;
    const proposals = votingSystem.listProposals(status as any);
    res.json({ proposals, count: proposals.length });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch proposals" });
  }
});

app.post("/api/proposals", requireAdminKey, (req, res) => {
  try {
    const { decisionPacket, proposer, options } = req.body;
    if (!decisionPacket || !proposer) {
      return res.status(400).json({ error: "decisionPacket and proposer are required" });
    }
    const proposal = votingSystem.createProposal(decisionPacket, proposer, options);
    // Auto-activate the proposal for immediate voting
    votingSystem.activateProposal(proposal.id);
    const activatedProposal = votingSystem.getProposal(proposal.id);

    // Emit real-time event
    const allProposals = votingSystem.listProposals();
    io.emit("proposals:created", {
      proposal: activatedProposal,
      totalCount: allProposals.length,
      activeCount: allProposals.filter(p => p.status === "active").length,
    });

    res.status(201).json({ proposal: activatedProposal });
  } catch (error) {
    res.status(500).json({ error: "Failed to create proposal" });
  }
});

app.get("/api/proposals/:id", (req, res) => {
  try {
    const proposal = votingSystem.getProposal(req.params.id);
    if (!proposal) {
      return res.status(404).json({ error: "Proposal not found" });
    }
    res.json({ proposal });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch proposal" });
  }
});

app.post("/api/proposals/:id/vote", async (req, res) => {
  try {
    const { voter, choice, weight, reason, signature, nonce, timestamp } = req.body;
    if (!voter || !choice) {
      return res.status(400).json({ error: "voter and choice are required" });
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(voter)) {
      return res.status(400).json({ error: "voter must be a valid 0x address" });
    }
    if (!["for", "against", "abstain"].includes(String(choice).toLowerCase())) {
      return res.status(400).json({ error: "choice must be for, against, or abstain" });
    }

    // Verify the voter actually authorized this vote (anti-spoofing).
    // Required when MOC verification is enabled, configurable via REQUIRE_VOTE_SIGNATURE.
    const sigRequired = isVoteSignatureRequired(blockchainService.isMocEnabled());
    if (sigRequired) {
      const sig = await verifyVoteSignature({
        voter: voter as `0x${string}`,
        proposalId: req.params.id,
        choice: String(choice),
        signature: signature as `0x${string}` | undefined,
        nonce: nonce as string | undefined,
        timestamp: typeof timestamp === "number" ? timestamp : Number(timestamp),
      });
      if (!sig.ok) {
        return res.status(401).json({
          error: sig.reason || "Vote signature verification failed",
          code: "INVALID_SIGNATURE",
        });
      }
    }

    // Verify MOC holder eligibility and get voting weight
    let votingWeight: bigint;
    try {
      if (blockchainService.isMocEnabled()) {
        // Use actual MOC balance as voting weight
        votingWeight = await blockchainService.verifyVoterEligibility(voter as `0x${string}`);
        console.log(`✅ Voter ${voter} verified: ${Number(votingWeight) / 1e18} MOC`);
      } else {
        // Demo mode: MOC verification disabled, so weight is client-supplied.
        // Validate it is a positive integer within a sane bound so a caller
        // can't corrupt tallies with a negative value or dominate the
        // threshold with an absurd one. (Full sybil resistance requires MOC.)
        if (weight === undefined || weight === null || weight === "") {
          return res.status(400).json({ error: "weight is required when MOC verification is disabled" });
        }
        let parsedWeight: bigint;
        try {
          parsedWeight = BigInt(weight);
        } catch {
          return res.status(400).json({ error: "weight must be an integer" });
        }
        if (parsedWeight <= 0n) {
          return res.status(400).json({ error: "weight must be a positive integer" });
        }
        if (parsedWeight > MAX_VOTE_WEIGHT) {
          return res.status(400).json({ error: "weight exceeds the maximum allowed" });
        }
        votingWeight = parsedWeight;
      }
    } catch (verifyError: any) {
      return res.status(403).json({
        error: sanitizeError(verifyError, "Voter eligibility check failed"),
        code: "NOT_MOC_HOLDER",
      });
    }

    // Cast the vote with verified weight
    const vote = votingSystem.castVote(
      req.params.id,
      voter,
      choice,
      votingWeight,
      reason
    );

    // Try to record vote on-chain (non-blocking)
    let txHash: string | undefined;
    if (blockchainService.isEnabled()) {
      const proposal = votingSystem.getProposal(req.params.id);
      if (proposal?.onchainId) {
        const voteChoice = parseVoteChoice(choice);
        const txResult = await blockchainService.castVote(
          proposal.onchainId,
          voteChoice,
          votingWeight
        );
        if (txResult.success) {
          txHash = txResult.txHash;
        }
      }
    }

    // Emit real-time event
    const tally = votingSystem.tallyVotes(req.params.id);
    io.emit("proposals:voted", {
      proposalId: req.params.id,
      vote: {
        ...vote,
        weight: vote.weight.toString(),
      },
      tally: {
        forVotes: tally.forVotes.toString(),
        againstVotes: tally.againstVotes.toString(),
        abstainVotes: tally.abstainVotes.toString(),
        totalVotes: tally.totalVotes.toString(),
        participationRate: tally.participationRate,
      },
      txHash,
    });

    // Convert BigInt to string for JSON serialization
    res.status(201).json({
      vote: {
        ...vote,
        weight: vote.weight.toString(),
      },
      txHash,
      mocBalance: blockchainService.isMocEnabled()
        ? (Number(votingWeight) / 1e18).toFixed(2)
        : undefined,
    });
  } catch (error: any) {
    res.status(400).json({ error: sanitizeError(error, "Failed to cast vote") });
  }
});

app.post("/api/proposals/:id/tally", (req, res) => {
  try {
    const tally = votingSystem.tallyVotes(req.params.id);
    // Convert BigInt to string for JSON serialization
    const serializable = {
      ...tally,
      forVotes: tally.forVotes.toString(),
      againstVotes: tally.againstVotes.toString(),
      abstainVotes: tally.abstainVotes.toString(),
      totalVotes: tally.totalVotes.toString(),
    };
    res.json({ tally: serializable });
  } catch (error: any) {
    res.status(400).json({ error: sanitizeError(error, "Failed to tally votes") });
  }
});

app.post("/api/proposals/:id/finalize", requireAdminKey, (req, res) => {
  try {
    const proposal = votingSystem.finalizeProposal(req.params.id);
    res.json({ proposal });
  } catch (error: any) {
    res.status(400).json({ error: sanitizeError(error, "Failed to finalize proposal") });
  }
});

app.post("/api/proposals/:id/execute", requireAdminKey, async (req, res) => {
  try {
    const proposalId = req.params.id;
    const proposal = votingSystem.getProposal(proposalId);

    if (!proposal) {
      return res.status(404).json({ error: "Proposal not found" });
    }

    // Check if proposal has passed
    if (proposal.status !== "passed") {
      return res.status(400).json({
        error: `Proposal cannot be executed (status: ${proposal.status})`,
      });
    }

    // Execute the proposal
    const executedProposal = votingSystem.executeProposal(proposalId);

    // Extract actions from decision packet
    const dp = proposal.decisionPacket;
    const actions: Array<{
      type: string;
      target: string;
      data: Record<string, unknown>;
      status: "completed" | "pending" | "in_progress" | "failed" | "partial";
      error?: string;
    }> = [];

    if (dp?.recommendation?.action) {
      const actionDescription = typeof dp.recommendation.action === "string"
        ? dp.recommendation.action
        : (dp.recommendation.action as any)?.action || "Execute recommendation";

      actions.push({
        type: "governance",
        target: "proposal_execution",
        data: {
          description: actionDescription,
          rationale: dp.recommendation.rationale,
          expectedOutcome: dp.recommendation.expectedOutcome,
          executedAt: new Date().toISOString(),
        },
        status: "completed",
      });
    }

    // Record the execution as an outcome
    const execution = await outcomeTracker.recordExecution(proposalId, actions);

    // Generate proof and update trust scores
    const proof = await outcomeTracker.generateProof(execution.id);

    // Update trust score for the proposer
    trustManager.recordOutcome(proposal.proposer, "proposer", proof);

    // Update trust score for agents involved in deliberation
    if ((dp as any)?.agents) {
      for (const agentId of Object.keys((dp as any).agents)) {
        trustManager.recordOutcome(agentId, "agent", proof);
      }
    }

    // Record outcome for agent learning feedback loop
    // Find the decision by issue_id and update with outcome
    const issueId = dp?.issue?.id;
    if (issueId && proof) {
      try {
        const recorded = recordOutcomeByIssueId(
          issueId,
          proof.successRate,
          proof.kpiResults
        );
        if (recorded) {
          console.log(`📊 Recorded learning outcome for issue ${issueId}: ${(proof.successRate * 100).toFixed(0)}% success`);
        }
      } catch (err) {
        console.warn("Could not record learning outcome:", err);
      }
    }

    res.json({
      proposal: executedProposal,
      execution,
      proof,
      message: "Proposal executed successfully",
    });
  } catch (error: any) {
    res.status(400).json({ error: sanitizeError(error, "Failed to execute proposal") });
  }
});

// Outcome endpoints
app.get("/api/outcomes", async (req, res) => {
  try {
    const proofs = outcomeTracker.listProofs();
    const outcomes = proofs.map((proof) => {
      const proposal = votingSystem.getProposal(proof.proposalId);
      const dp = proposal?.decisionPacket;
      const rec = dp?.recommendation;
      const title = proposal?.decisionPacket?.issue?.title ||
        (typeof rec?.action === "string" ? rec.action : (rec?.action as any)?.action) ||
        `Proposal #${proof.proposalId.slice(0, 8)}`;

      return {
        id: proof.id,
        executionId: proof.executionId,
        proposalId: proof.proposalId,
        proposalTitle: title,
        status: "completed",
        overallSuccess: proof.overallSuccess,
        successRate: proof.successRate,
        kpis: proof.kpiResults.map((kpi) => ({
          name: kpi.kpiName,
          target: kpi.targetValue,
          actual: kpi.actualValue,
          unit: kpi.unit,
          success: kpi.success,
        })),
        proofHash: proof.proofHash,
        executedAt: proposal?.executedAt || proof.recordedAt,
        recordedAt: proof.recordedAt,
      };
    });

    res.json({ outcomes, count: outcomes.length });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch outcomes" });
  }
});

app.post("/api/outcomes", requireAdminKey, async (req, res) => {
  try {
    const { proposalId, actions } = req.body;
    if (!proposalId || !actions) {
      return res.status(400).json({ error: "proposalId and actions are required" });
    }
    if (!Array.isArray(actions)) {
      return res.status(400).json({ error: "actions must be an array" });
    }
    const execution = await outcomeTracker.recordExecution(proposalId, actions);
    res.status(201).json({ execution });
  } catch (error) {
    res.status(500).json({ error: "Failed to record outcome" });
  }
});

app.get("/api/outcomes/:executionId", async (req, res) => {
  try {
    const execution = outcomeTracker.getExecution(req.params.executionId);
    if (!execution) {
      return res.status(404).json({ error: "Execution not found" });
    }
    res.json({ execution });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch execution" });
  }
});

app.get("/api/outcomes/:executionId/proof", async (req, res) => {
  try {
    const proof = await outcomeTracker.generateProof(req.params.executionId);
    res.json({ proof });
  } catch (error: any) {
    res.status(400).json({ error: sanitizeError(error, "Failed to generate proof") });
  }
});

// Trust score endpoints
app.get("/api/trust/:entityId", (req, res) => {
  try {
    const score = trustManager.getScore(req.params.entityId);
    if (!score) {
      return res.status(404).json({ error: "Entity not found" });
    }
    res.json({ score });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch trust score" });
  }
});

app.get("/api/trust/leaderboard/:type", (req, res) => {
  try {
    const entityType = req.params.type as "agent" | "proposer" | "delegate";
    const limit = clampLimit(req.query.limit, 10, 100);
    const topPerformers = trustManager.getTopPerformers(entityType, limit);
    res.json({ leaderboard: topPerformers });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch leaderboard" });
  }
});

// Delegation endpoints
app.get("/api/delegations", (req, res) => {
  try {
    const delegator = req.query.delegator as string;
    if (delegator) {
      const policies = delegationManager.getPoliciesForDelegator(delegator);
      res.json({ policies, count: policies.length });
    } else {
      // Return empty for now since we don't have a list all method
      res.json({ policies: [], count: 0 });
    }
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch delegations" });
  }
});

app.post("/api/delegations", (req, res) => {
  try {
    const { delegator, delegate, conditions, expiresAt } = req.body;
    if (!delegator || !delegate) {
      return res.status(400).json({ error: "delegator and delegate are required" });
    }

    const policy = delegationManager.createPolicy(
      delegator,
      delegate,
      conditions || [],
      expiresAt ? new Date(expiresAt) : undefined
    );

    res.status(201).json({ policy });
  } catch (error) {
    res.status(500).json({ error: "Failed to create delegation" });
  }
});

// Check delegation for a specific proposal (must be before :id route)
app.get("/api/delegations/check/:proposalId", (req, res) => {
  try {
    const delegator = req.query.delegator as string;
    if (!delegator) {
      return res.status(400).json({ error: "delegator query parameter is required" });
    }

    const proposal = votingSystem.getProposal(req.params.proposalId);
    if (!proposal) {
      return res.status(404).json({ error: "Proposal not found" });
    }

    const delegation = delegationManager.shouldAutoDelegate(delegator, proposal);
    if (delegation) {
      res.json({
        shouldDelegate: true,
        delegate: delegation.delegate,
        policy: delegation.policy,
      });
    } else {
      res.json({ shouldDelegate: false });
    }
  } catch (error) {
    res.status(500).json({ error: "Failed to check delegation" });
  }
});

app.get("/api/delegations/:id", (req, res) => {
  try {
    const policy = delegationManager.getPolicy(req.params.id);
    if (!policy) {
      return res.status(404).json({ error: "Delegation not found" });
    }
    res.json({ policy });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch delegation" });
  }
});

app.delete("/api/delegations/:id", (req, res) => {
  try {
    const policy = delegationManager.getPolicy(req.params.id);
    if (!policy) {
      return res.status(404).json({ error: "Delegation not found" });
    }
    delegationManager.revokePolicy(req.params.id);
    res.json({ message: "Delegation revoked", policy: { ...policy, active: false } });
  } catch (error) {
    res.status(500).json({ error: "Failed to revoke delegation" });
  }
});

// System stats
app.get("/api/stats", (req, res) => {
  try {
    // Get signal stats from database
    const signalCount = signalDb.count.get() as { count: number };
    const categoryStats = signalDb.countByCategory.all() as { category: string; count: number }[];

    // Get issue stats from database
    const issueCount = issueDb.count.get() as { count: number };
    const issueStatusStats = issueDb.countByStatus.all() as { status: string; count: number }[];

    const proposals = votingSystem.listProposals();
    const proofs = outcomeTracker.listProofs();

    res.json({
      signals: {
        total: signalCount.count,
        byCategory: categoryStats,
        adapterCount: signalRegistry.listAdapters().length,
      },
      issues: {
        total: issueCount.count,
        byStatus: issueStatusStats,
      },
      proposals: {
        total: proposals.length,
        active: proposals.filter((p) => p.status === "active").length,
        passed: proposals.filter((p) => p.status === "passed").length,
        rejected: proposals.filter((p) => p.status === "rejected").length,
      },
      outcomes: {
        totalProofs: proofs.length,
        successRate:
          proofs.length > 0
            ? proofs.filter((p) => p.overallSuccess).length / proofs.length
            : 0,
      },
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// Blockchain status endpoint
app.get("/api/blockchain/status", async (req, res) => {
  try {
    const status = {
      enabled: blockchainService.isEnabled(),
      mocEnabled: blockchainService.isMocEnabled(),
      proposalCount: blockchainService.isEnabled()
        ? await blockchainService.getProposalCount()
        : 0,
    };
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: "Failed to get blockchain status" });
  }
});

// MOC balance check endpoint
app.get("/api/blockchain/moc/:address", async (req, res) => {
  try {
    const address = req.params.address as `0x${string}`;

    if (!blockchainService.isMocEnabled()) {
      return res.status(503).json({
        error: "MOC token service not enabled",
        code: "MOC_SERVICE_DISABLED",
      });
    }

    const balance = await blockchainService.getMocBalance(address);
    const formatted = (Number(balance) / 1e18).toFixed(2);
    const isHolder = balance > 0n;

    res.json({
      address,
      balance: balance.toString(),
      formatted,
      isHolder,
      canVote: isHolder,
    });
  } catch (error: any) {
    res.status(400).json({ error: sanitizeError(error, "Failed to get MOC balance") });
  }
});

// Verify voter eligibility endpoint
app.get("/api/blockchain/verify-voter/:address", async (req, res) => {
  try {
    const address = req.params.address as `0x${string}`;

    if (!blockchainService.isMocEnabled()) {
      return res.json({
        eligible: true,
        reason: "MOC verification disabled",
        weight: "0",
      });
    }

    const balance = await blockchainService.getMocBalance(address);
    const isHolder = balance > 0n;

    res.json({
      eligible: isHolder,
      reason: isHolder ? "MOC holder" : "Not a MOC holder",
      weight: balance.toString(),
      formatted: (Number(balance) / 1e18).toFixed(2),
    });
  } catch (error: any) {
    res.status(400).json({ error: sanitizeError(error, "Failed to verify voter") });
  }
});

// Background processing intervals (in seconds, 0 to disable)
const SIGNAL_COLLECT_INTERVAL = parseInt(process.env.SIGNAL_COLLECT_INTERVAL || "60", 10);
const ISSUE_DETECT_INTERVAL = parseInt(process.env.ISSUE_DETECT_INTERVAL || "300", 10); // 5 minutes
const AUTO_DELIBERATE_ENABLED = process.env.AUTO_DELIBERATE_ENABLED !== "0";
const AUTO_DELIBERATE_MIN_PRIORITY = (process.env.AUTO_DELIBERATE_MIN_PRIORITY || "high").toLowerCase();
const PRIORITY_RANK: Record<string, number> = { low: 1, medium: 2, high: 3, urgent: 4, critical: 4 };
const minPriorityRank = PRIORITY_RANK[AUTO_DELIBERATE_MIN_PRIORITY] ?? 3;

const OUTCOME_EVAL_ENABLED = process.env.OUTCOME_EVAL_ENABLED !== "0";
const OUTCOME_EVAL_INTERVAL = parseInt(process.env.OUTCOME_EVAL_INTERVAL || "1800", 10); // 30 min
const OUTCOME_EVAL_AGE_HOURS = parseInt(process.env.OUTCOME_EVAL_AGE_HOURS || "6", 10);
const OUTCOME_EVAL_BATCH = parseInt(process.env.OUTCOME_EVAL_BATCH || "20", 10);

const AUTO_PROPOSAL_ENABLED = process.env.AUTO_PROPOSAL_ENABLED !== "0";
const AUTO_PROPOSAL_THRESHOLD = parseFloat(process.env.AUTO_PROPOSAL_THRESHOLD || "0.7");
const AUTO_PROPOSAL_PROPOSER = process.env.AUTO_PROPOSAL_PROPOSER || "auto-system";

// Helper function for background signal collection
async function collectAndSaveSignals() {
  const signals = await signalRegistry.collectSignals();
  for (const signal of signals) {
    signalDb.insert.run(serializeSignal(signal));
  }

  // Emit real-time event
  if (signals.length > 0) {
    const signalCount = signalDb.count.get() as { count: number };
    io.emit("signals:collected", {
      count: signals.length,
      total: signalCount.count,
      signals: signals.slice(0, 5),
    });
  }

  return signals;
}

// Helper function for background issue detection
async function detectAndSaveIssues() {
  const signalRows = signalDb.getRecent.all(1000);
  const signals = signalRows.map(deserializeSignal);

  const detectedIssues = [
    ...anomalyDetector.analyze(signals),
    ...thresholdDetector.analyze(signals),
    ...trendDetector.analyze(signals),
  ];

  let savedCount = 0;
  const savedIssues = [];
  for (const issue of detectedIssues) {
    const existing = issueDb.findSimilar.get(issue.category);
    if (!existing) {
      issueDb.insert.run(serializeIssue(issue));
      savedIssues.push(issue);
      savedCount++;
    }
  }

  // Emit real-time event if new issues were saved
  if (savedCount > 0) {
    const issueCount = issueDb.count.get() as { count: number };
    io.emit("issues:detected", {
      newCount: savedCount,
      totalCount: issueCount.count,
      issues: savedIssues,
    });
  }

  // Auto-deliberate on newly saved high-priority issues
  let deliberatedCount = 0;
  let promotedCount = 0;
  if (AUTO_DELIBERATE_ENABLED && savedIssues.length > 0) {
    for (const issue of savedIssues) {
      const rank = PRIORITY_RANK[(issue.priority || "medium").toLowerCase()] ?? 0;
      if (rank < minPriorityRank) continue;
      try {
        const enrichedContext = enrichContextWithHistory(
          issue.category || "general",
          issue.priority || "medium",
          {}
        );
        const decisionPacket = await moderator.deliberate(issue, enrichedContext);
        if (decisionPacket) {
          const agentOpinions = (decisionPacket.agentOpinions || []).map(
            (op: any) => ({
              role: op.role,
              stance: op.stance,
              confidence: op.confidence,
            })
          );
          recordDecision(
            issue.id,
            issue.category || "general",
            issue.priority || "medium",
            decisionPacket.consensusScore || 0,
            (decisionPacket.recommendation as any)?.type || "investigation",
            agentOpinions
          );
          deliberatedCount++;
          io.emit("decisions:recorded", {
            issueId: issue.id,
            category: issue.category,
            consensusScore: decisionPacket.consensusScore,
          });

          // Promote to proposal if consensus is strong enough
          if (
            AUTO_PROPOSAL_ENABLED &&
            (decisionPacket.consensusScore || 0) >= AUTO_PROPOSAL_THRESHOLD &&
            !proposalDb.existsByIssueId.get(issue.id)
          ) {
            try {
              const proposal = votingSystem.createProposal(decisionPacket, AUTO_PROPOSAL_PROPOSER);
              votingSystem.activateProposal(proposal.id);
              const activated = votingSystem.getProposal(proposal.id);
              proposalDb.insert.run({
                id: proposal.id,
                title: issue.title || `Proposal for ${issue.category}`,
                description:
                  decisionPacket.recommendation?.action ||
                  decisionPacket.recommendation?.rationale ||
                  issue.description ||
                  "Auto-generated proposal",
                proposer: AUTO_PROPOSAL_PROPOSER,
                status: activated?.status || "active",
                votingStarts: (activated?.votingStartsAt ?? proposal.votingStartsAt).toISOString(),
                votingEnds: (activated?.votingEndsAt ?? proposal.votingEndsAt).toISOString(),
                issueId: issue.id,
                decisionPacket: JSON.stringify(decisionPacket),
              });
              promotedCount++;
              io.emit("proposals:created", {
                proposal: activated,
                source: "auto-promotion",
              });
            } catch (promoteError) {
              console.error(`[auto-promote] failed for issue ${issue.id}:`, promoteError);
            }
          }
        }
      } catch (error) {
        console.error(`[auto-deliberate] failed for issue ${issue.id}:`, error);
      }
    }
  }

  return {
    detected: detectedIssues.length,
    saved: savedCount,
    deliberated: deliberatedCount,
    promoted: promotedCount,
  };
}

// Evaluate pending decision outcomes by checking follow-up issue activity
async function evaluatePendingOutcomes() {
  const ageClause = `-${OUTCOME_EVAL_AGE_HOURS} hours`;
  const pending = decisionHistoryDb.getPendingOlderThan.all(ageClause, OUTCOME_EVAL_BATCH) as any[];

  let evaluated = 0;
  for (const decision of pending) {
    try {
      const followup = issueFollowupDb.countNewByCategorySince.get(
        decision.category,
        decision.created_at
      ) as { count: number };

      const newIssueCount = followup?.count ?? 0;
      // Heuristic: fewer follow-up high-priority issues in this category = better outcome
      let successRate: number;
      if (newIssueCount === 0) successRate = 0.85;
      else if (newIssueCount === 1) successRate = 0.55;
      else if (newIssueCount <= 3) successRate = 0.35;
      else successRate = 0.2;

      const kpiResults = [
        {
          metric: "followup_high_priority_issues",
          category: decision.category,
          window_hours: OUTCOME_EVAL_AGE_HOURS,
          value: newIssueCount,
        },
      ];

      recordOutcome(decision.id, successRate, kpiResults);
      evaluated++;
    } catch (error) {
      console.error(`[outcome-eval] failed for decision ${decision.id}:`, error);
    }
  }

  if (evaluated > 0) {
    io.emit("outcomes:evaluated", { count: evaluated });
  }

  return { pending: pending.length, evaluated };
}

// Start server
const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   ██████  ██████   █████   ██████ ██      ███████         ║
║  ██    ██ ██   ██ ██   ██ ██      ██      ██              ║
║  ██    ██ ██████  ███████ ██      ██      █████           ║
║  ██    ██ ██   ██ ██   ██ ██      ██      ██              ║
║   ██████  ██   ██ ██   ██  ██████ ███████ ███████         ║
║                                                           ║
║   BRIDGE 2026 - Physical AI Governance OS                 ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝

🚀 API server running on http://localhost:${PORT}
📡 Endpoints:
   - GET  /health              - Health check
   - GET  /api/signals         - List signals (from DB)
   - POST /api/signals/collect - Collect signals
   - GET  /api/issues          - List issues (from DB)
   - POST /api/issues/detect   - Detect and save issues
   - PATCH /api/issues/:id     - Update issue status
   - POST /api/deliberate      - Agent deliberation
   - POST /api/debate          - Multi-round agent debate
   - GET  /api/debate/:id      - Get debate session
   - GET  /api/debates         - List debate sessions
   - GET  /api/proposals       - List proposals
   - POST /api/proposals       - Create proposal
   - POST /api/proposals/:id/vote     - Cast vote
   - POST /api/proposals/:id/tally    - Tally votes
   - POST /api/proposals/:id/finalize - Finalize voting
   - POST /api/proposals/:id/execute  - Execute passed proposal
   - POST /api/outcomes        - Record outcome
   - GET  /api/outcomes/:id/proof  - Generate proof
   - GET  /api/trust/:entityId - Get trust score
   - GET  /api/stats           - System statistics

🔌 WebSocket Events:
   - signals:collected         - New signals collected
   - issues:detected           - New issues detected
   - proposals:created         - New proposal created
   - proposals:voted           - Vote cast on proposal
   - debate:round_completed    - Debate round finished
   - debate:completed          - Full debate completed
   - stats:update              - Stats update on connect
  `);

  // Get current DB stats
  const signalCount = signalDb.count.get() as { count: number };
  const issueCount = issueDb.count.get() as { count: number };
  console.log(`📊 Database: ${signalCount.count} signals, ${issueCount.count} issues stored`);
  console.log(`🔐 Admin auth: ${isAdminAuthEnabled() ? "enabled (ADMIN_API_KEY set)" : "DISABLED — set ADMIN_API_KEY to lock admin endpoints"}`);

  // Auto signal collection
  if (SIGNAL_COLLECT_INTERVAL > 0) {
    console.log(`\n🔄 Auto signal collection: every ${SIGNAL_COLLECT_INTERVAL}s`);

    // Initial collection on startup
    collectAndSaveSignals().then((signals) => {
      console.log(`   ✅ Initial collection: ${signals.length} signals saved to DB`);
    }).catch((err) => {
      console.error("   ❌ Initial collection failed:", err);
    });

    // Periodic collection
    setInterval(async () => {
      try {
        const signals = await collectAndSaveSignals();
        console.log(`🔄 Collected ${signals.length} signals at ${new Date().toLocaleTimeString()}`);
      } catch (error) {
        console.error("❌ Auto-collection failed:", error);
      }
    }, SIGNAL_COLLECT_INTERVAL * 1000);
  }

  // Auto issue detection
  if (ISSUE_DETECT_INTERVAL > 0) {
    console.log(`🔍 Auto issue detection: every ${ISSUE_DETECT_INTERVAL}s`);

    // Initial detection after a short delay
    setTimeout(async () => {
      try {
        const result = await detectAndSaveIssues();
        console.log(`   ✅ Initial detection: ${result.detected} found, ${result.saved} new, ${result.deliberated} deliberated, ${result.promoted} promoted`);
      } catch (error) {
        console.error("   ❌ Initial issue detection failed:", error);
      }
    }, 5000);

    // Periodic detection
    setInterval(async () => {
      try {
        const result = await detectAndSaveIssues();
        if (result.saved > 0) {
          console.log(`🔍 Detected ${result.detected} issues, saved ${result.saved} new, ${result.deliberated} deliberated, ${result.promoted} promoted at ${new Date().toLocaleTimeString()}`);
        }
      } catch (error) {
        console.error("❌ Auto-detection failed:", error);
      }
    }, ISSUE_DETECT_INTERVAL * 1000);
  }

  if (AUTO_DELIBERATE_ENABLED) {
    console.log(`🧠 Auto deliberation: ENABLED (min priority: ${AUTO_DELIBERATE_MIN_PRIORITY})`);
  } else {
    console.log(`🧠 Auto deliberation: DISABLED (set AUTO_DELIBERATE_ENABLED=1 to enable)`);
  }

  if (AUTO_PROPOSAL_ENABLED) {
    console.log(`📝 Auto proposal promotion: ENABLED (consensus ≥ ${AUTO_PROPOSAL_THRESHOLD}, proposer ${AUTO_PROPOSAL_PROPOSER})`);
  } else {
    console.log(`📝 Auto proposal promotion: DISABLED`);
  }

  if (OUTCOME_EVAL_ENABLED && OUTCOME_EVAL_INTERVAL > 0) {
    console.log(`📈 Outcome evaluation: every ${OUTCOME_EVAL_INTERVAL}s, age threshold ${OUTCOME_EVAL_AGE_HOURS}h, batch ${OUTCOME_EVAL_BATCH}`);
    setInterval(async () => {
      try {
        const result = await evaluatePendingOutcomes();
        if (result.evaluated > 0) {
          console.log(`📈 Evaluated ${result.evaluated}/${result.pending} pending decisions at ${new Date().toLocaleTimeString()}`);
        }
      } catch (error) {
        console.error("❌ Outcome evaluation failed:", error);
      }
    }, OUTCOME_EVAL_INTERVAL * 1000);
  } else {
    console.log(`📈 Outcome evaluation: DISABLED`);
  }
});

export default app;
