/**
 * Agent Learning Service
 *
 * Provides historical context enrichment for agent deliberation
 * and records decision outcomes for continuous learning.
 */

import { v4 as uuidv4 } from "uuid";
import {
  decisionHistoryDb,
  agentPerformanceDb,
  agentTrustDb,
} from "./db.js";

// Types
export interface HistoricalDecision {
  id: string;
  issueId: string;
  category: string;
  priority: string;
  consensusScore: number;
  recommendationType: string;
  agentOpinions: AgentOpinionSummary[];
  outcomeStatus: "pending" | "completed" | "failed";
  outcomeSuccessRate?: number;
  createdAt: string;
}

export interface AgentOpinionSummary {
  agentRole: string;
  stance: string;
  confidence: number;
  wasCorrect?: boolean;
}

export interface AgentFeedback {
  agentRole: string;
  totalDecisions: number;
  correctDecisions: number;
  accuracy: number;
  avgConfidence: number;
  categoryAccuracy?: Record<string, number>;
}

export interface EnrichedContext {
  historicalDecisions: HistoricalDecision[];
  agentFeedback: AgentFeedback[];
  categorySuccessRate: number;
  similarIssueCount: number;
  patterns: string[];
}

/**
 * Get historical decisions for a category
 */
export function getHistoricalDecisions(
  category: string,
  limit: number = 5
): HistoricalDecision[] {
  const rows = decisionHistoryDb.getSimilar.all(category, limit) as any[];

  return rows.map((row) => ({
    id: row.id,
    issueId: row.issue_id,
    category: row.category,
    priority: row.priority,
    consensusScore: row.consensus_score,
    recommendationType: row.recommendation_type,
    agentOpinions: row.agent_opinions ? JSON.parse(row.agent_opinions) : [],
    outcomeStatus: row.outcome_status,
    outcomeSuccessRate: row.outcome_success_rate,
    createdAt: row.created_at,
  }));
}

/**
 * Get agent accuracy feedback
 */
export function getAgentFeedback(agentRole: string): AgentFeedback | null {
  const row = agentPerformanceDb.getAgentAccuracy.get(agentRole) as any;

  if (!row || row.total_decisions === 0) {
    return null;
  }

  return {
    agentRole: row.agent_role,
    totalDecisions: row.total_decisions,
    correctDecisions: row.correct_decisions || 0,
    accuracy:
      row.total_decisions > 0
        ? (row.correct_decisions || 0) / row.total_decisions
        : 0,
    avgConfidence: row.avg_confidence || 0.5,
  };
}

/**
 * Get all agent feedbacks
 */
export function getAllAgentFeedback(): AgentFeedback[] {
  const roles = ["risk", "treasury", "community", "product"];
  return roles
    .map((role) => getAgentFeedback(role))
    .filter((f): f is AgentFeedback => f !== null);
}

/**
 * Get category success rate
 */
export function getCategorySuccessRate(category: string): number {
  const rows = decisionHistoryDb.getCategorySuccessRate.all() as any[];
  const categoryRow = rows.find((r) => r.category === category);

  return categoryRow?.avg_success_rate || 0.5;
}

/**
 * Enrich agent context with historical data
 */
export function enrichContextWithHistory(
  category: string,
  priority: string,
  baseContext: Record<string, any> = {}
): EnrichedContext & Record<string, any> {
  // 1. Get historical decisions for this category
  const historicalDecisions = getHistoricalDecisions(category, 5);

  // 2. Get agent feedback
  const agentFeedback = getAllAgentFeedback();

  // 3. Get category success rate
  const categorySuccessRate = getCategorySuccessRate(category);

  // 4. Identify patterns from history
  const patterns = identifyPatterns(historicalDecisions, category);

  return {
    ...baseContext,
    historicalDecisions,
    agentFeedback,
    categorySuccessRate,
    similarIssueCount: historicalDecisions.length,
    patterns,
  };
}

/**
 * Identify patterns from historical decisions
 */
