import {
  GovernanceAgent,
  AgentRole,
  AgentOpinion,
  DetectedIssue,
  AgentContext,
  DiscussionMessage,
  Stance,
  generateId,
  now,
} from "@oracle/core";
import { LLMClient } from "../llm/index.js";
import type { LLMConfig } from "../llm/index.js";

export type { LLMConfig };

// Category mapping for each agent role
export const AGENT_CATEGORY_MAPPING: Record<AgentRole, string[]> = {
  risk: [
    "security",
    "vulnerability",
    "network_health",
    "gas_usage",
    "protocol_tvl",
    "anomaly",
  ],
  treasury: [
    "token_price",
    "moc_price",
    "moc_market",
    "moc_blockchain",
    "protocol_tvl",
    "treasury",
    "transaction_volume",
  ],
  community: [
    "vote_turnout",
    "governance_participation",
    "community_sentiment",
    "delegation_changes",
    "proposal_activity",
    "medium_activity",
    "medium_post",
    "twitter_activity",
    "social",
  ],
  product: [
    "github_commit",
    "github_activity",
    "mossland_disclosure",
    "product_update",
    "feature",
    "roadmap",
  ],
  moderator: [], // Moderator doesn't have specific categories
};

export abstract class BaseAgent implements GovernanceAgent {
  abstract readonly id: string;
  abstract readonly role: AgentRole;
  protected abstract readonly systemPrompt: string;

  protected llmClient: LLMClient;
  protected relevantCategories: string[];

  constructor(config: LLMConfig = {}) {
    this.llmClient = new LLMClient({
      ...config,
      maxTokens: config.maxTokens || 2048,
    });
    this.relevantCategories = [];
  }

  /**
   * Check if a category is relevant to this agent's expertise
   */
  protected isCategoryRelevant(category: string): boolean {
    const agentCategories = AGENT_CATEGORY_MAPPING[this.role] || [];
    const lowerCategory = category.toLowerCase();
    return agentCategories.some(c =>
      lowerCategory.includes(c) || c.includes(lowerCategory)
    );
  }

