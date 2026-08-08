import "dotenv/config";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getAddress } from "viem";
import express, { Express } from "express";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

// Import database
import {
  proposalTitle,
  saveProposal,
  saveVoteWithProposal,
  saveDelegation,
  setDelegationActive,
  saveExecutionOutcome,
  saveExecution,
  saveProof,
  hydrate,
} from "./governance-store.js";
import {
  signalDb,
  issueDb,
  proposalDb,
  decisionHistoryDb,
  issueFollowupDb,
  type IssueRow,
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
} from "./learning.js";

// Import blockchain service
import { blockchainService } from "./blockchain.js";

// Import security utilities
import {
  verifyVoteSignature,
  isVoteSignatureRequired,
  buildDelegationMessage,
  verifyDelegationSignature,
  isDelegationSignatureRequired,
  requireAdminKey,
  adminAuthMode,
  adminAuthStartupError,
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
import {
  SOCKET_EVENTS,
  type Proposal,
  type VoteTally,
  type TallyPayload,
} from "@oracle/core";

// Refuse to start on an unsafe auth configuration rather than discovering it
// when an anonymous caller executes a proposal.
const adminAuthError = adminAuthStartupError();
if (adminAuthError) {
  console.error(`❌ Refusing to start: ${adminAuthError}`);
  process.exit(1);
}

const IS_PRODUCTION = process.env.NODE_ENV === "production";

/**
 * Parse a boolean environment variable, refusing anything unrecognised.
 *
 * The `!== "0"` idiom this replaces treated `false`, `off` and `no` as *on*,
 * which is the opposite of what an operator setting them intends. These flags
 * decide whether the process spends money on LLM calls, so a typo failing
 * loudly at startup beats one silently leaving the spending switched on.
 */
function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  console.error(
    `❌ Refusing to start: ${name} must be a boolean (1/0, true/false, yes/no, on/off), got "${raw}"`,
  );
  process.exit(1);
}

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

// Synthetic demo signals, off in production unless explicitly asked for.
//
// MockAdapter invents three `Math.random() * 100` values a minute. Registered
// in production those became real issues, real deliberations and real proposals
// pinned to a real chain snapshot — the detector thresholds were tuned around
// them, so noise escalated to `urgent` indefinitely. A demo fallback is worth
// having; one that a production deploy picks up by default is not.
const ENABLE_MOCK_SIGNALS = envFlag("ENABLE_MOCK_SIGNALS", !IS_PRODUCTION);
if (ENABLE_MOCK_SIGNALS) {
  signalRegistry.registerAdapter(
    new MockAdapter({ signalCount: 3, language: SIGNAL_LANGUAGE }),
  );
  console.log("✅ MockAdapter registered (synthetic demo signals)");
} else {
  console.log("⏭️  MockAdapter skipped (set ENABLE_MOCK_SIGNALS=1 to enable)");
}

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

// Governance parameters. The voting-period floor and the execution timelock
// are relaxed outside production so tests can exercise the full lifecycle
// without waiting; production keeps real windows.
const DAY_MS = 24 * 60 * 60 * 1000;
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    console.error(`❌ Refusing to start: ${name} must be a non-negative integer`);
    process.exit(1);
  }
  return n;
}

const MIN_VOTING_PERIOD_MS = envInt(
  "MIN_VOTING_PERIOD_MS",
  IS_PRODUCTION ? 60 * 60 * 1000 : 1000,
);
const EXECUTION_DELAY_MS = envInt(
  "EXECUTION_DELAY_MS",
  IS_PRODUCTION ? 2 * DAY_MS : 0,
);

const votingSystem = new VotingSystem({
  votingPeriod: envInt("DEFAULT_VOTING_PERIOD_MS", 7 * DAY_MS),
  minVotingPeriod: MIN_VOTING_PERIOD_MS,
  executionDelay: EXECUTION_DELAY_MS,
});
const delegationManager = new DelegationManager();
// Observation window before an execution's KPIs may be measured. Configurable
// so tests can exercise the measurement path without waiting a day.
const outcomeTracker = new OutcomeTrackerImpl({
  kpiMeasurementDelay: envInt("KPI_MEASUREMENT_DELAY_MS", 24 * 60 * 60 * 1000),
});
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
      const existing = issueDb.findSimilar.get({
        category: issue.category,
        kind: issue.kind ?? "issue",
        direction: issue.direction ?? "",
        window: ISSUE_DEDUPE_WINDOW,
      });
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

// How far back a detection counts as a repeat of one already recorded.
const ISSUE_DEDUPE_WINDOW = `-${envInt("ISSUE_DEDUPE_MINUTES", 15)} minutes`;