function identifyPatterns(
  decisions: HistoricalDecision[],
  category: string
): string[] {
  const patterns: string[] = [];

  if (decisions.length === 0) {
    patterns.push("No historical data available for this category.");
    return patterns;
  }

  // Calculate average success rate
  const successfulDecisions = decisions.filter(
    (d) => d.outcomeSuccessRate && d.outcomeSuccessRate > 0.7
  );
  const successRate =
    decisions.length > 0 ? successfulDecisions.length / decisions.length : 0;

  if (successRate > 0.7) {
    patterns.push(
      `High success rate (${(successRate * 100).toFixed(0)}%) in similar ${category} issues.`
    );
  } else if (successRate < 0.3) {
    patterns.push(
      `Low success rate (${(successRate * 100).toFixed(0)}%) - careful analysis recommended for ${category} issues.`
    );
  }

  // Analyze consensus patterns
  const avgConsensus =
    decisions.reduce((sum, d) => sum + (d.consensusScore || 0), 0) /
    decisions.length;
  if (avgConsensus > 0.8) {
    patterns.push(
      `Agents typically reach high consensus (${(avgConsensus * 100).toFixed(0)}%) on ${category} issues.`
    );
  } else if (avgConsensus < 0.5) {
    patterns.push(
      `${category} issues often have divided agent opinions - expect debate.`
    );
  }

  // Analyze priority correlation with success
  const highPrioritySuccess = decisions.filter(
    (d) =>
      (d.priority === "high" || d.priority === "urgent") &&
      d.outcomeSuccessRate &&
      d.outcomeSuccessRate > 0.7
  ).length;
  if (highPrioritySuccess > 0) {
    patterns.push(
      `High priority ${category} decisions have ${highPrioritySuccess} successful outcomes.`
    );
  }

  return patterns;
}

/**
 * Record a new decision for learning
 */
export function recordDecision(
  issueId: string,
  category: string,
  priority: string,
  consensusScore: number,
  recommendationType: string,
  agentOpinions: any[]
): string {
  const id = uuidv4();

  const opinionSummaries: AgentOpinionSummary[] = agentOpinions.map((op) => ({
    agentRole: op.role || op.agentRole,
    stance: op.stance,
    confidence: op.confidence,
  }));

  decisionHistoryDb.insert.run({
    id,
    issueId,
    category,
    priority,
    consensusScore,
    recommendationType,
    agentOpinions: JSON.stringify(opinionSummaries),
    outcomeStatus: "pending",
  });

  return id;
}

/**
 * Record outcome for a decision by issue ID (feedback loop)
 * Looks up the most recent decision for the given issue and records outcome
 *
 * @param successRate Fraction of declared KPIs met, in [0,1]; forwarded verbatim.
 */
export function recordOutcomeByIssueId(
  issueId: string,
  successRate: number,
  kpiResults: any[]
): boolean {
  // Find the most recent decision for this issue
  const decision = decisionHistoryDb.getByIssueId.get(issueId) as any;
  if (!decision) {
    console.warn(`No decision found for issue ${issueId}`);
    return false;
  }

  recordOutcome(decision.id, successRate, kpiResults);
  return true;
}

/**
 * Record outcome for a decision (feedback loop)
 *
 * @param successRate Fraction of declared KPIs met, in [0,1]. Compared against
 *   0.7 to decide whether the decision was correct, and subtracted from agent
 *   confidence — which is also [0,1] — to score each agent's accuracy.
 */
export function recordOutcome(
  decisionId: string,
  successRate: number,
  kpiResults: any[]
): void {
  // 1. Update decision history
  decisionHistoryDb.updateOutcome.run({
    id: decisionId,
    outcomeStatus: "completed",
    outcomeSuccessRate: successRate,
    kpiResults: JSON.stringify(kpiResults),
  });

  // 2. Get the decision to record agent performance
  const decision = decisionHistoryDb.getById.get(decisionId) as any;
  if (!decision || !decision.agent_opinions) return;

  const agentOpinions = JSON.parse(decision.agent_opinions) as AgentOpinionSummary[];
  const outcomeCorrect = successRate >= 0.7;

  // 3. Record performance for each agent
  for (const opinion of agentOpinions) {
    const performanceId = uuidv4();
    const wasCorrect = determineAgentCorrectness(opinion, outcomeCorrect);
    const accuracyDelta = opinion.confidence - successRate;

    agentPerformanceDb.insert.run({
      id: performanceId,
      agentId: `${opinion.agentRole}-agent`,
      agentRole: opinion.agentRole,
      decisionId,
      category: decision.category,
      stance: opinion.stance,
      confidence: opinion.confidence,
      outcomeCorrect: wasCorrect ? 1 : 0,
      accuracyDelta,
    });
  }

  // 4. Update agent trust scores
  updateAgentTrustScores();
}

