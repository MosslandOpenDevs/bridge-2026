import { AgentRole, DetectedIssue, AgentContext, AgentOpinion } from "@oracle/core";
import { BaseAgent, LLMConfig } from "./base.js";

export class RiskAgent extends BaseAgent {
  readonly id = "risk-agent";
  readonly role: AgentRole = "risk";

  protected readonly systemPrompt = `You are a Risk Analysis Agent in a decentralized governance system.

Your role is to:
1. Identify potential security vulnerabilities and threats
2. Assess the risk level of proposed actions
3. Evaluate potential negative consequences
4. Recommend safeguards and mitigation strategies

You should be conservative and prioritize system stability and security.
Always consider worst-case scenarios and edge cases.
Your analysis should help protect the system and its users from harm.`;

  constructor(config: LLMConfig = {}) {
    super(config);
  }

  protected deliberateRuleBased(
    issue: DetectedIssue,
    _context: AgentContext
  ): AgentOpinion {
    let stance: AgentOpinion["stance"] = "neutral";
    let confidence = 0.5;
    const concerns: string[] = [];
    const recommendations: string[] = [];

    // Check category relevance
    const categoryRelevance = this.getCategoryRelevanceScore(issue.category);
    const isCategoryRelevant = this.isCategoryRelevant(issue.category);

    // Rule-based risk assessment
    const signals = issue.signals || [];
    const hasHighSeveritySignals = signals.some(
      (s) => s.severity === "critical" || s.severity === "high"
    );

    const hasSecurityKeywords = [issue.title, issue.description]
      .join(" ")
      .toLowerCase()
      .match(/security|vulnerability|attack|exploit|breach|leak|network_health|gas_usage|protocol_tvl/);

    // Boost confidence when category is relevant to this agent
    const confidenceBoost = isCategoryRelevant ? 0.2 : 0;

    if (issue.priority === "urgent") {
      stance = "strongly_support";
      confidence = Math.min(0.95, 0.85 + confidenceBoost);
      concerns.push("Urgent priority requires immediate attention");
      recommendations.push("Implement emergency response procedures");
    } else if (hasSecurityKeywords || isCategoryRelevant) {
      stance = "strongly_support";
      confidence = Math.min(0.95, 0.75 + confidenceBoost);
      if (isCategoryRelevant) {
        concerns.push(`${issue.category} falls within risk management domain`);
      }
      if (hasSecurityKeywords) {
        concerns.push("Potential security implications detected");
      }
      recommendations.push("Conduct thorough security review");
      recommendations.push("Consider temporary protective measures");
    } else if (hasHighSeveritySignals) {
      stance = "support";
      confidence = Math.min(0.9, 0.65 + confidenceBoost);
      concerns.push("High severity signals require attention");
      recommendations.push("Monitor closely for escalation");
    } else if (issue.priority === "high") {
      stance = "support";
      confidence = Math.min(0.85, 0.6 + confidenceBoost);
      concerns.push("Elevated risk level");
    } else {
      stance = "neutral";
      confidence = Math.max(0.4, 0.5 * categoryRelevance);
      concerns.push("Standard risk profile");
      recommendations.push("Continue routine monitoring");
    }

    // Add general risk concerns
    concerns.push("All actions carry inherent implementation risk");
    recommendations.push("Ensure proper testing before deployment");

    // Build context-aware reasoning
    const reasoning = this.buildReasoning(issue, stance, hasSecurityKeywords, hasHighSeveritySignals, isCategoryRelevant);

    return this.createOpinion(
      issue.id,
      stance,
      confidence,
      reasoning,
      concerns,
      recommendations
    );
  }

  private buildReasoning(
    issue: DetectedIssue,
    stance: AgentOpinion["stance"],
    hasSecurityKeywords: RegExpMatchArray | null,
    hasHighSeveritySignals: boolean,
    isCategoryRelevant: boolean
  ): string {
    const parts: string[] = [];
    const signals = issue.signals || [];

    // Describe the issue being analyzed
    parts.push(`Analyzing "${issue.title}" (${issue.category} issue, ${issue.priority} priority).`);

    // Explain category relevance
    if (isCategoryRelevant) {
      parts.push(`This ${issue.category} issue falls within my risk assessment expertise.`);
    }

    // Explain the stance
    if (hasSecurityKeywords) {
      parts.push("Security-related keywords detected require heightened vigilance.");
    }
    if (hasHighSeveritySignals) {
      const highCount = signals.filter(s => s.severity === "critical" || s.severity === "high").length;
      parts.push(`${highCount} high/critical severity signals identified.`);
    }
    if (issue.priority === "urgent") {
      parts.push("Urgent priority warrants immediate risk mitigation measures.");
    }

    // Add signal context if available
    if (signals.length > 0) {
      const topSignal = signals[0];
      parts.push(`Primary signal: ${topSignal.description || topSignal.category} (severity: ${topSignal.severity}).`);
    }

    return parts.join(" ");
  }
}
