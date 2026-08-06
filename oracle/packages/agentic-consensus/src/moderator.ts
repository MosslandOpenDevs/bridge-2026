import {
  GovernanceAgent,
  AgentOpinion,
  DecisionPacket,
  DetectedIssue,
  AgentContext,
  ProposalType,
  DebateSession,
  DiscussionRound,
  DiscussionMessage,
  generateId,
  now,
} from "@oracle/core";
import { BaseAgent } from "./agents/base.js";
import { LLMClient, LLMConfig } from "./llm/index.js";

export type ModeratorConfig = LLMConfig;

export class Moderator {
  /** Hard bounds on debate length, independent of what a caller asks for. */
  static readonly MIN_ROUNDS = 1;
  static readonly MAX_ROUNDS = 5;

  /** Coerce any caller-supplied round count into the supported range. */
  static clampRounds(requested: unknown): number {
    const n = Math.floor(Number(requested));
    if (!Number.isFinite(n)) return 3;
    return Math.min(Moderator.MAX_ROUNDS, Math.max(Moderator.MIN_ROUNDS, n));
  }

  private agents: GovernanceAgent[] = [];
  private llmClient: LLMClient;

  private readonly systemPrompt = `You are a Moderator Agent synthesizing multiple expert opinions into a unified decision recommendation.
Your role is to:
1. Weigh different perspectives fairly
2. Identify consensus and dissent
3. Create a balanced recommendation
4. Define measurable KPIs for outcome tracking

Be objective, thorough, and actionable.`;

  constructor(config: ModeratorConfig = {}) {
    this.llmClient = new LLMClient({
      ...config,
      maxTokens: config.maxTokens || 4096,
    });
  }

  get isLLMEnabled(): boolean {
    return this.llmClient.isAvailable;
  }

  get llmProvider(): string {
    return this.llmClient.currentProvider;
  }

  get llmModel(): string {
    return this.llmClient.currentModel;
  }

  registerAgent(agent: GovernanceAgent): void {
    this.agents.push(agent);
  }

  unregisterAgent(agentId: string): void {
    this.agents = this.agents.filter((a) => a.id !== agentId);
  }

  async deliberate(
    issue: DetectedIssue,
    context: AgentContext = {}
  ): Promise<DecisionPacket> {
    // Collect opinions from all agents
    const opinions: AgentOpinion[] = [];

    for (const agent of this.agents) {
      try {
        const opinion = await agent.deliberate(issue, context);
        opinions.push(opinion);
      } catch (error) {
        console.error(`Agent ${agent.id} failed to deliberate:`, error);
      }
    }

    // Synthesize into decision packet
    if (this.llmClient.isAvailable) {
      try {
        return await this.synthesizeWithLLM(issue, opinions);
      } catch (error) {
        console.error("[Moderator] LLM synthesis failed, falling back to rule-based:", error);
        return this.synthesizeRuleBased(issue, opinions);
      }
    }

    return this.synthesizeRuleBased(issue, opinions);
  }

