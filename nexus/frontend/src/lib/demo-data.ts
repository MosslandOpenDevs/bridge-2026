/**
 * Demo Data
 *
 * 백엔드 없이 UI를 둘러볼 수 있도록 하는 데모용 고정 데이터입니다.
 *
 * `NEXT_PUBLIC_DEMO_MODE=true`일 때만 사용되며, 이 경우 페이지는 API를 아예
 * 호출하지 않습니다. 데모 데이터는 API 실패 시의 대체물이 아닙니다 — 실패는
 * 실패로 보여야 하고, 존재하지 않는 제안 ID에 사용자가 투표하는 일이 없어야
 * 합니다. 그래서 모든 식별자에 `demo-` 접두사를 붙입니다.
 *
 * All fixtures below are typed against `@bridge-2026/shared`, so they break at
 * compile time if the shared contract changes. Keep it that way: a fixture that
 * only resembles the contract teaches the components the wrong shape.
 */

import {
  DecisionPacket,
  DelegationPolicy,
  Outcome,
  OutcomeStatus,
  Proposal,
  ProposalStatus,
  ProposalType,
  Signal,
  SignalSource,
  SignalType,
  AgentType,
} from '@bridge-2026/shared';

/**
 * Demo mode is opt-in and build-time only: Next.js inlines `NEXT_PUBLIC_*` at
 * build, so a production bundle built without the flag can never turn it on.
 */
export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * Fixtures are built on call, not at module load, so the relative timestamps
 * ("30분 전") stay relative to the viewer's clock rather than to build time.
 */

const demoAttestation = (signer: string, signedAt: number) => ({
  signature: `0xdemo${signer}`,
  signer: `demo-collector:${signer}`,
  signedAt,
});

export function getDemoSignals(): Signal[] {
  const now = Date.now();

  const signal = (
    id: string,
    ageMs: number,
    source: SignalSource,
    type: SignalType,
    collectorId: string,
    confidence: number,
    tags: string[],
    data: Record<string, unknown>
  ): Signal => {
    const at = now - ageMs;
    return {
      id,
      metadata: { timestamp: at, source, type, collectorId, confidence, tags },
      data,
      attestation: demoAttestation(collectorId, at),
      createdAt: at,
      updatedAt: at,
    };
  };

  return [
    signal(
      'demo-sig-1',
      30 * 60 * 1000,
      SignalSource.ONCHAIN,
      SignalType.GOVERNANCE_ACTIVITY,
      'onchain-indexer',
      0.95,
      ['governance', 'proposal'],
      {
        eventType: 'ProposalCreated',
        blockNumber: 18500000,
        transactionHash: '0x1234...',
      }
    ),
    signal(
      'demo-sig-2',
      2 * HOUR,
      SignalSource.COMMUNITY,
      SignalType.PARTICIPATION,
      'checkin-collector',
      0.88,
      ['checkin', 'proof-of-presence'],
      {
        checkInType: 'qr',
        location: { name: '서울 이벤트장' },
        walletAddress: '0x5678...',
      }
    ),
    signal(
      'demo-sig-3',
      5 * HOUR,
      SignalSource.ONCHAIN,
      SignalType.ANOMALY,
      'onchain-indexer',
      0.92,
      ['governance', 'anomaly'],
      {
        eventType: 'ParticipationRateDrop',
        participationRate: 0.05,
      }
    ),
    signal(
      'demo-sig-4',
      12 * HOUR,
      SignalSource.PUBLIC_DATA,
      SignalType.METRIC,
      'city-pulse',
      0.85,
      ['weather', 'city-pulse'],
      {
        source: 'weather',
        city: '서울',
        temperature: 22,
        humidity: 65,
      }
    ),
    signal(
      'demo-sig-5',
      1 * DAY,
      SignalSource.TELEMETRY,
      SignalType.METRIC,
      'github-collector',
      0.9,
      ['github', 'development'],
      {
        source: 'github',
        type: 'pull_request',
        repository: 'mossland/bridge-2026',
        openPRs: 5,
      }
    ),
  ];
}