app.patch("/api/issues/:id", requireAdminKey, async (req, res) => {
  try {
    const { status, decisionPacket } = req.body;

    if (status !== undefined && !VALID_ISSUE_STATUSES.includes(String(status))) {
      return res.status(400).json({
        error: `status must be one of: ${VALID_ISSUE_STATUSES.join(", ")}`,
      });
    }

    const issue = issueDb.getById.get(req.params.id) as IssueRow | undefined;

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

/**
 * Resolve the issue a deliberation is about.
 *
 * Decision history references issues by foreign key, so deliberating over an
 * issue the database has never seen used to fail the insert and return a 500
 * after the LLM work had already been paid for. The caller may now either name
 * a stored issue by id, or supply a full issue which is validated and stored
 * first, so the later decision record has something to point at.
 */
const inlineIssueSchema = z
  .object({
    id: z.string().min(1).max(200).optional(),
    title: z.string().min(1).max(500),
    description: z.string().max(5000).default(""),
    category: z.string().min(1).max(100),
    priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
    status: z.enum(["detected", "deliberating", "proposed", "resolved"]).default("detected"),
    kind: z.string().max(50).optional(),
    direction: z.string().max(50).optional(),
    detectedAt: z.string().datetime().optional(),
    signals: z.array(z.any()).max(500).optional(),
    evidence: z.array(z.any()).max(500).optional(),
    suggestedActions: z.array(z.string().max(1000)).max(100).optional(),
  })
  .passthrough();

type ResolvedIssue =
  | { ok: true; issue: any }
  | { ok: false; status: number; body: Record<string, unknown> };

function resolveDeliberationIssue(body: any): ResolvedIssue {
  const issueId: unknown = body?.issueId;
  if (typeof issueId === "string" && issueId.length > 0) {
    const row = issueDb.getById.get(issueId) as IssueRow | undefined;
    if (!row) {
      return {
        ok: false,
        status: 404,
        body: { error: `Issue ${issueId} not found` },
      };
    }
    return { ok: true, issue: deserializeIssue(row) };
  }

  if (!body?.issue) {
    return {
      ok: false,
      status: 400,
      body: { error: "issueId or issue is required" },
    };
  }

  const parsed = inlineIssueSchema.safeParse(body.issue);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "Invalid issue",
        details: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
    };
  }

  const candidate = {
    ...parsed.data,
    id: parsed.data.id || randomUUID(),
    detectedAt: parsed.data.detectedAt || new Date().toISOString(),
  };

  const existing = issueDb.getById.get(candidate.id) as IssueRow | undefined;
  if (existing) {
    return { ok: true, issue: deserializeIssue(existing) };
  }

  try {
    issueDb.insert.run(serializeIssue(candidate));
  } catch (error) {
    return {
      ok: false,
      status: 400,
      body: { error: sanitizeError(error, "Could not store the supplied issue") },
    };
  }
  const stored = issueDb.getById.get(candidate.id) as IssueRow | undefined;
  return { ok: true, issue: stored ? deserializeIssue(stored) : candidate };
}

// Deliberation endpoints.
// Admin-gated: each call spends LLM credits on behalf of the operator.
app.post("/api/deliberate", requireAdminKey, async (req, res) => {
  try {
    const resolved = resolveDeliberationIssue(req.body);
    if (!resolved.ok) {
      return res.status(resolved.status).json(resolved.body);
    }
    const issue = resolved.issue;
    const { context } = req.body;

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
        issue.id,
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

// Debate endpoints - multi-round agent discussion.
// Admin-gated: a debate fans out to every agent for several rounds.
app.post("/api/debate", requireAdminKey, async (req, res) => {
  try {
    const resolved = resolveDeliberationIssue(req.body);
    if (!resolved.ok) {
      return res.status(resolved.status).json(resolved.body);
    }
    const issue = resolved.issue;
    const { context } = req.body;
    // Never pass the client's number straight through as a loop bound.
    const maxRounds = Moderator.clampRounds(req.body?.maxRounds ?? 3);

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
        // Emit real-time updates for each round, in the shared event shape.
        io.emit(SOCKET_EVENTS.debateRoundCompleted, {
          sessionId: session.id,
          round: round.roundNumber,
          totalRounds: session.maxRounds,
          consensusShift: round.consensusShift,
          keyInsights: round.keyInsights,
          unresolvedPoints: round.unresolvedPoints,
          positionChanges: session.positionChanges.length,
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

    // Emit completion event. The client reads `consensusScore`; sending
    // `finalConsensusScore` made it render NaN.
    io.emit(SOCKET_EVENTS.debateCompleted, {
      sessionId: debateSession.id,
      consensusScore: debateSession.finalConsensusScore ?? 0,
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

/**
 * JSON-safe tally. Weights are bigint internally and must not be handed to
 * JSON.stringify directly.
 */
function serializeTally(tally: VoteTally): TallyPayload {
  return {
    forVotes: tally.forVotes.toString(),
    againstVotes: tally.againstVotes.toString(),
    abstainVotes: tally.abstainVotes.toString(),
    totalVotes: tally.totalVotes.toString(),
    voteCount: tally.voteCount,
    forPercentage: tally.forPercentage,
    participationRate: tally.participationRate,
    quorumReached: tally.quorumReached,
    passed: tally.passed,
  };
}

/**
 * A proposal as clients consume it, with its authoritative tally attached.
 * Listing proposals without one made the UI read vote totals that were never
 * on the object, so every proposal displayed as 0 votes no matter what had
 * been cast.
 */
function withTally(proposal: Proposal) {
  return {
    ...proposal,
    title: proposalTitle(proposal),
    tally: serializeTally(votingSystem.tallyVotes(proposal.id)),
  };
}

// Proposal endpoints
app.get("/api/proposals", (req, res) => {
  try {
    const status = req.query.status as string | undefined;
    const proposals = votingSystem.listProposals(status as any).map(withTally);
    res.json({ proposals, count: proposals.length });
  } catch (error) {
    console.error("Failed to fetch proposals:", error);
    res.status(500).json({ error: "Failed to fetch proposals" });
  }
});

// Proposal settings are attacker-controlled input, so they are validated
// before they reach the voting system: a negative quorum or threshold makes
// both the quorum and threshold checks vacuously true, passing a proposal
// with no votes at all.
const proposalOptionsSchema = z
  .object({
    quorum: z.number().int().positive().max(1_000_000_000).optional(),
    threshold: z.number().min(1).max(100).optional(),
    votingPeriod: z
      .number()
      .int()
      .min(MIN_VOTING_PERIOD_MS)
      .max(90 * DAY_MS)
      .optional(),
  })
  .strict();

/** A proposal cannot be created because its balance snapshot cannot be pinned. */
class SnapshotUnavailableError extends Error {
  readonly code = "SNAPSHOT_UNAVAILABLE";
}

/**
 * Block height that fixes voting power for a new proposal. Taken from chain
 * state, never from the request.
 *
 * Returns undefined only when snapshots do not apply — MOC verification off
 * (demo weights), or VOTE_WEIGHT_MODE=current. When they do apply and the
 * height cannot be read, creation fails: a proposal with no snapshot cannot be
 * voted on safely, and quietly creating one would move the failure to vote
 * time, where it looks like a voter problem.
 */
async function currentSnapshotBlock(): Promise<number | undefined> {
  if (!blockchainService.isMocEnabled() || VOTE_WEIGHT_MODE !== "snapshot") {
    return undefined;
  }
  try {
    return await blockchainService.getCurrentBlockNumber();
  } catch (error) {
    throw new SnapshotUnavailableError(
      "Could not read the current block to pin this proposal's balance " +
        `snapshot: ${sanitizeError(error, "chain unreachable")}. Retry once the ` +
        "RPC is reachable, or set VOTE_WEIGHT_MODE=current to accept live " +
        "balances (not sybil-resistant across wallets).",
    );
  }
}

app.post("/api/proposals", requireAdminKey, async (req, res) => {
  try {
    const { decisionPacket, proposer, options } = req.body;
    if (!decisionPacket || !proposer) {
      return res.status(400).json({ error: "decisionPacket and proposer are required" });
    }

    const parsedOptions = proposalOptionsSchema.safeParse(options ?? {});
    if (!parsedOptions.success) {
      return res.status(400).json({
        error: "Invalid proposal options",
        details: parsedOptions.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    }

    // Pin the snapshot before creating anything, so a chain outage cannot
    // leave a proposal behind that no one can vote on.
    const snapshotBlock = await currentSnapshotBlock();

    const proposal = votingSystem.createProposal(decisionPacket, proposer, {
      ...parsedOptions.data,
      snapshotBlock,
    });
    // Auto-activate the proposal for immediate voting
    votingSystem.activateProposal(proposal.id);
    const activatedProposal = votingSystem.getProposal(proposal.id)!;

    try {
      saveProposal(activatedProposal);
    } catch (persistError) {
      // Without this the proposal would live in memory only: visible, votable,
      // and gone at the next restart, while its votes were written against a
      // proposal id that storage has never heard of.
      votingSystem.removeProposal(activatedProposal.id);
      throw persistError;
    }

    // Emit real-time event
    const allProposals = votingSystem.listProposals();
    io.emit(SOCKET_EVENTS.proposalCreated, {
      proposal: withTally(activatedProposal),
      totalCount: allProposals.length,
      activeCount: allProposals.filter(p => p.status === "active").length,
      source: "manual",
    });

    res.status(201).json({ proposal: withTally(activatedProposal) });
  } catch (error) {
    console.error("Failed to create proposal:", error);
    if (error instanceof SnapshotUnavailableError) {
      // Not the caller's mistake: the chain is unreachable right now.
      return res.status(503).json({ error: error.message, code: error.code });
    }
    // Rejected settings are a client mistake, not a server fault.
    res.status(400).json({ error: sanitizeError(error, "Failed to create proposal") });
  }
});

app.get("/api/proposals/:id", (req, res) => {
  try {
    const proposal = votingSystem.getProposal(req.params.id);
    if (!proposal) {
      return res.status(404).json({ error: "Proposal not found" });
    }
    res.json({ proposal: withTally(proposal) });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch proposal" });
  }
});

/**
 * Where voting power comes from.
 * - "snapshot" (default): balance at the proposal's snapshot block, so tokens
 *   moved during the vote cannot be counted twice.
 * - "current": live balance. Not sybil-resistant across wallets; only for
 *   deployments whose RPC cannot serve historical state.
 */
const VOTE_WEIGHT_MODE = (process.env.VOTE_WEIGHT_MODE || "snapshot").toLowerCase();
if (!["snapshot", "current"].includes(VOTE_WEIGHT_MODE)) {
  console.error("❌ Refusing to start: VOTE_WEIGHT_MODE must be 'snapshot' or 'current'");
  process.exit(1);
}

/**
 * Voting weight for a MOC-verified voter, per VOTE_WEIGHT_MODE.
 *
 * In snapshot mode a proposal without a snapshot block is refused rather than
 * weighted from the live balance. Falling back would silently return the
 * system to the behaviour snapshots exist to prevent — vote, forward the
 * tokens, vote again — and it would do so for exactly the proposals created
 * while the chain was unreachable, with nothing in the response to say so.
 */
async function resolveVotingWeight(
  voter: `0x${string}`,
  proposal: { id: string; snapshotBlock?: number },
): Promise<bigint> {
  if (VOTE_WEIGHT_MODE === "current") {
    const balance = await blockchainService.verifyVoterEligibility(voter);
    if (balance === 0n) {
      throw new Error(`Address ${voter} is not a MOC holder.`);
    }
    return balance;
  }

  if (proposal.snapshotBlock === undefined) {
    throw new Error(
      `Proposal ${proposal.id} has no balance snapshot, so voting power cannot ` +
        "be established. It was created while the chain was unreachable; " +
        "create a replacement proposal, or set VOTE_WEIGHT_MODE=current to " +
        "accept live balances (not sybil-resistant across wallets).",
    );
  }

  const balance = await blockchainService.getMocBalanceAt(voter, proposal.snapshotBlock);
  if (balance === 0n) {
    throw new Error(
      `Address ${voter} held no MOC at block ${proposal.snapshotBlock}, the snapshot for this proposal.`,
    );
  }
  return balance;
}

app.post("/api/proposals/:id/vote", async (req, res) => {
  try {
    const { voter, choice, weight, reason, signature, nonce, timestamp } = req.body;
    if (!voter || !choice) {
      return res.status(400).json({ error: "voter and choice are required" });
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(voter)) {
      return res.status(400).json({ error: "voter must be a valid 0x address" });
    }

    // Canonicalize before anything else looks at these values. The duplicate
    // check, the signed message, the stored vote and the tally must all agree
    // on one spelling, or the same holder can vote twice under different
    // casings and an upper-case choice can be accepted yet counted nowhere.
    let canonicalVoter: `0x${string}`;
    let canonicalChoice: "for" | "against" | "abstain";
    try {
      canonicalVoter = getAddress(voter);
      canonicalChoice = VotingSystem.normalizeChoice(choice);
    } catch (normalizeError: any) {
      return res.status(400).json({
        error: sanitizeError(normalizeError, "voter or choice is not valid"),
      });
    }

    const proposalForVote = votingSystem.getProposal(req.params.id);
    if (!proposalForVote) {
      return res.status(404).json({ error: "Proposal not found" });
    }

    // Verify the voter actually authorized this vote (anti-spoofing).
    // Required when MOC verification is enabled, configurable via REQUIRE_VOTE_SIGNATURE.
    const sigRequired = isVoteSignatureRequired(blockchainService.isMocEnabled());
    if (sigRequired) {
      const sig = await verifyVoteSignature({
        voter: canonicalVoter,
        proposalId: req.params.id,
        choice: canonicalChoice,
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
        votingWeight = await resolveVotingWeight(canonicalVoter, proposalForVote);
        console.log(
          `✅ Voter ${canonicalVoter} verified: ${Number(votingWeight) / 1e18} MOC` +
            (proposalForVote.snapshotBlock !== undefined
              ? ` @ block ${proposalForVote.snapshotBlock}`
              : ""),
        );
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

    // Cast the vote with the canonical identity, choice and verified weight
    const vote = votingSystem.castVote(
      req.params.id,
      canonicalVoter,
      canonicalChoice,
      votingWeight,
      reason
    );

    // Persist immediately; the UNIQUE (proposal_id, voter_key) constraint is
    // the last line of defence against a double vote.
    try {
      saveVoteWithProposal(
        vote,
        VotingSystem.voterKey(canonicalVoter),
        votingSystem.getProposal(req.params.id)!,
      );
    } catch (persistError) {
      // Keep memory and storage consistent rather than acknowledging a vote
      // that would vanish on the next restart.
      votingSystem.removeVote(req.params.id, canonicalVoter);
      throw persistError;
    }

    // No per-vote on-chain relay. The contract keys duplicate detection on
    // msg.sender, and every relayed vote would share this server's single
    // signer, so the relayer's first vote would make every later voter revert
    // with "Already voted". Off-chain state is authoritative; see O-05.
    const txHash: string | undefined = undefined;

    // Emit real-time event
    const tally = votingSystem.tallyVotes(req.params.id);
    io.emit(SOCKET_EVENTS.proposalVoted, {
      proposalId: req.params.id,
      vote: {
        ...vote,
        weight: vote.weight.toString(),
      },
      tally: serializeTally(tally),
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
    saveProposal(proposal);
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

    // Record the execution. No proof is produced here: a proof asserts that
    // the proposal's KPIs were met, and nothing has been observed yet. It is
    // issued only once measurements are submitted after the observation
    // window, via POST /api/outcomes/:executionId/measurements.
    const execution = await outcomeTracker.recordExecution(proposalId, actions);
    const measurement = outcomeTracker.measurementStatus(execution.id);

    saveExecutionOutcome({ proposal: executedProposal, execution });

    // The learning feedback loop is fed when the outcome is actually measured,
    // not here — recording a result now would teach the agents from a number
    // nobody observed.

    res.json({
      proposal: withTally(executedProposal),
      execution,
      measurement: {
        status: "pending_measurement",
        dueAt: measurement.dueAt.toISOString(),
        declaredKpis: dp?.kpis ?? [],
        submitTo: `/api/outcomes/${execution.id}/measurements`,
      },
      message:
        "Proposal executed. Submit measured KPI values after the observation " +
        "window to produce an outcome proof.",
    });
  } catch (error: any) {
    res.status(400).json({ error: sanitizeError(error, "Failed to execute proposal") });
  }
});

const measurementsSchema = z
  .object({
    measurements: z
      .array(
        z
          .object({
            name: z.string().min(1).max(200),
            actual: z.number().finite(),
            target: z.number().finite().optional(),
            unit: z.string().max(50).optional(),
            success: z.boolean().optional(),
            source: z.string().max(500).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();

/**
 * Submit observed KPI values for an execution and issue its outcome proof.
 *
 * This is the only path that produces a proof. Execution used to mint one
 * immediately from two fabricated KPIs, so every proposal was recorded as a
 * 100% success milliseconds after execution, before anything could have
 * happened.
 */
app.post("/api/outcomes/:executionId/measurements", requireAdminKey, async (req, res) => {
  try {
    const parsed = measurementsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid measurements",
        details: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    }

    const execution = outcomeTracker.getExecution(req.params.executionId);
    if (!execution) {
      return res.status(404).json({ error: "Execution not found" });
    }

    // Already measured: report the existing proof rather than issuing a
    // second one. Re-running would re-apply the trust adjustment and could
    // amend a recorded failure into a success.
    const alreadyMeasured = outcomeTracker.getProofByExecution(execution.id);
    if (alreadyMeasured) {
      return res.status(409).json({
        error:
          `Execution ${execution.id} was already measured at ` +
          `${alreadyMeasured.recordedAt.toISOString()}; outcomes are recorded once.`,
        code: "ALREADY_MEASURED",
        proof: alreadyMeasured,
      });
    }

    const proposal = votingSystem.getProposal(execution.proposalId);
    const declaredKpis = (proposal?.decisionPacket?.kpis ?? []).map((k) => ({
      name: k.name,
      target: k.target,
      unit: k.unit,
      direction: k.direction,
    }));

    const kpiResults = outcomeTracker.submitMeasurements(
      execution.id,
      declaredKpis,
      parsed.data.measurements,
    );
    const proof = await outcomeTracker.generateProof(execution.id);

    // Trust only moves on measured outcomes.
    const dp = proposal?.decisionPacket;
    const updatedTrust = proposal
      ? [
          trustManager.recordOutcome(proposal.proposer, "proposer", proof),
          ...Array.from(
            new Set((dp?.agentOpinions ?? []).map((op) => op.agentId)),
          ).map((agentId) => trustManager.recordOutcome(agentId, "agent", proof)),
        ]
      : [];

    if (proposal) {
      saveExecutionOutcome({
        proposal,
        execution,
        kpiResults,
        proof,
        trustScores: updatedTrust,
      });
    } else {
      saveExecution(execution, kpiResults);
      saveProof(proof);
    }

    // Now the learning loop has a real number to learn from.
    const issueId = dp?.issue?.id;
    if (issueId) {
      try {
        if (recordOutcomeByIssueId(issueId, proof.successRate, proof.kpiResults)) {
          console.log(
            `📊 Recorded learning outcome for issue ${issueId}: ` +
              `${(proof.successRate * 100).toFixed(0)}% of KPIs met`,
          );
        }
      } catch (err) {
        console.warn("Could not record learning outcome:", err);
      }
    }

    res.status(201).json({ proof, kpiResults });
  } catch (error: any) {
    console.error("Failed to record measurements:", error);
    res.status(400).json({ error: sanitizeError(error, "Failed to record measurements") });
  }
});

/** Whether an execution is still awaiting measurement. */
app.get("/api/outcomes/:executionId/measurements", (req, res) => {
  try {
    const execution = outcomeTracker.getExecution(req.params.executionId);
    if (!execution) {
      return res.status(404).json({ error: "Execution not found" });
    }
    const status = outcomeTracker.measurementStatus(execution.id);
    res.json({
      executionId: status.executionId,
      status: status.measured ? "measured" : "pending_measurement",
      dueAt: status.dueAt.toISOString(),
      measurable: Date.now() >= status.dueAt.getTime(),
      proofId: status.proofId,
    });
  } catch (error: any) {
    res.status(400).json({ error: sanitizeError(error, "Failed to read measurement status") });
  }
});

/** Title for an outcome row, from the proposal it came from. */
function outcomeTitle(proposalId: string): string {
  const proposal = votingSystem.getProposal(proposalId);
  return proposal
    ? proposalTitle(proposal)
    : `Proposal #${proposalId.slice(0, 8)}`;
}

// Outcome endpoints
app.get("/api/outcomes", async (req, res) => {
  try {
    const proofs = outcomeTracker.listProofs();
    const measuredExecutions = new Set(proofs.map((p) => p.executionId));

    const measured = proofs.map((proof) => {
      const proposal = votingSystem.getProposal(proof.proposalId);
      return {
        id: proof.id,
        executionId: proof.executionId,
        proposalId: proof.proposalId,
        proposalTitle: outcomeTitle(proof.proposalId),
        status: "measured" as const,
        overallSuccess: proof.overallSuccess,
        /** Fraction of declared KPIs met, in [0,1]. */
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

    // Executions still inside their observation window are listed as pending
    // rather than omitted, so an executed proposal with no measurable result
    // yet is visible instead of looking like nothing happened.
    const pending = outcomeTracker
      .listExecutions()
      .filter((execution) => !measuredExecutions.has(execution.id))
      .map((execution) => {
        const status = outcomeTracker.measurementStatus(execution.id);
        return {
          id: execution.id,
          executionId: execution.id,
          proposalId: execution.proposalId,
          proposalTitle: outcomeTitle(execution.proposalId),
          status: "pending_measurement" as const,
          overallSuccess: null,
          successRate: null,
          kpis: [],
          measurementDueAt: status.dueAt,
          executedAt: execution.executedAt,
          recordedAt: execution.executedAt,
        };
      });

    const outcomes = [...measured, ...pending];
    res.json({ outcomes, count: outcomes.length });
  } catch (error) {
    console.error("Failed to fetch outcomes:", error);
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
    saveExecution(execution);
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

/**
 * Read the proof issued for an execution.
 *
 * Strictly a read. Generating the proof here would rewrite it: the hashed
 * payload embeds the current time, so each call produced a different
 * proofHash for the same measurements and persisted it over the stored row —
 * an unauthenticated request could change an attestation the UI displays and
 * the chain would anchor. Proofs are issued once, by
 * POST /api/outcomes/:executionId/measurements.
 */
app.get("/api/outcomes/:executionId/proof", (req, res) => {
  try {
    const execution = outcomeTracker.getExecution(req.params.executionId);
    if (!execution) {
      return res.status(404).json({ error: "Execution not found" });
    }
    const proof = outcomeTracker.getProofByExecution(req.params.executionId);
    if (!proof) {
      const status = outcomeTracker.measurementStatus(req.params.executionId);
      return res.status(409).json({
        error:
          "No outcome proof yet: this execution's KPIs have not been measured.",
        code: "PENDING_MEASUREMENT",
        measurementDueAt: status.dueAt.toISOString(),
      });
    }
    res.json({ proof });
  } catch (error: any) {
    res.status(400).json({ error: sanitizeError(error, "Failed to read proof") });
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

/**
 * Delegation conditions are evaluated against a proposal by path lookup, so
 * the set of paths is fixed here rather than accepting arbitrary strings. An
 * unknown path silently evaluates to undefined, which either never matches or
 * — for an empty condition list — matches everything.
 */
const DELEGATION_CONDITION_FIELDS = {
  "decisionPacket.issue.category": ["eq", "ne", "in", "contains"],
  "decisionPacket.issue.priority": ["eq", "ne", "in"],
  "decisionPacket.consensusScore": ["gt", "lt", "gte", "lte"],
  "decisionPacket.recommendedProposalType": ["eq", "ne", "in"],
  "proposer": ["eq", "ne", "in"],
  "quorum": ["gt", "lt", "gte", "lte"],
  "threshold": ["gt", "lt", "gte", "lte"],
} as const;

const delegationConditionSchema = z
  .object({
    field: z.enum(
      Object.keys(DELEGATION_CONDITION_FIELDS) as [string, ...string[]],
    ),
    operator: z.enum(["eq", "ne", "gt", "lt", "gte", "lte", "in", "contains"]),
    value: z.union([
      z.string().max(200),
      z.number(),
      z.boolean(),
      z.array(z.union([z.string().max(200), z.number()])).max(50),
    ]),
  })
  .strict()
  .superRefine((condition, ctx) => {
    const allowed =
      DELEGATION_CONDITION_FIELDS[
        condition.field as keyof typeof DELEGATION_CONDITION_FIELDS
      ];
    if (!allowed.includes(condition.operator as never)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `operator '${condition.operator}' is not allowed for field '${condition.field}' (allowed: ${allowed.join(", ")})`,
      });
    }
    if (condition.operator === "in" && !Array.isArray(condition.value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "operator 'in' requires an array value",
      });
    }
    if (
      ["gt", "lt", "gte", "lte"].includes(condition.operator) &&
      typeof condition.value !== "number"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `operator '${condition.operator}' requires a numeric value`,
      });
    }
    // Equality is by identity, so an array or object value can never match a
    // scalar field: the policy would be accepted and then never fire. And an
    // empty `contains` matches every string, which is a blanket delegation
    // wearing a condition.
    if (["eq", "ne"].includes(condition.operator) && Array.isArray(condition.value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `operator '${condition.operator}' compares by identity and can never match an array value`,
      });
    }
    if (condition.operator === "contains") {
      if (typeof condition.value !== "string") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "operator 'contains' requires a string value",
        });
      } else if (condition.value.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "operator 'contains' with an empty string matches every proposal; " +
            "use delegateAll: true if that is the intent",
        });
      }
    }
  });

const createDelegationSchema = z
  .object({
    delegator: z.string(),
    delegate: z.string().min(1).max(200),
    conditions: z.array(delegationConditionSchema).max(20).optional(),
    /**
     * Required to create a policy with no conditions. Without it an empty list
     * quietly became a blanket delegation, because every([]) is true.
     */
    delegateAll: z.boolean().optional(),
    expiresAt: z.string().datetime().optional(),
    signature: z.string().optional(),
    nonce: z.string().max(200).optional(),
    timestamp: z.number().optional(),
  })
  .strict();

app.post("/api/delegations", async (req, res) => {
  try {
    const parsed = createDelegationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid delegation",
        details: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    }
    const { delegate, conditions, delegateAll, expiresAt, signature, nonce, timestamp } =
      parsed.data;

    let delegator: `0x${string}`;
    try {
      delegator = getAddress(parsed.data.delegator);
    } catch {
      return res.status(400).json({ error: "delegator must be a valid 0x address" });
    }

    const normalizedConditions = conditions ?? [];
    if (normalizedConditions.length === 0 && delegateAll !== true) {
      return res.status(400).json({
        error:
          "A delegation with no conditions applies to every proposal. Send " +
          "delegateAll: true to confirm, or provide conditions.",
        code: "UNCONDITIONAL_DELEGATION",
      });
    }

    if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
      return res.status(400).json({ error: "expiresAt must be in the future" });
    }

    // Prove the delegator's wallet authorized handing over its influence.
    if (isDelegationSignatureRequired()) {
      const message = buildDelegationMessage({
        action: "create",
        delegator,
        delegate,
        conditions: canonicalJson(normalizedConditions),
        expiresAt,
        nonce: nonce || "",
        timestamp: timestamp || 0,
      });
      const sig = await verifyDelegationSignature({
        message,
        delegator,
        signature: signature as `0x${string}` | undefined,
        nonce,
        timestamp,
      });
      if (!sig.ok) {
        return res.status(401).json({
          error: sig.reason || "Delegation signature verification failed",
          code: "INVALID_SIGNATURE",
        });
      }
    }

    const policy = delegationManager.createPolicy(
      delegator,
      delegate.trim(),
      normalizedConditions as any,
      expiresAt ? new Date(expiresAt) : undefined
    );
    saveDelegation(policy);

    res.status(201).json({ policy });
  } catch (error) {
    console.error("Failed to create delegation:", error);
    res.status(400).json({ error: sanitizeError(error, "Failed to create delegation") });
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

app.delete("/api/delegations/:id", async (req, res) => {
  try {
    const policy = delegationManager.getPolicy(req.params.id);
    if (!policy) {
      return res.status(404).json({ error: "Delegation not found" });
    }

    // Revocation is as sensitive as creation: without proof of ownership
    // anyone could strip another holder's delegation.
    if (isDelegationSignatureRequired()) {
      const { signature, nonce, timestamp } = (req.body ?? {}) as {
        signature?: string;
        nonce?: string;
        timestamp?: number;
      };
      let delegator: `0x${string}`;
      try {
        delegator = getAddress(policy.delegator);
      } catch {
        return res.status(409).json({
          error: "This policy's delegator is not a valid address and cannot be verified",
        });
      }
      const message = buildDelegationMessage({
        action: "revoke",
        delegator,
        policyId: policy.id,
        nonce: nonce || "",
        timestamp: timestamp || 0,
      });
      const sig = await verifyDelegationSignature({
        message,
        delegator,
        signature: signature as `0x${string}` | undefined,
        nonce,
        timestamp,
      });
      if (!sig.ok) {
        return res.status(401).json({
          error: sig.reason || "Delegation signature verification failed",
          code: "INVALID_SIGNATURE",
        });
      }
    }

    delegationManager.revokePolicy(req.params.id);
    setDelegationActive(req.params.id, false);
    res.json({ message: "Delegation revoked", policy: { ...policy, active: false } });
  } catch (error) {
    console.error("Failed to revoke delegation:", error);
    res.status(400).json({ error: sanitizeError(error, "Failed to revoke delegation") });
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

// How often to close out proposals whose voting period has ended (0 disables).
const AUTO_FINALIZE_INTERVAL = envInt("AUTO_FINALIZE_INTERVAL", 60);

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
    const existing = issueDb.findSimilar.get({
        category: issue.category,
        kind: issue.kind ?? "issue",
        direction: issue.direction ?? "",
        window: ISSUE_DEDUPE_WINDOW,
      });
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
              // Pin the snapshot first: if the chain is unreachable this
              // throws and the issue stays un-promoted, to be retried on the
              // next detection pass, rather than becoming a proposal nobody
              // can vote on.
              const snapshotBlock = await currentSnapshotBlock();
              const proposal = votingSystem.createProposal(
                decisionPacket,
                AUTO_PROPOSAL_PROPOSER,
                { snapshotBlock },
              );
              votingSystem.activateProposal(proposal.id);
              const activated = votingSystem.getProposal(proposal.id)!;
              // Same write path as a manual proposal, so an auto-promoted one
              // is restored on the next boot instead of leaving a row that
              // only blocks the issue from being proposed again.
              try {
                saveProposal(activated, issue.id);
              } catch (persistError) {
                votingSystem.removeProposal(activated.id);
                throw persistError;
              }
              promotedCount++;
              const all = votingSystem.listProposals();
              io.emit(SOCKET_EVENTS.proposalCreated, {
                proposal: withTally(activated),
                totalCount: all.length,
                activeCount: all.filter((p) => p.status === "active").length,
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

/**
 * Close out proposals whose voting period has ended.
 *
 * Nothing finalized a proposal before: the web declared a finalize mutation it
 * never called, and there was no scheduler, so a proposal created from the UI
 * stayed "active" forever and could never reach the execute step. Idempotent —
 * it only touches active proposals that are actually past their end time.
 */
function finalizeDueProposals(): { finalized: number; failed: number } {
  const nowMs = Date.now();
  let finalized = 0;
  let failed = 0;

  for (const proposal of votingSystem.listProposals("active")) {
    if (proposal.votingEndsAt.getTime() > nowMs) continue;
    try {
      const updated = votingSystem.finalizeProposal(proposal.id);
      saveProposal(updated);
      finalized++;

      const all = votingSystem.listProposals();
      io.emit(SOCKET_EVENTS.proposalFinalized, {
        proposalId: updated.id,
        status: updated.status,
        tally: serializeTally(votingSystem.tallyVotes(updated.id)),
        executionEta: updated.executionEta?.toISOString(),
        totalCount: all.length,
        activeCount: all.filter((p) => p.status === "active").length,
      });
      console.log(`🗳️  Finalized proposal ${proposal.id}: ${updated.status}`);
    } catch (error) {
      failed++;
      console.error(`[auto-finalize] failed for proposal ${proposal.id}:`, error);
    }
  }

  return { finalized, failed };
}

/**
 * Snapshot voting reads a balance at the block a proposal pinned, which needs
 * an archive-capable RPC. Most public endpoints keep only ~128 blocks of
 * state, so the reads succeed for roughly 25 minutes after a proposal is
 * created and fail for every voter after that — a failure that shows up long
 * after the misconfiguration, on the voter's request. Probe once at boot and
 * say so plainly instead.
 */
async function checkArchiveRpc(): Promise<void> {
  if (!blockchainService.isMocEnabled() || VOTE_WEIGHT_MODE !== "snapshot") return;

  const probeDepth = envInt("SNAPSHOT_PROBE_DEPTH", 1000);
  try {
    const head = await blockchainService.getCurrentBlockNumber();
    const target = Math.max(1, head - probeDepth);
    await blockchainService.getMocBalanceAt(
      "0x0000000000000000000000000000000000000001",
      target,
    );
    console.log(`🗄️  Archive RPC: ok (read state at block ${target})`);
  } catch {
    console.warn(
      "🚨 Archive RPC: this endpoint cannot serve historical state " +
        `(${probeDepth} blocks back).\n` +
        "   Snapshot voting will start failing for every voter roughly\n" +
        "   half an hour after a proposal is created. Point MAINNET_RPC_URL at\n" +
        "   an archive-capable provider, or set VOTE_WEIGHT_MODE=current to\n" +
        "   accept live balances (not sybil-resistant across wallets).",
    );
  }
}

// Rebuild governance state from storage BEFORE accepting traffic. Serving
// requests first would briefly report zero proposals and let a holder vote
// again on a proposal they had already voted on.
const hydration = hydrate({
  votingSystem,
  delegationManager,
  outcomeTracker,
  trustManager,
});
console.log(
  `♻️  Restored governance state: ${hydration.proposals} proposals, ` +
    `${hydration.votes} votes, ${hydration.delegations} delegations, ` +
    `${hydration.executions} executions, ${hydration.proofs} proofs, ` +
    `${hydration.trustScores} trust scores`,
);
if (hydration.skipped.length > 0) {
  console.warn(`⚠️  ${hydration.skipped.length} record(s) could not be restored:`);
  for (const reason of hydration.skipped.slice(0, 10)) {
    console.warn(`     - ${reason}`);
  }
}

// Non-blocking: report an RPC that cannot serve snapshots rather than letting
// it surface later as a voter-facing failure.
void checkArchiveRpc();

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
  if (adminAuthMode === "enforced") {
    console.log("🔐 Admin auth: enforced (ADMIN_API_KEY set)");
  } else if (adminAuthMode === "demo-open") {
    console.warn(
      "🚨 Admin auth: DISABLED via DEMO_MODE=1 — every admin endpoint is\n" +
        "   anonymous. Never expose this process to an untrusted network.",
    );
  } else {
    console.log(
      "🔐 Admin auth: admin endpoints are BLOCKED (503) — set ADMIN_API_KEY to\n" +
        "   enable them, or DEMO_MODE=1 for an anonymous local demo.",
    );
  }

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

  // Close out proposals whose voting period ended, including any that expired
  // while the process was down.
  if (AUTO_FINALIZE_INTERVAL > 0) {
    console.log(`🗳️  Auto finalize: every ${AUTO_FINALIZE_INTERVAL}s`);
    const due = finalizeDueProposals();
    if (due.finalized > 0) {
      console.log(`   ✅ Finalized ${due.finalized} proposal(s) whose voting had ended`);
    }
    setInterval(() => {
      try {
        finalizeDueProposals();
      } catch (error) {
        console.error("❌ Auto finalize failed:", error);
      }
    }, AUTO_FINALIZE_INTERVAL * 1000);
  } else {
    console.log(`🗳️  Auto finalize: DISABLED`);
  }
});

export default app;