  /**
   * Conduct a multi-round debate on an issue
   * @param issue The issue to debate
   * @param context Additional context for agents
   * @param maxRounds Maximum number of debate rounds (default: 3)
   * @param onRoundComplete Callback for when a round completes (for real-time updates)
   */
  async conductDebate(
    issue: DetectedIssue,
    context: AgentContext = {},
    maxRounds: number = 3,
    onRoundComplete?: (round: DiscussionRound, session: DebateSession) => void
  ): Promise<DebateSession> {
    const sessionId = generateId();
    const startedAt = now();

    // Clamp here as well as at the API boundary: every extra round replays the
    // accumulated transcript to every agent, so an unbounded round count is an
    // unbounded LLM bill.
    maxRounds = Moderator.clampRounds(maxRounds);

    // Round 0: Initial deliberation (collect initial opinions)
    console.log(`[Moderator] Starting debate session ${sessionId} for issue: ${issue.title}`);
    const initialOpinions: AgentOpinion[] = [];

    for (const agent of this.agents) {
      try {
        const opinion = await agent.deliberate(issue, context);
        initialOpinions.push(opinion);
        console.log(`  - ${agent.role}: ${opinion.stance} (${(opinion.confidence * 100).toFixed(0)}%)`);
      } catch (error) {
        console.error(`Agent ${agent.id} failed initial deliberation:`, error);
      }
    }

    const session: DebateSession = {
      id: sessionId,
      issueId: issue.id,
      issue,
      status: "in_progress",
      rounds: [],
      maxRounds,
      currentRound: 0,
      initialOpinions,
      positionChanges: [],
      startedAt,
    };

    // Check initial consensus - if high enough, skip debate
    const initialConsensus = this.calculateConsensusScore(initialOpinions);
    if (initialConsensus.consensusScore >= 0.8) {
      console.log(`[Moderator] High initial consensus (${(initialConsensus.consensusScore * 100).toFixed(0)}%), skipping debate`);
      session.status = "completed";
      session.finalConsensusScore = initialConsensus.consensusScore;
      session.completedAt = now();
      return session;
    }

    // Conduct debate rounds
    const currentOpinions = [...initialOpinions];
    let allMessages: DiscussionMessage[] = [];
    let previousConsensusScore = initialConsensus.consensusScore;

    for (let roundNum = 1; roundNum <= maxRounds; roundNum++) {
      console.log(`[Moderator] Starting round ${roundNum}/${maxRounds}`);
      session.currentRound = roundNum;

      const roundTopic = this.determineRoundTopic(roundNum, currentOpinions, allMessages);
      const roundMessages: DiscussionMessage[] = [];
      const roundStartedAt = now();

      // Each agent responds to others' opinions
      for (const agent of this.agents) {
        if (agent instanceof BaseAgent && agent.respond) {
          try {
            const message = await agent.respond(issue, currentOpinions, allMessages, context);
            roundMessages.push(message);
            console.log(`  - ${agent.role} (${message.messageType}): ${message.content.slice(0, 80)}...`);
          } catch (error) {
            console.error(`Agent ${agent.id} failed to respond in round ${roundNum}:`, error);
          }
        }
      }

      allMessages = [...allMessages, ...roundMessages];

      // Check for stance changes after this round
      for (const agent of this.agents) {
        if (agent instanceof BaseAgent && agent.updateStance) {
          const currentOpinion = currentOpinions.find(o => o.agentId === agent.id);
          if (currentOpinion) {
            try {
              const stanceChange = await agent.updateStance(currentOpinion, allMessages, context);
              if (stanceChange) {
                console.log(`  - ${agent.role} changed stance: ${currentOpinion.stance} → ${stanceChange.newStance}`);
                session.positionChanges.push({
                  agentId: agent.id,
                  agentRole: agent.role,
                  fromStance: currentOpinion.stance,
                  toStance: stanceChange.newStance,
                  reason: stanceChange.reason,
                  atRound: roundNum,
                });
                // Update opinion for next round
                currentOpinion.stance = stanceChange.newStance;
              }
            } catch (error) {
              console.error(`Agent ${agent.id} failed to update stance:`, error);
            }
          }
        }
      }

      // Calculate consensus shift against the previous round's *score*.
      // Subtracting the previous round's shift instead made the value
      // oscillate, so the "no progress" early exit rarely fired.
      const currentConsensus = this.calculateConsensusScore(currentOpinions);
      const consensusShift = currentConsensus.consensusScore - previousConsensusScore;
      previousConsensusScore = currentConsensus.consensusScore;

      // Generate insights for this round
      const keyInsights = this.extractKeyInsights(roundMessages);
      const unresolvedPoints = this.findUnresolvedPoints(roundMessages, currentOpinions);

      const round: DiscussionRound = {
        roundNumber: roundNum,
        topic: roundTopic,
        messages: roundMessages,
        consensusShift,
        keyInsights,
        unresolvedPoints,
        startedAt: roundStartedAt,
        completedAt: now(),
      };

      session.rounds.push(round);

      // Notify callback if provided
      if (onRoundComplete) {
        onRoundComplete(round, session);
      }

      // Early termination if high consensus reached
      if (currentConsensus.consensusScore >= 0.85) {
        console.log(`[Moderator] High consensus reached (${(currentConsensus.consensusScore * 100).toFixed(0)}%), ending debate early`);
        break;
      }

      // Early termination if no progress (consensus shift near 0 for 2 rounds)
      if (roundNum >= 2) {
        const recentShifts = session.rounds.slice(-2).map(r => Math.abs(r.consensusShift || 0));
        if (recentShifts.every(s => s < 0.05)) {
          console.log(`[Moderator] Minimal progress, ending debate`);
          break;
        }
      }
    }

    // Finalize session
    const finalConsensus = this.calculateConsensusScore(currentOpinions);
    session.finalConsensusScore = finalConsensus.consensusScore;
    session.status = "completed";
    session.completedAt = now();

    console.log(`[Moderator] Debate completed. Final consensus: ${(finalConsensus.consensusScore * 100).toFixed(0)}%`);
    console.log(`  - Position changes: ${session.positionChanges.length}`);
    console.log(`  - Total messages: ${allMessages.length}`);

    return session;
  }

