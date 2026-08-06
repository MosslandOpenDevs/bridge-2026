// Signal types (Layer 1: Reality Oracle)
export {
  SignalSourceSchema,
  RawSignalSchema,
  NormalizedSignalSchema,
  type SignalSource,
  type RawSignal,
  type NormalizedSignal,
  type SignalAdapter,
} from "./signal.js";

// Issue types (Layer 2: Inference Mining)
export {
  IssuePrioritySchema,
  IssueStatusSchema,
  TrendDirectionSchema,
  IssueKindSchema,
  DetectedIssueSchema,
  type IssuePriority,
  type IssueStatus,
  type TrendDirection,
  type IssueKind,
  type DetectedIssue,
  type IssueDetector,
} from "./issue.js";

// Agent types (Layer 3: Agentic Consensus)
export {
  AgentRoleSchema,
  StanceSchema,
  ProposalTypeSchema,
  AgentOpinionSchema,
  DecisionPacketSchema,
  AgentContextSchema,
  DiscussionMessageSchema,
  DiscussionRoundSchema,
  DebateSessionSchema,
  type AgentRole,
  type Stance,
  type ProposalType,
  type AgentOpinion,
  type DecisionPacket,
  type AgentContext,
  type GovernanceAgent,
  type DiscussionMessage,
  type DiscussionRound,
  type DebateSession,
} from "./agent.js";

// Governance types (Layer 4: Human Governance)
export {
  ProposalStatusSchema,
  VoteChoiceSchema,
  ProposalSchema,
  VoteSchema,
  VoteTallySchema,
  DelegationPolicySchema,
  type ProposalStatus,
  type VoteChoice,
  type Proposal,
  type Vote,
  type VoteTally,
  type DelegationPolicy,
} from "./governance.js";

// Realtime event contract (shared by the API and the web client)
export {
  SOCKET_EVENTS,
  type SocketEventName,
  type SocketEventPayloads,
  type StatsUpdateEvent,
  type SignalsCollectedEvent,
  type IssuesDetectedEvent,
  type TallyPayload,
  type ProposalPayload,
  type ProposalCreatedEvent,
  type ProposalVotedEvent,
  type ProposalFinalizedEvent,
  type DebateRoundCompletedEvent,
  type DebateCompletedEvent,
  type DecisionsRecordedEvent,
  type OutcomesEvaluatedEvent,
} from "./events.js";

// Outcome types (Layer 5: Proof of Outcome)
export {
  ExecutionStatusSchema,
  ExecutionRecordSchema,
  KPIResultSchema,
  OutcomeProofSchema,
  TrustScoreSchema,
  type ExecutionStatus,
  type ExecutionRecord,
  type KPIResult,
  type OutcomeProof,
  type TrustScore,
  type OutcomeTracker,
} from "./outcome.js";