  /**
   * Get relevance score (0-1) for how well this agent matches the category
   */
  protected getCategoryRelevanceScore(category: string): number {
    if (this.isCategoryRelevant(category)) {
      return 1.0; // Full relevance
    }
    // Check for partial matches
    const agentCategories = AGENT_CATEGORY_MAPPING[this.role] || [];
    const lowerCategory = category.toLowerCase();
    for (const c of agentCategories) {
      if (lowerCategory.split("_").some(part => c.includes(part))) {
        return 0.5; // Partial relevance
      }
    }
    return 0.3; // Low relevance but still can contribute
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

  async deliberate(
    issue: DetectedIssue,
    context: AgentContext
  ): Promise<AgentOpinion> {
    const prompt = this.buildPrompt(issue, context);

    if (this.llmClient.isAvailable) {
      try {
        return await this.deliberateWithLLM(issue, prompt);
      } catch (error) {
        console.error(`[${this.id}] LLM deliberation failed, falling back to rule-based:`, error);
        return this.deliberateRuleBased(issue, context);
      }
    }

    // Fallback to rule-based deliberation
    return this.deliberateRuleBased(issue, context);
  }

  protected async deliberateWithLLM(
    issue: DetectedIssue,
    prompt: string
  ): Promise<AgentOpinion> {
    const response = await this.llmClient.chat(this.systemPrompt, prompt);
    return this.parseResponse(issue.id, response.content);
  }

  protected abstract deliberateRuleBased(
    issue: DetectedIssue,
    context: AgentContext
  ): AgentOpinion;

  protected buildPrompt(issue: DetectedIssue, context: AgentContext): string {
    // Handle signals - may be full objects or just IDs from database
    const signals = issue.signals || [];
    const signalsSection = signals.length > 0
      ? signals.slice(0, 5).map((s: any) => `- [${s.severity}] ${s.description} (value: ${s.value})`).join("\n")
      : "(Signal data not available - refer to evidence for details)";

    // Handle evidence safely
    const evidenceSection = (issue.evidence || [])
      .map((e) => `- ${e.description}`)
      .join("\n") || "(No evidence available)";

    // Build historical context section if available
    const historicalSection = this.buildHistoricalSection(context);

    return `
## Issue for Deliberation

**Title:** ${issue.title}
**Category:** ${issue.category}
**Priority:** ${issue.priority}
**Description:** ${issue.description}

### Evidence
${evidenceSection}

### Signals
${signalsSection}
${historicalSection}
### Context
${JSON.stringify(this.filterContextForPrompt(context), null, 2)}

---

Please provide your analysis as a ${this.role} agent. Include:
1. Your stance (strongly_support, support, neutral, oppose, strongly_oppose)
2. Confidence level (0-1)
3. Key reasoning
4. Any concerns
5. Recommendations

${historicalSection ? "Consider the historical patterns and your past performance when forming your opinion." : ""}

Respond in JSON format:
{
  "stance": "support",
  "confidence": 0.8,
  "reasoning": "...",
  "concerns": ["..."],
  "recommendations": ["..."]
}
`;
  }

  /**
   * Build historical context section for prompt
   */
  protected buildHistoricalSection(context: AgentContext): string {
    const ctx = context as any; // Extended context with learning data

    if (!ctx.historicalDecisions || ctx.historicalDecisions.length === 0) {
      return "";
    }

    const sections: string[] = [];

    // Historical decisions for this category
    if (ctx.historicalDecisions && ctx.historicalDecisions.length > 0) {
      const decisionsText = ctx.historicalDecisions
        .slice(0, 3)
        .map((d: any) => {
          const myOpinion = d.agentOpinions?.find((o: any) => o.agentRole === this.role);
          const outcomeText = d.outcomeStatus === "completed"
            ? `${(d.outcomeSuccessRate * 100).toFixed(0)}% success`
            : "pending";
          const stanceText = myOpinion ? `, your stance: ${myOpinion.stance}` : "";
          return `- [${d.priority}] Consensus: ${(d.consensusScore * 100).toFixed(0)}%, Outcome: ${outcomeText}${stanceText}`;
        })
        .join("\n");

      sections.push(`### Historical Context (Similar ${ctx.historicalDecisions[0]?.category || "category"} issues)
${decisionsText}`);
    }

    // Agent performance feedback
    if (ctx.agentFeedback && ctx.agentFeedback.length > 0) {
      const myFeedback = ctx.agentFeedback.find((f: any) => f.agentRole === this.role);
      if (myFeedback && myFeedback.totalDecisions > 0) {
        sections.push(`### Your Performance History
- Accuracy: ${(myFeedback.accuracy * 100).toFixed(0)}% (${myFeedback.correctDecisions}/${myFeedback.totalDecisions} decisions)
- Average confidence: ${(myFeedback.avgConfidence * 100).toFixed(0)}%`);
      }
    }

    // Category success rate
    if (ctx.categorySuccessRate !== undefined) {
      sections.push(`### Category Pattern
- Average success rate for similar issues: ${(ctx.categorySuccessRate * 100).toFixed(0)}%`);
    }

    // Identified patterns
    if (ctx.patterns && ctx.patterns.length > 0) {
      sections.push(`### Identified Patterns
${ctx.patterns.map((p: string) => `- ${p}`).join("\n")}`);
    }

    if (sections.length === 0) {
      return "";
    }

    return "\n" + sections.join("\n\n") + "\n";
  }

  /**
   * Filter context for prompt (remove large arrays to save tokens)
   */
  protected filterContextForPrompt(context: AgentContext): any {
    // `patterns` is dropped from the prompt deliberately; the other two are
    // summarized below rather than passed through in full.
    const { historicalDecisions, agentFeedback, patterns: _patterns, ...rest } = context as any;
    return {
      ...rest,
      hasHistoricalData: !!historicalDecisions && historicalDecisions.length > 0,
      agentFeedbackSummary: agentFeedback
        ? agentFeedback.map((f: any) => ({ role: f.agentRole, accuracy: f.accuracy }))
        : undefined,
    };
  }

  protected parseResponse(issueId: string, response: string): AgentOpinion {
    try {
      // Extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        agentId: this.id,
        role: this.role,
        issueId,
        stance: parsed.stance || "neutral",
        confidence: parsed.confidence || 0.5,
        reasoning: parsed.reasoning || "",
        concerns: parsed.concerns || [],
        recommendations: parsed.recommendations || [],
        timestamp: now(),
      };
    } catch (error) {
      // Return neutral opinion on parse failure
      return {
        agentId: this.id,
        role: this.role,
        issueId,
        stance: "neutral",
        confidence: 0.3,
        reasoning: "Failed to parse LLM response",
        concerns: ["Analysis inconclusive"],
        recommendations: ["Require human review"],
        timestamp: now(),
      };
    }
  }