  /**
   * Get a DecisionPacket from a completed debate session
   */
  getDecisionPacketFromDebate(session: DebateSession): DecisionPacket {
    // Use the final opinions (with any stance changes applied)
    const finalOpinions = session.initialOpinions.map(opinion => {
      const changes = session.positionChanges.filter(c => c.agentId === opinion.agentId);
      if (changes.length > 0) {
        const lastChange = changes[changes.length - 1];
        return { ...opinion, stance: lastChange.toStance };
      }
      return opinion;
    });

    return this.synthesizeRuleBased(session.issue, finalOpinions);
  }

  private determineRoundTopic(
    roundNum: number,
    opinions: AgentOpinion[],
    history: DiscussionMessage[]
  ): string {
    if (roundNum === 1) {
      // First round: focus on main disagreements
      const opposingAgents = opinions.filter(o => o.stance.includes("oppose"));
      if (opposingAgents.length > 0) {
        return `Addressing concerns raised by ${opposingAgents.map(o => o.role).join(", ")}`;
      }
      return "Initial position clarification and key concerns";
    }

    if (roundNum === 2) {
      // Second round: focus on finding common ground
      return "Finding common ground and exploring alternatives";
    }

    // Later rounds: resolve remaining disagreements
    const unresolvedTopics = this.findUnresolvedPoints(history, opinions);
    if (unresolvedTopics.length > 0) {
      return `Resolving: ${unresolvedTopics[0]}`;
    }

    return "Final consensus building";
  }

  private extractKeyInsights(messages: DiscussionMessage[]): string[] {
    const insights: string[] = [];

    // Extract key points from messages
    const allKeyPoints = messages.flatMap(m => m.keyPoints);
    const uniquePoints = [...new Set(allKeyPoints)];

    // Prioritize concession and support messages
    const concessions = messages.filter(m => m.messageType === "concession");
    const supports = messages.filter(m => m.messageType === "support");

    if (concessions.length > 0) {
      insights.push(`${concessions.length} agent(s) adjusted position based on discussion`);
    }

    if (supports.length > 0) {
      insights.push(`Agreement found on: ${supports[0].keyPoints[0] || "key issues"}`);
    }

    // Add top unique points
    insights.push(...uniquePoints.slice(0, 3));

    return insights.slice(0, 5);
  }

  private findUnresolvedPoints(
    messages: DiscussionMessage[],
    opinions: AgentOpinion[]
  ): string[] {
    const unresolved: string[] = [];

    // Find rebuttals that weren't followed by concession or support
    const rebuttals = messages.filter(m => m.messageType === "rebuttal");

    for (const rebuttal of rebuttals) {
      const hasResponse = messages.some(
        m =>
          m.targetAgentRole === rebuttal.speakerRole &&
          (m.messageType === "concession" || m.messageType === "support")
      );

      if (!hasResponse && rebuttal.keyPoints[0]) {
        unresolved.push(rebuttal.keyPoints[0]);
      }
    }

    // Find agents still strongly opposing
    const strongOpposers = opinions.filter(o => o.stance === "strongly_oppose");
    for (const opposer of strongOpposers) {
      if (opposer.concerns[0]) {
        unresolved.push(`${opposer.role}: ${opposer.concerns[0]}`);
      }
    }

    return [...new Set(unresolved)].slice(0, 3);
  }