export function getDemoProposals(): Proposal[] {
  const now = Date.now();

  return [
    {
      id: 'demo-1',
      title: '[AI Assisted] 거버넌스 참여율 개선 방안',
      description:
        '최근 거버넌스 참여율이 감소하고 있어, 참여 인센티브를 개선하는 방안을 제안합니다.',
      type: ProposalType.GOVERNANCE,
      status: ProposalStatus.ACTIVE,
      decisionPacketId: 'demo-dp-1',
      issueId: 'demo-issue-1',
      actions: [],
      votingStartTime: now,
      votingEndTime: now + 7 * DAY,
      minParticipationRate: 0.1,
      passingThreshold: 0.5,
      createdAt: now - 2 * DAY,
      updatedAt: now - 2 * DAY,
      metadata: {
        aiAssisted: true,
        agentConfidence: 0.85,
      },
    },
    {
      id: 'demo-2',
      title: '[AI Assisted] 트레저리 배분 최적화',
      description:
        '현재 트레저리 배분이 비효율적이어서, 데이터 기반 최적화 방안을 제안합니다.',
      type: ProposalType.TREASURY,
      status: ProposalStatus.PASSED,
      decisionPacketId: 'demo-dp-2',
      issueId: 'demo-issue-2',
      actions: [],
      votingStartTime: now - 10 * DAY,
      votingEndTime: now - 3 * DAY,
      minParticipationRate: 0.1,
      passingThreshold: 0.5,
      createdAt: now - 14 * DAY,
      updatedAt: now - 3 * DAY,
      metadata: {
        aiAssisted: true,
        agentConfidence: 0.78,
      },
    },
  ];
}

/**
 * The detail page can be reached for any id, so the fixture is parameterised
 * rather than looked up — demo mode has no store to look anything up in.
 */
export function getDemoProposal(id: string): Proposal {
  const now = Date.now();

  return {
    id,
    title: '[AI Assisted] 거버넌스 참여율 개선 방안',
    description: `최근 거버넌스 참여율이 지속적으로 감소하고 있습니다. 이는 커뮤니티의 의사결정 과정에 부정적인 영향을 미치고 있습니다.

이 제안은 다음과 같은 방안을 포함합니다:
1. 참여 인센티브 강화
2. 투표 프로세스 간소화
3. 제안 알림 시스템 개선

이러한 개선을 통해 거버넌스 참여율을 30% 이상 향상시킬 수 있을 것으로 예상됩니다.`,
    type: ProposalType.GOVERNANCE,
    status: ProposalStatus.ACTIVE,
    decisionPacketId: 'demo-dp-1',
    issueId: 'demo-issue-1',
    actions: [],
    votingStartTime: now,
    votingEndTime: now + 7 * DAY,
    minParticipationRate: 0.1,
    passingThreshold: 0.5,
    createdAt: now - 2 * DAY,
    updatedAt: now - 2 * DAY,
    metadata: {
      aiAssisted: true,
      agentConfidence: 0.85,
    },
  };
}

