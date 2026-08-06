import { z } from "zod";
import { DetectedIssueSchema } from "./issue.js";

// Agent roles in the deliberation process
export const AgentRoleSchema = z.enum([
  "risk",
  "treasury",
  "community",
  "product",
  "moderator",
]);
export type AgentRole = z.infer<typeof AgentRoleSchema>;

// Agent's stance on an issue
export const StanceSchema = z.enum([
  "strongly_support",
  "support",
  "neutral",
  "oppose",
  "strongly_oppose",
]);
export type Stance = z.infer<typeof StanceSchema>;

// Recommended proposal type based on consensus
export const ProposalTypeSchema = z.enum([
  "action",        // High confidence: direct action proposal
  "investigation", // Low confidence: needs more research/discussion
]);
export type ProposalType = z.infer<typeof ProposalTypeSchema>;

// Agent opinion on an issue
export const AgentOpinionSchema = z.object({
  agentId: z.string(),
  role: AgentRoleSchema,
  issueId: z.string().uuid(),
  stance: StanceSchema,
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  concerns: z.array(z.string()),
  recommendations: z.array(z.string()),
  timestamp: z.date(),
});
export type AgentOpinion = z.infer<typeof AgentOpinionSchema>;

// Decision packet synthesized by moderator
export const DecisionPacketSchema = z.object({
  id: z.string().uuid(),
  issueId: z.string().uuid(),
  issue: DetectedIssueSchema,
  // Consensus metrics
  consensusScore: z.number().min(0).max(1), // 0-1 score indicating agent agreement level
  recommendedProposalType: ProposalTypeSchema, // action or investigation based on score
  recommendation: z.object({
    action: z.string(),
    rationale: z.string(),
    expectedOutcome: z.string(),
  }),
  alternatives: z.array(
    z.object({
      action: z.string(),
      pros: z.array(z.string()),
      cons: z.array(z.string()),
    })
  ),
  risks: z.array(
    z.object({
      description: z.string(),
      likelihood: z.enum(["low", "medium", "high"]),
      impact: z.enum(["low", "medium", "high"]),
      mitigation: z.string().optional(),
    })
  ),
  kpis: z.array(
    z.object({
      name: z.string(),
      target: z.number(),
      /**
       * Which side of the target counts as meeting it. Without this a metric
       * like uptime (target 99.9, higher is better) is judged by the same rule
       * as error count (target 0, lower is better), and one of the two is
       * always scored backwards.
       */
      direction: z.enum(["at_most", "at_least"]).default("at_most"),
      unit: z.string(),
      measurementMethod: z.string(),
    })
  ),
  agentOpinions: z.array(AgentOpinionSchema),
  dissent: z.array(
    z.object({
      agentRole: AgentRoleSchema,
      reason: z.string(),
    })
  ),
  createdAt: z.date(),
});
export type DecisionPacket = z.infer<typeof DecisionPacketSchema>;

// Context provided to agents
export const AgentContextSchema = z.object({
  historicalDecisions: z.array(z.unknown()).optional(),
  treasuryBalance: z.number().optional(),
  activeProposals: z.number().optional(),
  communityMetrics: z.record(z.number()).optional(),
});
export type AgentContext = z.infer<typeof AgentContextSchema>;

// Discussion message in a debate round
export const DiscussionMessageSchema = z.object({
  id: z.string().uuid(),
  roundNumber: z.number().min(1),
  speakerId: z.string(),
  speakerRole: AgentRoleSchema,
  targetAgentId: z.string().optional(), // If responding to specific agent
  targetAgentRole: AgentRoleSchema.optional(),
  messageType: z.enum(["opinion", "rebuttal", "support", "clarification", "concession"]),
  content: z.string(),
  keyPoints: z.array(z.string()),
  referencedPoints: z.array(z.string()).optional(), // Points being responded to
  timestamp: z.date(),
});
export type DiscussionMessage = z.infer<typeof DiscussionMessageSchema>;

// A single round of debate
export const DiscussionRoundSchema = z.object({
  roundNumber: z.number().min(1),
  topic: z.string(), // Focus topic for this round
  messages: z.array(DiscussionMessageSchema),
  consensusShift: z.number().optional(), // Change in consensus from previous round
  keyInsights: z.array(z.string()),
  unresolvedPoints: z.array(z.string()),
  startedAt: z.date(),
  completedAt: z.date().optional(),
});
export type DiscussionRound = z.infer<typeof DiscussionRoundSchema>;

// Full debate session
export const DebateSessionSchema = z.object({
  id: z.string().uuid(),
  issueId: z.string().uuid(),
  issue: DetectedIssueSchema,
  status: z.enum(["in_progress", "completed", "cancelled"]),
  rounds: z.array(DiscussionRoundSchema),
  maxRounds: z.number().default(3),
  currentRound: z.number().min(0),
  initialOpinions: z.array(AgentOpinionSchema), // Round 0: initial deliberation
  finalConsensusScore: z.number().min(0).max(1).optional(),
  positionChanges: z.array(
    z.object({
      agentId: z.string(),
      agentRole: AgentRoleSchema,
      fromStance: StanceSchema,
      toStance: StanceSchema,
      reason: z.string(),
      atRound: z.number(),
    })
  ),
  startedAt: z.date(),
  completedAt: z.date().optional(),
});
export type DebateSession = z.infer<typeof DebateSessionSchema>;

// Governance agent interface
export interface GovernanceAgent {
  readonly id: string;
  readonly role: AgentRole;
  deliberate(
    issue: z.infer<typeof DetectedIssueSchema>,
    context: AgentContext
  ): Promise<AgentOpinion>;

  // New: respond to other agents' opinions in debate
  respond?(
    issue: z.infer<typeof DetectedIssueSchema>,
    otherOpinions: AgentOpinion[],
    discussionHistory: DiscussionMessage[],
    context: AgentContext
  ): Promise<DiscussionMessage>;

  // New: update stance based on discussion
  updateStance?(
    currentOpinion: AgentOpinion,
    discussionHistory: DiscussionMessage[],
    context: AgentContext
  ): Promise<{ newStance: Stance; reason: string } | null>;
}