  private async synthesizeWithLLM(
    issue: DetectedIssue,
    opinions: AgentOpinion[]
  ): Promise<DecisionPacket> {
    const prompt = this.buildSynthesisPrompt(issue, opinions);
    const response = await this.llmClient.chat(this.systemPrompt, prompt);
    return this.parseSynthesisResponse(issue, opinions, response.content);
  }

  /**
   * Calculate consensus score (0-1) based on agent opinions.
   * Higher score = stronger agreement and confidence.
   */
  private calculateConsensusScore(opinions: AgentOpinion[]): {
    consensusScore: number;
    averageScore: number;
    avgConfidence: number;
  } {
    const stanceScores = {
      strongly_support: 2,
      support: 1,
      neutral: 0,
      oppose: -1,
      strongly_oppose: -2,
    };

    if (opinions.length === 0) {
      return { consensusScore: 0, averageScore: 0, avgConfidence: 0 };
    }

    let totalScore = 0;
    let totalWeight = 0;

    for (const opinion of opinions) {
      const weight = opinion.confidence;
      totalScore += stanceScores[opinion.stance] * weight;
      totalWeight += weight;
    }

    const averageScore = totalWeight > 0 ? totalScore / totalWeight : 0;
    const avgConfidence = totalWeight > 0 ? totalWeight / opinions.length : 0;

    // Calculate consensus: how much agents agree with each other
    // 1. Agreement factor: all agents have similar stances (low variance)
    const stanceValues = opinions.map((o) => stanceScores[o.stance]);
    const meanStance = stanceValues.reduce((a, b) => a + b, 0) / stanceValues.length;
    const variance = stanceValues.reduce((sum, s) => sum + Math.pow(s - meanStance, 2), 0) / stanceValues.length;
    const stdDev = Math.sqrt(variance);
    // Max possible stdDev is ~2 (when half strongly_support, half strongly_oppose)
    const agreementFactor = Math.max(0, 1 - stdDev / 2);

    // 2. Confidence factor: average confidence of agents
    const confidenceFactor = avgConfidence;

    // 3. Direction factor: are they leaning support or oppose?
    // Normalize averageScore from [-2, 2] to [0, 1]
    const normalizedDirection = (averageScore + 2) / 4;

    // Consensus score combines agreement, confidence, and direction
    // Weight: agreement 40%, confidence 30%, direction strength 30%
    const directionStrength = Math.abs(normalizedDirection - 0.5) * 2; // 0 at neutral, 1 at extremes
    const consensusScore = (agreementFactor * 0.4) + (confidenceFactor * 0.3) + (directionStrength * 0.3);

    return { consensusScore: Math.min(1, Math.max(0, consensusScore)), averageScore, avgConfidence };
  }

  /**
   * Determine recommended proposal type based on consensus score.
   * score >= 0.5 → action (clear consensus, ready for execution)
   * score < 0.5 → investigation (unclear, needs more research)
   */
  private determineProposalType(consensusScore: number, _averageScore: number): ProposalType {
    // High consensus with clear direction → action
    if (consensusScore >= 0.5) {
      return "action";
    }
    // Low consensus or mixed opinions → investigation
    return "investigation";
  }