  protected createOpinion(
    issueId: string,
    stance: AgentOpinion["stance"],
    confidence: number,
    reasoning: string,
    concerns: string[],
    recommendations: string[]
  ): AgentOpinion {
    return {
      agentId: this.id,
      role: this.role,
      issueId,
      stance,
      confidence,
      reasoning,
      concerns,
      recommendations,
      timestamp: now(),
    };
  }

  /**
   * Respond to other agents' opinions in a debate round
   */
  async respond(
    issue: DetectedIssue,
    otherOpinions: AgentOpinion[],
    discussionHistory: DiscussionMessage[],
    context: AgentContext
  ): Promise<DiscussionMessage> {
    if (this.llmClient.isAvailable) {
      try {
        return await this.respondWithLLM(issue, otherOpinions, discussionHistory, context);
      } catch (error) {
        console.error(`[${this.id}] LLM response failed, falling back to rule-based:`, error);
        return this.respondRuleBased(issue, otherOpinions, discussionHistory);
      }
    }
    return this.respondRuleBased(issue, otherOpinions, discussionHistory);
  }

  protected async respondWithLLM(
    issue: DetectedIssue,
    otherOpinions: AgentOpinion[],
    discussionHistory: DiscussionMessage[],
    _context: AgentContext
  ): Promise<DiscussionMessage> {
    const prompt = this.buildResponsePrompt(issue, otherOpinions, discussionHistory);
    const systemPrompt = `${this.systemPrompt}

You are now participating in a debate with other agents. Respond to their opinions thoughtfully.
Consider points of agreement and disagreement. Be specific about which agent's points you're addressing.
You may agree, disagree, offer clarifications, or present new perspectives.`;

    const response = await this.llmClient.chat(systemPrompt, prompt);
    return this.parseResponseMessage(issue, otherOpinions, discussionHistory, response.content);
  }

  protected buildResponsePrompt(
    issue: DetectedIssue,
    otherOpinions: AgentOpinion[],
    discussionHistory: DiscussionMessage[]
  ): string {
    const opinionsText = otherOpinions
      .filter(o => o.agentId !== this.id)
      .map(o => `
**${o.role.toUpperCase()} Agent** (${o.stance}, ${(o.confidence * 100).toFixed(0)}% confidence):
- Reasoning: ${o.reasoning}
- Concerns: ${o.concerns.join("; ")}
- Recommendations: ${o.recommendations.join("; ")}
`)
      .join("\n");

    const historyText = discussionHistory.length > 0
      ? discussionHistory.map(m => `
[Round ${m.roundNumber}] ${m.speakerRole.toUpperCase()}: ${m.content}
Key points: ${m.keyPoints.join("; ")}
`).join("\n")
      : "(No prior discussion)";

    return `
## Issue: ${issue.title}
**Category:** ${issue.category} | **Priority:** ${issue.priority}
**Description:** ${issue.description}

## Other Agents' Opinions
${opinionsText}

## Discussion History
${historyText}

---

As the ${this.role} agent, respond to the other agents' opinions.
You may:
1. Rebut specific points you disagree with
2. Support points you agree with
3. Offer clarifications on misunderstandings
4. Present new considerations

Respond in JSON format:
{
  "messageType": "rebuttal" | "support" | "clarification" | "concession",
  "targetAgentRole": "risk" | "treasury" | "community" | "product" | null,
  "content": "Your response...",
  "keyPoints": ["Point 1", "Point 2"],
  "referencedPoints": ["Point from other agent you're responding to"]
}
`;
  }

