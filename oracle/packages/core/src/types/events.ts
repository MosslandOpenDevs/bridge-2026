/**
 * Realtime event contract shared by the API and the web client.
 *
 * These payloads previously existed only as object literals on the server and
 * as hand-written interfaces in the browser, and the two had drifted: the
 * server sent a round object where the client expected a number, and
 * `finalConsensusScore` where the client read `consensusScore`, which rendered
 * as NaN. Both sides now import these definitions, so a change on one side
 * fails to compile on the other.
 *
 * Every numeric value crossing the socket is JSON-safe: weights are decimal
 * strings, never bigint.
 */

import type { NormalizedSignal } from "./signal.js";
import type { DetectedIssue } from "./issue.js";

export const SOCKET_EVENTS = {
  statsUpdate: "stats:update",
  signalsCollected: "signals:collected",
  issuesDetected: "issues:detected",
  proposalCreated: "proposals:created",
  proposalVoted: "proposals:voted",
  proposalFinalized: "proposals:finalized",
  debateRoundCompleted: "debate:round_completed",
  debateCompleted: "debate:completed",
  decisionsRecorded: "decisions:recorded",
  outcomesEvaluated: "outcomes:evaluated",
} as const;

export type SocketEventName =
  (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];

export interface StatsUpdateEvent {
  signals: number;
  issues: number;
  proposals: number;
  activeProposals: number;
}

export interface SignalsCollectedEvent {
  count: number;
  total: number;
  /** A preview of the newest signals, not the whole batch. */
  signals: NormalizedSignal[];
}

export interface IssuesDetectedEvent {
  newCount: number;
  totalCount: number;
  issues: DetectedIssue[];
}

/** Weights are decimal strings so the payload stays JSON-serializable. */
export interface TallyPayload {
  forVotes: string;
  againstVotes: string;
  abstainVotes: string;
  totalVotes: string;
  voteCount: number;
  forPercentage: number;
  participationRate: number;
  quorumReached: boolean;
  passed: boolean;
}

/**
 * A proposal as it crosses the socket: dates and weights are serialized, and
 * the authoritative tally travels with it.
 */
export interface ProposalPayload {
  id: string;
  /**
   * Human-readable label derived server-side from the decision packet.
   * A Proposal has no title of its own, so clients that read `proposal.title`
   * were displaying undefined.
   */
  title: string;
  proposer: string;
  status: string;
  votingStartsAt: string;
  votingEndsAt: string;
  quorum: number;
  threshold: number;
  executionEta?: string;
  executedAt?: string;
  snapshotBlock?: number;
  decisionPacket?: Record<string, any>;
  tally?: TallyPayload;
}

export interface ProposalCreatedEvent {
  proposal: ProposalPayload;
  /** Always sent, including for auto-promoted proposals. */
  totalCount: number;
  activeCount: number;
  source?: "manual" | "auto-promotion";
}

export interface ProposalVotedEvent {
  proposalId: string;
  vote: {
    id: string;
    voter: string;
    choice: string;
    weight: string;
    reason?: string;
  };
  tally: TallyPayload;
  txHash?: string;
}

export interface ProposalFinalizedEvent {
  proposalId: string;
  status: string;
  tally: TallyPayload;
  executionEta?: string;
  totalCount: number;
  activeCount: number;
}

export interface DebateRoundCompletedEvent {
  sessionId: string;
  /** Round number just completed. */
  round: number;
  totalRounds: number;
  consensusShift?: number;
  keyInsights: string[];
  unresolvedPoints: string[];
  positionChanges: number;
}

export interface DebateCompletedEvent {
  sessionId: string;
  consensusScore: number;
  positionChanges: number;
  totalRounds: number;
}

export interface DecisionsRecordedEvent {
  issueId: string;
  category: string;
  consensusScore: number;
}

export interface OutcomesEvaluatedEvent {
  count: number;
}

/** Every event name mapped to the payload it carries. */
export interface SocketEventPayloads {
  "stats:update": StatsUpdateEvent;
  "signals:collected": SignalsCollectedEvent;
  "issues:detected": IssuesDetectedEvent;
  "proposals:created": ProposalCreatedEvent;
  "proposals:voted": ProposalVotedEvent;
  "proposals:finalized": ProposalFinalizedEvent;
  "debate:round_completed": DebateRoundCompletedEvent;
  "debate:completed": DebateCompletedEvent;
  "decisions:recorded": DecisionsRecordedEvent;
  "outcomes:evaluated": OutcomesEvaluatedEvent;
}