  private synthesizeRuleBased(
    issue: DetectedIssue,
    opinions: AgentOpinion[]
  ): DecisionPacket {
    // Calculate consensus metrics
    const { consensusScore, averageScore } = this.calculateConsensusScore(opinions);
    const recommendedProposalType = this.determineProposalType(consensusScore, averageScore);

    // Collect all concerns and recommendations from agents
    const allConcerns = [...new Set(opinions.flatMap((o) => o.concerns))];
    const allRecommendations = [...new Set(opinions.flatMap((o) => o.recommendations))];

    // Determine recommendation based on issue content and agent consensus
    let action: string;
    let rationale: string;

    if (averageScore >= 1) {
      action = `Approve: Address "${issue.title}"`;
      rationale = `Strong agent consensus (score: ${averageScore.toFixed(2)}) supports immediate action on this ${issue.priority} priority ${issue.category} issue.`;
    } else if (averageScore >= 0.3) {
      action = `Conditional Approval: "${issue.title}"`;
      rationale = `Moderate support (score: ${averageScore.toFixed(2)}) with conditions. Key concerns: ${allConcerns.slice(0, 2).join("; ")}.`;
    } else if (averageScore >= -0.3) {
      action = `Further Analysis Required: "${issue.title}"`;
      rationale = `Mixed agent opinions (score: ${averageScore.toFixed(2)}) on this ${issue.category} issue. Needs additional community input and data.`;
    } else if (averageScore >= -1) {
      action = `Reconsider: "${issue.title}"`;
      rationale = `Significant concerns (score: ${averageScore.toFixed(2)}) raised. Primary issues: ${allConcerns.slice(0, 2).join("; ")}.`;
    } else {
      action = `Reject: "${issue.title}"`;
      rationale = `Strong opposition (score: ${averageScore.toFixed(2)}). Major concerns must be addressed before resubmission.`;
    }

    // Identify dissent
    const dissent = opinions
      .filter((o) => o.stance === "oppose" || o.stance === "strongly_oppose")
      .map((o) => ({
        agentRole: o.role,
        reason: o.reasoning,
      }));

    // Generate issue-specific alternatives
    const alternatives = this.generateAlternatives(issue, allRecommendations);

    // Generate issue-specific KPIs
    const kpis = this.generateKPIs(issue);

    // Generate issue-specific risks from agent concerns
    const risks = this.generateRisks(issue, allConcerns);

    // Build expected outcome from issue description and recommendations
    const expectedOutcome = this.buildExpectedOutcome(issue, allRecommendations);

    return {
      id: generateId(),
      issueId: issue.id,
      issue,
      consensusScore,
      recommendedProposalType,
      recommendation: {
        action,
        rationale,
        expectedOutcome,
      },
      alternatives,
      risks,
      kpis,
      agentOpinions: opinions,
      dissent,
      createdAt: now(),
    };
  }

  private generateAlternatives(
    issue: DetectedIssue,
    recommendations: string[]
  ): DecisionPacket["alternatives"] {
    const categoryActions: Record<string, { fast: string; moderate: string; defer: string }> = {
      treasury: {
        fast: "Immediate treasury action",
        moderate: "Phased treasury adjustment over 7 days",
        defer: "Monitor treasury metrics for 30 days",
      },
      protocol: {
        fast: "Deploy protocol update immediately",
        moderate: "Staged rollout with testing period",
        defer: "Schedule for next protocol upgrade cycle",
      },
      community: {
        fast: "Direct community announcement",
        moderate: "Community discussion period (1 week)",
        defer: "Gather more community feedback",
      },
      security: {
        fast: "Emergency security patch",
        moderate: "Security audit then deploy",
        defer: "Long-term security review",
      },
    };

    const actions = categoryActions[issue.category] || {
      fast: `Immediate action on ${issue.title}`,
      moderate: `Phased approach to ${issue.title}`,
      defer: `Defer ${issue.title} for further analysis`,
    };

    const topRecs = recommendations.slice(0, 2);

    return [
      {
        action: actions.fast,
        pros: [
          `Quick resolution of ${issue.category} issue`,
          issue.priority === "urgent" ? "Addresses urgent timeline" : "Prevents escalation",
        ],
        cons: [
          "Limited review time",
          topRecs[0] ? `May not fully address: ${topRecs[0]}` : "Risk of incomplete solution",
        ],
      },
      {
        action: actions.moderate,
        pros: [
          "Balanced approach with review period",
          "Allows for adjustments based on feedback",
        ],
        cons: [
          issue.priority === "urgent" ? "May be too slow for urgent issue" : "Extended timeline",
          "Requires ongoing coordination",
        ],
      },
      {
        action: actions.defer,
        pros: [
          "More data for informed decision",
          "Lower risk of unintended consequences",
        ],
        cons: [
          `${issue.title} remains unresolved`,
          issue.priority === "high" ? "High priority issue delayed" : "Potential for escalation",
        ],
      },
    ];
  }