/**
 * Determine if an agent's stance was correct based on outcome
 */
function determineAgentCorrectness(
  opinion: AgentOpinionSummary,
  outcomeSuccess: boolean
): boolean {
  const supportiveStances = ["strongly_support", "support"];
  const opposingStances = ["strongly_oppose", "oppose"];

  const wasSupporting = supportiveStances.includes(opinion.stance);
  const wasOpposing = opposingStances.includes(opinion.stance);

  if (outcomeSuccess) {
    // If outcome was successful, supporting agents were correct
    return wasSupporting;
  } else {
    // If outcome failed, opposing agents were correct
    return wasOpposing;
  }
}

/**
 * Update agent trust scores based on performance history
 */
export function updateAgentTrustScores(): void {
  const roles = ["risk", "treasury", "community", "product"];

  for (const role of roles) {
    const stats = agentPerformanceDb.getAgentAccuracy.get(role) as any;

    if (!stats || stats.total_decisions === 0) {
      // Initialize with default score
      agentTrustDb.upsert.run({
        agentId: `${role}-agent`,
        agentRole: role,
        overallScore: 50,
        totalDecisions: 0,
        correctDecisions: 0,
        accuracyByCategory: JSON.stringify({}),
      });
      continue;
    }

    const accuracy =
      stats.total_decisions > 0
        ? stats.correct_decisions / stats.total_decisions
        : 0.5;

    // Calculate overall score (0-100)
    // Base 50 + (accuracy * 50) - penalty for low decisions
    const decisionBonus = Math.min(stats.total_decisions / 10, 10); // Max 10 point bonus
    const overallScore = Math.min(100, 50 + accuracy * 50 - (10 - decisionBonus));

    agentTrustDb.upsert.run({
      agentId: `${role}-agent`,
      agentRole: role,
      overallScore: Math.round(overallScore * 10) / 10,
      totalDecisions: stats.total_decisions,
      correctDecisions: stats.correct_decisions || 0,
      accuracyByCategory: JSON.stringify({}), // TODO: Add per-category breakdown
    });
  }
}

/**
 * Get agent trust scores
 */
export function getAgentTrustScores(): any[] {
  return agentTrustDb.getAll.all() as any[];
}

/**
 * Format historical context for agent prompts
 */
export function formatHistoricalContextForPrompt(
  enrichedContext: EnrichedContext,
  agentRole: string
): string {
  const { historicalDecisions, agentFeedback, categorySuccessRate, patterns } =
    enrichedContext;

  if (historicalDecisions.length === 0) {
    return "No historical data available for similar issues.";
  }

  // Format historical decisions
  const decisionsSection = historicalDecisions
    .slice(0, 3)
    .map((d) => {
      const agentOpinion = d.agentOpinions.find((o) => o.agentRole === agentRole);
      return `- Issue (${d.priority}): Consensus ${(d.consensusScore * 100).toFixed(0)}%, Outcome: ${d.outcomeStatus === "completed" ? `${(d.outcomeSuccessRate! * 100).toFixed(0)}% success` : "pending"}${agentOpinion ? `, Your stance: ${agentOpinion.stance}` : ""}`;
    })
    .join("\n");

  // Format agent feedback
  const myFeedback = agentFeedback.find((f) => f.agentRole === agentRole);
  const feedbackSection = myFeedback
    ? `Your accuracy: ${(myFeedback.accuracy * 100).toFixed(0)}% (${myFeedback.correctDecisions}/${myFeedback.totalDecisions} decisions)`
    : "No performance history yet.";

  // Format patterns
  const patternsSection =
    patterns.length > 0 ? patterns.map((p) => `- ${p}`).join("\n") : "";

  return `
### Historical Context
${decisionsSection}

### Your Performance
${feedbackSection}

### Category Success Rate
${(categorySuccessRate * 100).toFixed(0)}% average success for similar issues

### Identified Patterns
${patternsSection}
`.trim();
}