  protected parseResponseMessage(
    issue: DetectedIssue,
    otherOpinions: AgentOpinion[],
    discussionHistory: DiscussionMessage[],
    response: string
  ): DiscussionMessage {
    const currentRound = discussionHistory.length > 0
      ? Math.max(...discussionHistory.map(m => m.roundNumber)) + 1
      : 1;

    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const targetOpinion = parsed.targetAgentRole
        ? otherOpinions.find(o => o.role === parsed.targetAgentRole)
        : null;

      return {
        id: generateId(),
        roundNumber: currentRound,
        speakerId: this.id,
        speakerRole: this.role,
        targetAgentId: targetOpinion?.agentId,
        targetAgentRole: parsed.targetAgentRole || undefined,
        messageType: parsed.messageType || "rebuttal",
        content: parsed.content || "No response content",
        keyPoints: parsed.keyPoints || [],
        referencedPoints: parsed.referencedPoints || [],
        timestamp: now(),
      };
    } catch (error) {
      return this.respondRuleBased(issue, otherOpinions, discussionHistory);
    }
  }

  protected respondRuleBased(
    issue: DetectedIssue,
    otherOpinions: AgentOpinion[],
    discussionHistory: DiscussionMessage[]
  ): DiscussionMessage {
    const currentRound = discussionHistory.length > 0
      ? Math.max(...discussionHistory.map(m => m.roundNumber)) + 1
      : 1;

    // Find opinion with most different stance
    const opposingOpinion = otherOpinions
      .filter(o => o.agentId !== this.id)
      .find(o => o.stance.includes("oppose") || o.stance === "neutral");

    const supportingOpinion = otherOpinions
      .filter(o => o.agentId !== this.id)
      .find(o => o.stance.includes("support"));

    const targetOpinion = opposingOpinion || supportingOpinion || otherOpinions[0];
    let messageType: DiscussionMessage["messageType"] = "clarification";
    let content = "";
    let keyPoints: string[] = [];

    if (targetOpinion) {
      if (targetOpinion.stance.includes("oppose")) {
        messageType = "rebuttal";
        content = `Regarding ${targetOpinion.role}'s concerns about ${issue.title}: From my ${this.role} perspective, ${this.getExpertiseContext(issue)}. While I acknowledge the concerns raised, I believe we should consider ${this.getCounterpoint(issue)}.`;
        keyPoints = [
          `${this.role} expertise addresses ${targetOpinion.concerns[0] || "key concern"}`,
          `Recommend balanced approach considering ${issue.category} factors`,
        ];
      } else if (targetOpinion.stance.includes("support")) {
        messageType = "support";
        content = `I agree with ${targetOpinion.role}'s assessment. The ${issue.category} implications align with my ${this.role} analysis. ${targetOpinion.recommendations[0] || "The recommended approach"} is consistent with best practices in this domain.`;
        keyPoints = [
          `Alignment on ${issue.priority} priority assessment`,
          `Supporting ${targetOpinion.recommendations[0] || "proposed approach"}`,
        ];
      }
    } else {
      content = `As the ${this.role} agent, I would like to add that ${this.getExpertiseContext(issue)}. This is relevant to the current discussion about ${issue.title}.`;
      keyPoints = [`${this.role} perspective on ${issue.category}`];
    }

    return {
      id: generateId(),
      roundNumber: currentRound,
      speakerId: this.id,
      speakerRole: this.role,
      targetAgentId: targetOpinion?.agentId,
      targetAgentRole: targetOpinion?.role,
      messageType,
      content,
      keyPoints,
      referencedPoints: targetOpinion?.concerns.slice(0, 2) || [],
      timestamp: now(),
    };
  }

  protected getExpertiseContext(_issue: DetectedIssue): string {
    const contexts: Record<AgentRole, string> = {
      risk: "security and risk mitigation are paramount for sustainable governance",
      treasury: "financial stability and token economics must be carefully balanced",
      community: "community engagement and sentiment are key drivers of success",
      product: "development velocity and technical feasibility are essential considerations",
      moderator: "balanced consideration of all perspectives is necessary",
    };
    return contexts[this.role] || "this requires careful analysis";
  }

  protected getCounterpoint(_issue: DetectedIssue): string {
    const counterpoints: Record<AgentRole, string> = {
      risk: "the potential risks can be mitigated with proper safeguards",
      treasury: "the financial impact can be managed through phased implementation",
      community: "community feedback suggests broader support than initial concerns indicate",
      product: "technical implementation is feasible with current resources",
      moderator: "a balanced approach that addresses multiple concerns",
    };
    return counterpoints[this.role] || "alternative perspectives";
  }

  /**
   * Update stance based on discussion insights
   */
  async updateStance(
    currentOpinion: AgentOpinion,
    discussionHistory: DiscussionMessage[],
    context: AgentContext
  ): Promise<{ newStance: Stance; reason: string } | null> {
    if (this.llmClient.isAvailable) {
      try {
        return await this.updateStanceWithLLM(currentOpinion, discussionHistory, context);
      } catch (error) {
        console.error(`[${this.id}] LLM stance update failed:`, error);
        return this.updateStanceRuleBased(currentOpinion, discussionHistory);
      }
    }
    return this.updateStanceRuleBased(currentOpinion, discussionHistory);
  }

  protected async updateStanceWithLLM(
    currentOpinion: AgentOpinion,
    discussionHistory: DiscussionMessage[],
    _context: AgentContext
  ): Promise<{ newStance: Stance; reason: string } | null> {
    const historyText = discussionHistory.map(m => `
[Round ${m.roundNumber}] ${m.speakerRole.toUpperCase()} (${m.messageType}): ${m.content}
`).join("\n");

    const prompt = `
## Your Current Position
- Stance: ${currentOpinion.stance}
- Confidence: ${(currentOpinion.confidence * 100).toFixed(0)}%
- Reasoning: ${currentOpinion.reasoning}

## Discussion Summary
${historyText}

---

Based on the discussion, should you update your stance?
Consider:
1. Were any of your concerns addressed?
2. Were new valid points raised?
3. Has the consensus shifted?

Respond in JSON:
{
  "shouldUpdate": true/false,
  "newStance": "strongly_support" | "support" | "neutral" | "oppose" | "strongly_oppose",
  "reason": "Why you're changing or maintaining your position"
}
`;

    const response = await this.llmClient.chat(this.systemPrompt, prompt);

    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[0]);
      if (!parsed.shouldUpdate) return null;

      return {
        newStance: parsed.newStance,
        reason: parsed.reason,
      };
    } catch {
      return null;
    }
  }

  protected updateStanceRuleBased(
    currentOpinion: AgentOpinion,
    discussionHistory: DiscussionMessage[]
  ): { newStance: Stance; reason: string } | null {
    // Count supportive vs opposing messages targeting this agent
    const messagesTargetingMe = discussionHistory.filter(
      m => m.targetAgentRole === this.role
    );

    const rebuttals = messagesTargetingMe.filter(m => m.messageType === "rebuttal").length;
    const supports = messagesTargetingMe.filter(m => m.messageType === "support").length;
    const concessions = messagesTargetingMe.filter(m => m.messageType === "concession").length;

    // If more rebuttals than supports, consider softening stance
    if (rebuttals > supports + 1 && !currentOpinion.stance.includes("neutral")) {
      const stanceOrder: Stance[] = [
        "strongly_oppose",
        "oppose",
        "neutral",
        "support",
        "strongly_support",
      ];
      const currentIdx = stanceOrder.indexOf(currentOpinion.stance);
      const newIdx = currentIdx < 2 ? currentIdx + 1 : currentIdx - 1;

      return {
        newStance: stanceOrder[newIdx],
        reason: `Considering ${rebuttals} rebuttals from other agents, adjusting position to be more moderate`,
      };
    }

    // If received concessions, might strengthen stance
    if (concessions >= 2 && !currentOpinion.stance.includes("strongly")) {
      const stanceOrder: Stance[] = [
        "strongly_oppose",
        "oppose",
        "neutral",
        "support",
        "strongly_support",
      ];
      const currentIdx = stanceOrder.indexOf(currentOpinion.stance);
      const newIdx = currentIdx < 2 ? Math.max(0, currentIdx - 1) : Math.min(4, currentIdx + 1);

      if (newIdx !== currentIdx) {
        return {
          newStance: stanceOrder[newIdx],
          reason: `Other agents have conceded points, strengthening position`,
        };
      }
    }

    return null;
  }
}