  private generateKPIs(issue: DetectedIssue): DecisionPacket["kpis"] {
    const baseKPIs = [
      {
        name: "Resolution Time",
        target: issue.priority === "urgent" ? 24 : issue.priority === "high" ? 72 : 168,
        unit: "hours",
        measurementMethod: `Time from approval to ${issue.title} resolution`,
      },
    ];

    // Category-specific KPIs
    const categoryKPIs: Record<string, Array<{ name: string; target: number; unit: string; measurementMethod: string }>> = {
      treasury: [
        { name: "Treasury Balance Impact", target: 0, unit: "percent deviation", measurementMethod: "Compare treasury balance before/after" },
        { name: "Transaction Success Rate", target: 100, unit: "percent", measurementMethod: "Successful vs failed treasury operations" },
      ],
      protocol: [
        { name: "Protocol Uptime", target: 99.9, unit: "percent", measurementMethod: "System availability after changes" },
        { name: "Error Rate", target: 0, unit: "errors per hour", measurementMethod: "Monitor error logs post-deployment" },
      ],
      community: [
        { name: "Community Engagement", target: 50, unit: "responses", measurementMethod: "Community feedback count within 7 days" },
        { name: "Sentiment Score", target: 70, unit: "percent positive", measurementMethod: "Analyze community reaction sentiment" },
      ],
      security: [
        { name: "Vulnerability Status", target: 0, unit: "open vulnerabilities", measurementMethod: "Security scan after mitigation" },
        { name: "Incident Recurrence", target: 0, unit: "incidents", measurementMethod: "Similar security events within 30 days" },
      ],
    };

    const specific = categoryKPIs[issue.category] || [
      { name: "Issue Recurrence", target: 0, unit: "occurrences", measurementMethod: `Similar ${issue.category} issues within 30 days` },
    ];

    return [...baseKPIs, ...specific];
  }

  private generateRisks(
    issue: DetectedIssue,
    concerns: string[]
  ): DecisionPacket["risks"] {
    const risks: DecisionPacket["risks"] = [];

    // Convert agent concerns to risks
    const uniqueConcerns = concerns.filter((c, i) =>
      concerns.indexOf(c) === i &&
      c.length > 10 &&
      !c.toLowerCase().includes("standard") &&
      !c.toLowerCase().includes("routine")
    );

    for (const concern of uniqueConcerns.slice(0, 3)) {
      risks.push({
        description: concern,
        likelihood: issue.priority === "urgent" ? "high" : issue.priority === "high" ? "medium" : "low",
        impact: issue.priority === "urgent" || issue.priority === "high" ? "high" : "medium",
        mitigation: this.suggestMitigation(concern, issue.category),
      });
    }

    // Add category-specific risk if not enough from concerns
    if (risks.length < 2) {
      const categoryRisks: Record<string, { description: string; mitigation: string }> = {
        treasury: {
          description: "Treasury operations may affect token economics",
          mitigation: "Implement transaction limits and multi-sig approval",
        },
        protocol: {
          description: "Protocol changes may introduce regression bugs",
          mitigation: "Comprehensive testing on testnet before mainnet deployment",
        },
        community: {
          description: "Community response may differ from expectations",
          mitigation: "Phased communication with feedback loops",
        },
        security: {
          description: "Security fix may have incomplete coverage",
          mitigation: "Third-party security audit before deployment",
        },
      };

      const categoryRisk = categoryRisks[issue.category] || {
        description: `Addressing ${issue.title} may have unforeseen effects`,
        mitigation: "Monitor closely after implementation",
      };

      risks.push({
        description: categoryRisk.description,
        likelihood: "medium",
        impact: "medium",
        mitigation: categoryRisk.mitigation,
      });
    }

    return risks;
  }

