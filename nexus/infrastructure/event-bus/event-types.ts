/**
 * Event Types
 * 
 * BRIDGE 2026 시스템의 모든 이벤트 타입을 정의합니다.
 */

import type { Signal, Issue, DecisionPacket, Proposal, Outcome } from '@bridge-2026/shared';

/**
 * 이벤트 타입 열거형
 */
export enum EventType {
  // Reality Oracle 이벤트
  SIGNAL_COLLECTED = 'signal.collected',
  SIGNAL_NORMALIZED = 'signal.normalized',
  SIGNAL_ATTESTED = 'signal.attested',
  
  // Inference Mining 이벤트
  ISSUE_DETECTED = 'issue.detected',
  ISSUE_GROUPED = 'issue.grouped',
  PROPOSAL_DRAFT_GENERATED = 'proposal.draft.generated',
  
  // Agentic Consensus 이벤트
  AGENT_DELIBERATION_STARTED = 'agent.deliberation.started',
  AGENT_DELIBERATION_COMPLETED = 'agent.deliberation.completed',
  DECISION_PACKET_CREATED = 'decision.packet.created',
  
  // Human Governance 이벤트
  PROPOSAL_CREATED = 'proposal.created',
  PROPOSAL_STATUS_CHANGED = 'proposal.status.changed',
  VOTE_CAST = 'vote.cast',
  PROPOSAL_RESULT_CALCULATED = 'proposal.result.calculated',
  
  // Proof of Outcome 이벤트
  OUTCOME_MEASURED = 'outcome.measured',
  OUTCOME_EVALUATED = 'outcome.evaluated',
  REPUTATION_UPDATED = 'reputation.updated',
}

/**
 * 기본 이벤트 인터페이스
 */
export interface BaseEvent {
  /** 이벤트 타입 */
  type: EventType;
  /** 이벤트 ID */
  id: string;
  /** 이벤트 발생 시간 */
  timestamp: number;
  /** 이벤트를 발생시킨 레이어/서비스 */
  source: string;
  /** 이벤트 메타데이터 */
  metadata?: Record<string, unknown>;
}

/**
 * Signal 관련 이벤트
 */
export interface SignalCollectedEvent extends BaseEvent {
  type: EventType.SIGNAL_COLLECTED;
  data: Signal;
}

export interface SignalNormalizedEvent extends BaseEvent {
  type: EventType.SIGNAL_NORMALIZED;
  data: Signal;
}

export interface SignalAttestedEvent extends BaseEvent {
  type: EventType.SIGNAL_ATTESTED;
  data: Signal;
}

/**
 * Issue 관련 이벤트
 */
export interface IssueDetectedEvent extends BaseEvent {
  type: EventType.ISSUE_DETECTED;
  data: Issue;
}

export interface IssueGroupedEvent extends BaseEvent {
  type: EventType.ISSUE_GROUPED;
  data: {
    groupId: string;
    issues: Issue[];
  };
}

export interface ProposalDraftGeneratedEvent extends BaseEvent {
  type: EventType.PROPOSAL_DRAFT_GENERATED;
  data: {
    issueId: string;
    draft: Partial<Proposal>;
  };
}

/**
 * Agentic Consensus 관련 이벤트
 */
export interface AgentDeliberationStartedEvent extends BaseEvent {
  type: EventType.AGENT_DELIBERATION_STARTED;
  data: {
    issueId: string;
    agents: string[];
  };
}

export interface AgentDeliberationCompletedEvent extends BaseEvent {
  type: EventType.AGENT_DELIBERATION_COMPLETED;
  data: {
    issueId: string;
    agentType: string;
    reasoning: string;
  };
}

export interface DecisionPacketCreatedEvent extends BaseEvent {
  type: EventType.DECISION_PACKET_CREATED;
  data: DecisionPacket;
}

/**
 * Human Governance 관련 이벤트
 */
export interface ProposalCreatedEvent extends BaseEvent {
  type: EventType.PROPOSAL_CREATED;
  data: Proposal;
}

export interface ProposalStatusChangedEvent extends BaseEvent {
  type: EventType.PROPOSAL_STATUS_CHANGED;
  data: {
    proposalId: string;
    oldStatus: string;
    newStatus: string;
  };
}

export interface VoteCastEvent extends BaseEvent {
  type: EventType.VOTE_CAST;
  data: {
    proposalId: string;
    voterAddress: string;
    choice: 'yes' | 'no' | 'abstain';
    weight: number;
  };
}

export interface ProposalResultCalculatedEvent extends BaseEvent {
  type: EventType.PROPOSAL_RESULT_CALCULATED;
  data: {
    proposalId: string;
    passed: boolean;
    totalVotes: number;
    yesVotes: number;
    noVotes: number;
  };
}

/**
 * Proof of Outcome 관련 이벤트
 */
export interface OutcomeMeasuredEvent extends BaseEvent {
  type: EventType.OUTCOME_MEASURED;
  data: Outcome;
}

export interface OutcomeEvaluatedEvent extends BaseEvent {
  type: EventType.OUTCOME_EVALUATED;
  data: Outcome;
}

export interface ReputationUpdatedEvent extends BaseEvent {
  type: EventType.REPUTATION_UPDATED;
  data: {
    agentType: string;
    trustScore: number;
  };
}

/**
 * 모든 이벤트 타입의 유니온
 */
export type Event =
  | SignalCollectedEvent
  | SignalNormalizedEvent
  | SignalAttestedEvent
  | IssueDetectedEvent
  | IssueGroupedEvent
  | ProposalDraftGeneratedEvent
  | AgentDeliberationStartedEvent
  | AgentDeliberationCompletedEvent
  | DecisionPacketCreatedEvent
  | ProposalCreatedEvent
  | ProposalStatusChangedEvent
  | VoteCastEvent
  | ProposalResultCalculatedEvent
  | OutcomeMeasuredEvent
  | OutcomeEvaluatedEvent
  | ReputationUpdatedEvent;

/**
 * 이벤트 타입 키에 대응하는 구체 이벤트 타입
 *
 * 구독 API는 핸들러가 받는 이벤트를 구독 키로부터 유도해야 한다. 핸들러 타입을
 * 키와 무관한 타입 인자로 두면 `SIGNAL_COLLECTED`를 구독하면서 `VoteCastEvent`를
 * 받는 핸들러를 넘길 수 있고, 그 불일치는 런타임에야 드러난다.
 */
export type EventOf<K extends EventType> = Extract<Event, { type: K }>;









