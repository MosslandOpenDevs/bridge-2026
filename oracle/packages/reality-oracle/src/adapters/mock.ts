import { RawSignal, NormalizedSignal, SignalSource } from "@oracle/core";
import { BaseAdapter } from "./base.js";

export interface MockAdapterConfig {
  signalCount?: number;
  sources?: SignalSource[];
  language?: "en" | "ko";
}

const MOCK_CATEGORIES = [
  "governance_participation",
  "treasury_balance",
  "proposal_activity",
  "token_price",
  "network_health",
  "community_sentiment",
  "protocol_tvl",
  "gas_usage",
  "vote_turnout",
  "delegation_changes",
];

const MOCK_DESCRIPTIONS: Record<"en" | "ko", Record<string, string[]>> = {
  en: {
    governance_participation: [
      "Governance voting participation changed",
      "Delegate count increase detected",
      "Active voter count changed",
    ],
    treasury_balance: [
      "Treasury balance changed",
      "Large fund movement detected",
      "Budget execution rate changed",
    ],
    proposal_activity: [
      "New proposal registered",
      "Proposal voting deadline approaching",
      "Proposal status changed",
    ],
    token_price: [
      "MOC token price changed",
      "Volume surge detected",
      "Liquidity pool changed",
    ],
    network_health: [
      "Node response delay detected",
      "Block generation speed changed",
      "Network congestion increased",
    ],
    community_sentiment: [
      "Community activity increased",
      "Social media mentions changed",
      "Forum posts surged",
    ],
    protocol_tvl: [
      "Protocol TVL changed",
      "Staking ratio changed",
      "Liquidity supply changed",
    ],
    gas_usage: [
      "Gas fee spike detected",
      "Transaction throughput changed",
      "Contract calls increased",
    ],
    vote_turnout: [
      "Low turnout warning",
      "Quorum at risk",
      "Voting deadline approaching",
    ],
    delegation_changes: [
      "Large delegation change",
      "Delegation withdrawal detected",
      "New delegate registered",
    ],
  },
  ko: {
    governance_participation: [
      "거버넌스 투표 참여율 변동",
      "위임자 수 증가 감지",
      "활성 유권자 수 변화",
    ],
    treasury_balance: [
      "트레저리 잔액 변동",
      "대규모 자금 이동 감지",
      "예산 집행률 변화",
    ],
    proposal_activity: [
      "신규 제안 등록",
      "제안 투표 마감 임박",
      "제안 상태 변경",
    ],
    token_price: [
      "MOC 토큰 가격 변동",
      "거래량 급증 감지",
      "유동성 풀 변화",
    ],
    network_health: [
      "노드 응답 지연 감지",
      "블록 생성 속도 변화",
      "네트워크 혼잡도 상승",
    ],
    community_sentiment: [
      "커뮤니티 활동 증가",
      "소셜 미디어 언급량 변화",
      "포럼 게시글 급증",
    ],
    protocol_tvl: [
      "프로토콜 TVL 변동",
      "스테이킹 비율 변화",
      "유동성 공급 변화",
    ],
    gas_usage: [
      "가스비 급등 감지",
      "트랜잭션 처리량 변화",
      "컨트랙트 호출 증가",
    ],
    vote_turnout: [
      "투표율 저조 경고",
      "정족수 미달 위험",
      "투표 마감 임박 알림",
    ],
    delegation_changes: [
      "대규모 위임 변경",
      "위임 철회 감지",
      "신규 대리인 등록",
    ],
  },
};

export class MockAdapter extends BaseAdapter {
  readonly name = "MockAdapter";
  readonly source: SignalSource = "telemetry";
  protected readonly synthetic = true;

  private config: MockAdapterConfig;

  constructor(config: MockAdapterConfig = {}) {
    super();
    this.config = {
      signalCount: config.signalCount ?? 5,
      sources: config.sources ?? ["onchain", "telemetry", "api"],
      language: config.language ?? "en",
    };
  }

  async fetch(): Promise<RawSignal[]> {
    const signals: RawSignal[] = [];
    const count = this.config.signalCount!;
    const lang = this.config.language || "en";

    for (let i = 0; i < count; i++) {
      const category = MOCK_CATEGORIES[Math.floor(Math.random() * MOCK_CATEGORIES.length)];
      const descriptions = MOCK_DESCRIPTIONS[lang][category] || ["Signal detected"];
      const description = descriptions[Math.floor(Math.random() * descriptions.length)];

      const value = Math.random() * 100;
      const severity = this.calculateSeverity(value);

      const signal = this.createRawSignal(
        `mock-${Date.now()}-${i}`,
        {
          category,
          value,
          severity,
          description,
          mockSource: this.config.sources![Math.floor(Math.random() * this.config.sources!.length)],
          isMock: true,
          generatedAt: new Date().toISOString(),
        }
      );
      signals.push(signal);
    }

    return signals;
  }

  private calculateSeverity(value: number): NormalizedSignal["severity"] {
    if (value >= 90) return "critical";
    if (value >= 70) return "high";
    if (value >= 40) return "medium";
    return "low";
  }

  normalize(signal: RawSignal): NormalizedSignal {
    const data = signal.data as {
      category: string;
      value: number;
      severity: NormalizedSignal["severity"];
      description: string;
      source: SignalSource;
    };

    return this.createNormalizedSignal(
      signal,
      data.category,
      data.severity,
      data.value,
      "%",
      data.description
    );
  }
}