  private suggestMitigation(concern: string, category: string): string {
    const lowerConcern = concern.toLowerCase();

    if (lowerConcern.includes("security") || lowerConcern.includes("vulnerability")) {
      return "Conduct security audit and implement protective measures";
    }
    if (lowerConcern.includes("urgent") || lowerConcern.includes("immediate")) {
      return "Establish emergency response protocol with clear escalation path";
    }
    if (lowerConcern.includes("risk") || lowerConcern.includes("implementation")) {
      return "Implement staged rollout with rollback capability";
    }
    if (lowerConcern.includes("monitor") || lowerConcern.includes("escalation")) {
      return "Set up real-time monitoring and alerting system";
    }
    if (lowerConcern.includes("test")) {
      return "Execute comprehensive test suite before deployment";
    }

    // Category-based default
    const categoryMitigations: Record<string, string> = {
      treasury: "Review with treasury committee before execution",
      protocol: "Test on staging environment with gradual rollout",
      community: "Gather community feedback through governance forum",
      security: "Engage security team for review and approval",
    };

    return categoryMitigations[category] || "Review thoroughly before proceeding";
  }

  private buildExpectedOutcome(
    issue: DetectedIssue,
    recommendations: string[]
  ): string {
    const topRec = recommendations[0] || "standard procedures";

    const categoryOutcomes: Record<string, string> = {
      treasury: `Treasury stability restored with ${issue.title} addressed. Expected improvement in financial metrics through ${topRec}.`,
      protocol: `Protocol performance optimized after resolving ${issue.title}. System reliability improved via ${topRec}.`,
      community: `Community concerns regarding ${issue.title} addressed. Enhanced engagement through ${topRec}.`,
      security: `Security posture strengthened after mitigating ${issue.title}. Reduced vulnerability exposure through ${topRec}.`,
    };

    return categoryOutcomes[issue.category] ||
      `${issue.title} successfully resolved. ${issue.description.slice(0, 100)}${issue.description.length > 100 ? "..." : ""} Expected improvement through ${topRec}.`;
  }

  private buildSynthesisPrompt(
    issue: DetectedIssue,
    opinions: AgentOpinion[]
  ): string {
    const opinionsText = opinions
      .map(
        (o) => `
### ${o.role.toUpperCase()} Agent
- Stance: ${o.stance}
- Confidence: ${(o.confidence * 100).toFixed(0)}%
- Reasoning: ${o.reasoning}
- Concerns: ${o.concerns.join(", ")}
- Recommendations: ${o.recommendations.join(", ")}
`
      )
      .join("\n");

    return `
## Issue Summary
**Title:** ${issue.title}
**Category:** ${issue.category}
**Priority:** ${issue.priority}
**Description:** ${issue.description}

## Agent Opinions
${opinionsText}

---

Please synthesize these opinions into a Decision Packet with:
1. A clear recommendation (action, rationale, expected outcome)
2. 2-3 alternatives with pros/cons
3. Key risks with likelihood, impact, and mitigation
4. 3-5 measurable KPIs
5. Any dissenting opinions

Respond in JSON format matching the DecisionPacket schema.
`;
  }

  private parseSynthesisResponse(
    issue: DetectedIssue,
    opinions: AgentOpinion[],
    response: string
  ): DecisionPacket {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Calculate consensus metrics from opinions
      const { consensusScore, averageScore } = this.calculateConsensusScore(opinions);
      const recommendedProposalType = this.determineProposalType(consensusScore, averageScore);

      return {
        id: generateId(),
        issueId: issue.id,
        issue,
        consensusScore,
        recommendedProposalType,
        recommendation: parsed.recommendation || {
          action: "Review required",
          rationale: "LLM response parsing incomplete",
          expectedOutcome: "To be determined",
        },
        alternatives: parsed.alternatives || [],
        risks: parsed.risks || [],
        kpis: parsed.kpis || [],
        agentOpinions: opinions,
        dissent: parsed.dissent || [],
        createdAt: now(),
      };
    } catch (error) {
      // Fallback to rule-based synthesis
      return this.synthesizeRuleBased(issue, opinions);
    }
  }
}