export function getDemoDecisionPacket(): DecisionPacket {
  const now = Date.now();

  return {
    id: 'demo-dp-1',
    issueId: 'demo-issue-1',
    recommendation:
      '거버넌스 참여율 개선을 위해 참여 인센티브를 강화하고, 투표 프로세스를 간소화하는 것을 권장합니다.',
    recommendationDetails: `AI 에이전트들의 분석 결과, 거버넌스 참여율 감소의 주요 원인은 다음과 같습니다:
1. 투표 프로세스의 복잡성
2. 참여에 대한 인센티브 부족
3. 제안에 대한 정보 접근성 부족

이를 해결하기 위해 단계적 개선 방안을 제안합니다.`,
    alternatives: [
      {
        title: '인센티브만 강화',
        description: '참여 인센티브만 강화하는 방안',
        advantages: ['빠르게 적용 가능', '개발 비용이 낮음'],
        disadvantages: ['근본 원인인 프로세스 복잡성이 남음'],
      },
      {
        title: '프로세스만 간소화',
        description: '투표 프로세스만 간소화하는 방안',
        advantages: ['지속적인 예산 부담이 없음'],
        disadvantages: ['단기 참여 유인이 부족함'],
      },
    ],
    risks: [
      {
        title: '예산 부담',
        description: '인센티브 강화로 인한 예산 부담 증가 가능성',
        severity: 'medium',
        probability: 0.4,
        identifiedBy: [AgentType.TREASURY],
      },
      {
        title: '시스템 복잡도 증가',
        description: '알림 시스템 추가로 인한 시스템 복잡도 증가',
        severity: 'low',
        probability: 0.25,
        identifiedBy: [AgentType.PRODUCT_FEASIBILITY],
      },
    ],
    kpis: [
      {
        name: '참여율',
        description: '투표에 참여한 홀더 비율',
        measurementMethod: 'governance-api 집계',
        targetValue: 0.3,
      },
      {
        name: '투표 완료 시간',
        description: '제안 공개부터 투표 완료까지 걸린 시간',
        measurementMethod: 'governance-api 집계',
        targetValue: 5,
        unit: 'day',
      },
    ],
    dissentingOpinions: [],
    agentReasoning: [],
    overallConfidence: 0.85,
    createdAt: now - 2 * DAY,
    moderator: { version: 'demo' },
  };
}

export function getDemoOutcomes(): Outcome[] {
  const now = Date.now();

  return [
    {
      id: 'demo-outcome-1',
      proposalId: 'demo-1',
      decisionPacketId: 'demo-dp-1',
      status: OutcomeStatus.SUCCESS,
      kpiMeasurements: [
        {
          kpiName: '참여율',
          value: 0.35,
          targetValue: 0.3,
          measuredAt: now,
          measurementMethod: 'automatic',
          dataSource: 'governance-api',
        },
        {
          kpiName: '투표 완료 시간',
          value: 4.2,
          targetValue: 5,
          measuredAt: now,
          measurementMethod: 'automatic',
          dataSource: 'governance-api',
        },
      ],
      evaluation: {
        evaluator: 'automatic',
        success: true,
        successRate: 0.9,
        reasoning:
          '모든 KPI가 목표를 달성했습니다. 참여율이 35%로 목표 30%를 초과 달성했으며, 투표 완료 시간도 목표보다 빠릅니다.',
        evaluatedAt: now,
      },
      executionStartTime: now - 10 * DAY,
      executionEndTime: now - 3 * DAY,
      createdAt: now - 10 * DAY,
      updatedAt: now - 3 * DAY,
    },
    {
      id: 'demo-outcome-2',
      proposalId: 'demo-2',
      decisionPacketId: 'demo-dp-2',
      status: OutcomeStatus.PARTIAL_SUCCESS,
      kpiMeasurements: [
        {
          kpiName: '예산 효율성',
          value: 0.65,
          targetValue: 0.8,
          measuredAt: now,
          measurementMethod: 'automatic',
          dataSource: 'treasury-api',
        },
      ],
      evaluation: {
        evaluator: 'automatic',
        success: false,
        successRate: 0.65,
        reasoning: '예산 효율성이 목표를 달성하지 못했습니다. 추가 개선이 필요합니다.',
        evaluatedAt: now,
      },
      executionStartTime: now - 20 * DAY,
      executionEndTime: now - 13 * DAY,
      createdAt: now - 20 * DAY,
      updatedAt: now - 13 * DAY,
    },
  ];
}

export function getDemoDelegationPolicies(
  wallet: string
): Array<DelegationPolicy & { id: string; createdAt: number }> {
  return [
    {
      id: 'demo-policy-1',
      wallet,
      agent_id: 'treasury',
      scope: {
        categories: ['treasury', 'governance'],
      },
      max_budget_per_month: 10000,
      max_budget_per_proposal: 1000,
      no_vote_on_emergency: true,
      cooldown_window_hours: 24,
      veto_enabled: true,
      createdAt: Date.now() - 7 * DAY,
    },
  ];
}
