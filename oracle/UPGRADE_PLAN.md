# BRIDGE 2026 Oracle: 24/7 Live Governance Engine 업그레이드 계획

> **Superseded (2026-09-26) — 구현되지 않은 계획입니다. 기록으로만 남겨 둡니다.**
>
> - 이 문서가 설계한 것 — 30인 Grand Council, Dynamic Summoning, 3티어 스케줄러와
>   Budget Manager, 24/7 Activity Log, Daily Ops Report, `/engine`·`/disclosure`·
>   `/agents`·`/agora` 페이지와 `agora_sessions`/`agora_messages` 테이블 — 은
>   코드에 없습니다. 실제로 들어간 것은 LLM 공급자로 Ollama 를 고를 수 있는
>   정도입니다.
> - 이 문서의 "아고라(Agora)" 는 BRIDGE 안의 에이전트 토론방을 뜻하는데, 그
>   이름은 이미 모스랜드 DAO 의 실제 거버넌스 서비스
>   [Agora](https://agora.moss.land) 가 쓰고 있습니다. 모스랜드의 구속력 있는
>   결정은 그 Agora 에서 내려지고(MIP-1 도 거기서 비준됐습니다), BRIDGE 는 자체
>   투표·위임을 끄고 그쪽으로 안내합니다([#34](https://github.com/MosslandOpenDevs/bridge-2026/pull/34)). 같은 이름의 BRIDGE 로컬 페이지를
>   만들면 둘을 혼동하게 되므로, 이 계획을 되살리더라도 그 이름은 쓰지 마세요.
> - 이 계획이 전제한 "항상 작동하는" 자율 심의·제안 루프는 기본으로 꺼져 있습니다([#29](https://github.com/MosslandOpenDevs/bridge-2026/pull/29)).
>   BRIDGE 의 현재 상태는 [`PROGRESS.md`](PROGRESS.md), 방향 검토는
>   [루트 README](../README.md#direction-under-review) 를 보세요.

---

## 개요

이 계획은 BRIDGE 2026 Oracle을 "항상 작동하는 라이브 거버넌스 엔진"으로 업그레이드합니다.
**핵심 컨셉**: "시끌벅적한 아고라(Agora)" - 수십 명의 의원들이 상주하는 의회 같은 느낌

### 핵심 원칙
- **Human Sovereignty**: AI는 제안/근거/요약/권고까지만 (최종 의사결정은 사람)
- **Auditability First**: 모든 산출물에 provenance 메타데이터 포함
- **비용 통제**: 3티어 스케줄러 + 예산 관리자로 외부 LLM 비용 엄격 통제
- **플러그인 구조**: 커넥터와 에이전트는 언제든 추가 가능한 구조

---

## 현재 상태 분석

### 기존 아키텍처 (유지)
```
L0 Reality Oracle → L1 Inference Mining → L2 Agentic Consensus → L3 Human Governance → L4 Proof of Outcome
```

### 기존 구현물
- **Backend**: Express + Socket.IO (port 4000), SQLite (WAL 모드)
- **Frontend**: Next.js 14 + React Query + Socket.IO + Tailwind CSS
- **Agents**: Risk, Treasury, Community, Product, Moderator (5개)
- **Adapters**: Mock, Etherscan, Mossland, GitHub, Social (5개)
- **Background Tasks**: setInterval 기반 (60초 signal 수집, 300초 issue 감지)

### 부족한 부분 (구현 필요)
- 24/7 Activity Log 스트리밍 (heartbeat + 에이전트 잡담)
- 30인 Grand Council 에이전트 군집
- Dynamic Summoning 시스템
- 3티어 스케줄러 + Budget Manager
- Local LLM (Ollama) 통합
- Daily Ops Report 자동 생성
- Disclosure Log (provenance 메타데이터)
- /engine, /disclosure, /agents, /agora 페이지

---

## 🏛️ The Grand Council: 30인의 에이전트 명부

### 운영 전략
- **평소**: Tier-1(Local Llama 3.2)로 각자 페르소나 연기, "웅성거리는(Chatter)" 상태 유지
- **중요 의제**: 관련 에이전트만 Tier-2(Claude/GPT)로 승격하여 본격 토론

### 1. The Visionaries (미래 설계자 그룹) - 5인

| ID | 이름 | 성향 | 주요 발언 패턴 |
|----|------|------|---------------|
| `singularity-seeker` | Singularity Seeker | 특이점 추종자, AGI/양자 담론 | "이 기능이 AGI 도래를 앞당길 수 있습니까?" |
| `metaverse-native` | Metaverse Native | 가상세계 원주민, 게이미피케이션 | "재미없으면 아무도 안 옵니다. 도파민 요소가 부족해요." |
| `solarpunk-architect` | Solarpunk Architect | 친환경/지속가능, 유기적 성장 | "에너지 효율적인가요? 유기적으로 성장 가능한가요?" |
| `chaos-pilot` | Chaos Pilot | 실험주의자, 파괴적 혁신 선호 | "너무 안전해요. 좀 더 미친 짓을 해봅시다." |
| `dao-fundamentalist` | DAO Fundamentalist | 탈중앙화 원리주의, Code is Law | "왜 운영자가 개입하죠? 스마트 컨트랙트로 자동화하세요." |

### 2. The Builders (엔지니어링 길드) - 5인

| ID | 이름 | 성향 | 주요 발언 패턴 |
|----|------|------|---------------|
| `rust-evangelist` | Rust Evangelist | 안정성 제일, 메모리 안전성 | "그 코드는 안전하지 않습니다. Rust로 재작성하시죠." |
| `rapid-prototyper` | Rapid Prototyper | 속도전, 해커톤 스타일 | "언제 다 짭니까? 일단 배포하고 고칩시다." |
| `legacy-keeper` | Legacy Keeper | 보수적 유지보수, 안정성 우선 | "새 기능 때문에 기존 브릿지가 멈추면 책임질 겁니까?" |
| `ux-perfectionist` | UX Perfectionist | 디자인 집착, 사용자 경험 최우선 | "백엔드는 모르겠고, 버튼 위치가 불편합니다." |
| `docs-librarian` | Docs Librarian | 문서화 요정, 주석 없으면 거부 | "PR에 설명이 없네요. 머지할 수 없습니다." |

### 3. The Investors (시장 감시단) - 4인

| ID | 이름 | 성향 | 주요 발언 패턴 |
|----|------|------|---------------|
| `diamond-hand` | Diamond Hand | 장기 투자자, 10년 가치 | "지금 가격은 중요하지 않습니다. 펀더멘탈에 집중하세요." |
| `degen-trader` | Degen Trader | 단타/밈 중독, 당장의 펌핑 | "그래서 언제 쏘나요? 요즘 유행하는 AI 메타 태웁시다." |
| `whale-watcher` | Whale Watcher | 온체인 분석가, 대형 지갑 추적 | "방금 3번 지갑에서 대량 이동이 있었습니다. 뭔가 있어요." |
| `macro-analyst` | Macro Analyst | 거시경제 분석가, 금리/나스닥 연동 | "연준 발표 전까진 몸 사려야 합니다." |

### 4. The Guardians (리스크 관리 위원회) - 4인

| ID | 이름 | 성향 | 주요 발언 패턴 |
|----|------|------|---------------|
| `compliance-officer` | Compliance Officer | 법무팀, 규제/증권성 이슈 | "SEC가 싫어할 단어입니다. '투자' 대신 '참여'라고 쓰세요." |
| `white-hat` | White Hat | 보안 전문가, 해킹 가능성 점검 | "Reentrancy 공격에 취약해 보입니다." |
| `budget-hawk` | Budget Hawk | 예산 감시자, 비용 낭비 감시 | "이 기능에 GPT-4를 쓰는 건 낭비입니다. 3.5로 낮추세요." |
| `fact-checker` | Fact Checker | 팩트 광인, 출처 없으면 기각 | "그 뉴스는 루머입니다. 공식 소스가 아닙니다." |

### 5. The Operatives (특수 기능 요원) - 5인 (Tier 0/1 전담)

| ID | 이름 | 역할 | 실행 주기 |
|----|------|------|----------|
| `news-crawler` | News Crawler Alpha | AI 뉴스 수집 (TechCrunch 등) | 10분 |
| `crypto-feeder` | Crypto Feeder | 코인 뉴스 요약 (Coindesk) | 10분 |
| `github-watchdog` | Github Watchdog | 커밋 로그 실시간 중계 | 5분 |
| `discord-relay` | Discord Relay | 커뮤니티 여론 전달 | 15분 |
| `summary-bot` | Summary Bot | 토론 3줄 요약 | 요청 시 |

### 6. Core Moderators (핵심 진행자) - 3인 (기존 확장)

| ID | 이름 | 역할 | 설명 |
|----|------|------|------|
| `bridge-moderator` | Bridge Moderator | 토론 진행 + Decision Packet 합성 | 중립적 진행자 |
| `evidence-curator` | Evidence Curator | 근거/출처 카드 관리 | 모든 주장에 출처 요구 |
| `disclosure-scribe` | Disclosure Scribe | 공시/IR 문서 작성 | Daily Ops Report 담당 |

### 7. Specialist Advisors (전문 자문단) - 4인 (기존 에이전트 재정의)

| ID | 이름 | 역할 | 설명 |
|----|------|------|------|
| `risk-sentinel` | Risk Sentinel | 보안/리스크 관점 | 기존 RiskAgent 확장 |
| `treasury-tactician` | Treasury Tactician | 자금/토크노믹스 | 기존 TreasuryAgent 확장 |
| `community-voice` | Community Voice | 커뮤니티 감정 대변 | 기존 CommunityAgent 확장 |
| `product-architect` | Product Architect | 제품/기획 관점 | 기존 ProductAgent 확장 |

---

## ⚙️ Dynamic Summoning (동적 소환) 시스템

### 개념
30명이 동시에 떠들면 난장판! 이슈의 성격에 따라 **관련된 에이전트만 소환**

### 1. Lobby (로비/대기실)

모든 에이전트가 `Idle` 상태로 대기하며 간헐적 잡담(Chatter) 발생

```typescript
interface AgentState {
  id: string;
  status: 'idle' | 'active' | 'speaking' | 'listening';
  currentActivity?: string;  // "비트코인 차트를 쳐다보는 중..."
  lastChatter?: Date;
}

// 잡담 예시 (Tier1 Local LLM)
const idleMessages = [
  "Degen Trader가 비트코인 차트를 쳐다보는 중...",
  "Rust Evangelist가 커피를 마시는 중",
  "White Hat이 최신 CVE 목록을 훑어보는 중...",
  "Docs Librarian이 README.md를 정리하는 중"
];
```

### 2. Special Interest Groups (이슈 유형별 자동 소환)

```typescript
interface SummoningRule {
  issueCategory: string[];
  requiredAgents: string[];    // 필수 소환
  optionalAgents: string[];    // 선택적 소환
}

const SUMMONING_RULES: SummoningRule[] = [
  {
    issueCategory: ['technical', 'code', 'architecture'],
    requiredAgents: ['rust-evangelist', 'legacy-keeper', 'white-hat'],
    optionalAgents: ['rapid-prototyper', 'docs-librarian']
  },
  {
    issueCategory: ['marketing', 'event', 'community'],
    requiredAgents: ['metaverse-native', 'degen-trader', 'community-voice'],
    optionalAgents: ['budget-hawk', 'compliance-officer']
  },
  {
    issueCategory: ['security', 'vulnerability', 'audit'],
    requiredAgents: ['white-hat', 'risk-sentinel', 'fact-checker'],
    optionalAgents: ['compliance-officer', 'legacy-keeper']
  },
  {
    issueCategory: ['tokenomics', 'treasury', 'budget'],
    requiredAgents: ['treasury-tactician', 'budget-hawk', 'diamond-hand'],
    optionalAgents: ['macro-analyst', 'whale-watcher']
  },
  {
    issueCategory: ['governance', 'proposal', 'voting'],
    requiredAgents: ['dao-fundamentalist', 'bridge-moderator', 'compliance-officer'],
    optionalAgents: ['community-voice', 'diamond-hand']
  }
];
```

### 3. Human Summoning (유저 개입)

```typescript
// UI 버튼 또는 채팅 명령으로 에이전트 소환
POST /api/agora/:sessionId/summon
{
  agentId: "white-hat",
  reason?: "보안 전문가 의견이 필요합니다"
}

// 또는 채팅 입력
// "@white-hat 이 코드의 보안 취약점은 없나요?"
```

---

## 구현 계획

### Phase 1: Database Schema 확장

**파일**: `/apps/api/src/db.ts`

```sql
-- 기존 테이블 (Budget, Activity 등) + 새 테이블

-- Budget 관련 테이블
CREATE TABLE IF NOT EXISTS budget_usage (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  tier INTEGER NOT NULL,
  date TEXT NOT NULL,
  hour INTEGER,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  estimated_cost_usd REAL DEFAULT 0,
  call_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, tier, date, hour)
);

CREATE TABLE IF NOT EXISTS budget_config (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL UNIQUE,
  daily_budget_usd REAL NOT NULL,
  hourly_call_limit INTEGER NOT NULL,
  input_token_price REAL NOT NULL,
  output_token_price REAL NOT NULL,
  enabled INTEGER DEFAULT 1
);

-- Activity Log 테이블
CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  message TEXT NOT NULL,
  details TEXT,
  metadata TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Disclosure Log 테이블 (불변 감사 추적)
CREATE TABLE IF NOT EXISTS disclosure_logs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  log_type TEXT NOT NULL,
  source TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  model_used TEXT,
  prompt_template_version TEXT,
  provenance TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Daily Ops Report 테이블
CREATE TABLE IF NOT EXISTS daily_ops_reports (
  id TEXT PRIMARY KEY,
  report_date TEXT NOT NULL UNIQUE,
  signals_count INTEGER NOT NULL,
  signals_summary TEXT,
  issue_candidates TEXT,
  ongoing_deliberations TEXT,
  decision_packet_drafts TEXT,
  generated_by TEXT NOT NULL,
  model_used TEXT,
  ir_formatted_content TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Agent 정의 테이블 (30인 명부)
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  group_name TEXT NOT NULL,  -- visionaries, builders, investors, etc.
  persona_prompt TEXT NOT NULL,
  speaking_style TEXT,       -- JSON: {tone, vocabulary, catchphrases}
  idle_messages TEXT,        -- JSON array: 대기 시 잡담 메시지
  summoning_tags TEXT,       -- JSON array: 소환 트리거 태그
  tier_preference TEXT DEFAULT 'tier1',  -- tier0, tier1, tier2
  is_operative INTEGER DEFAULT 0,  -- 데이터 수집 전담 여부
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Agent 상태 테이블 (실시간)
CREATE TABLE IF NOT EXISTS agent_states (
  agent_id TEXT PRIMARY KEY,
  status TEXT DEFAULT 'idle',  -- idle, active, speaking, listening
  current_activity TEXT,
  current_session_id TEXT,
  last_chatter TEXT,
  last_active TEXT,
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

-- Agora 세션 테이블 (토론방)
CREATE TABLE IF NOT EXISTS agora_sessions (
  id TEXT PRIMARY KEY,
  issue_id TEXT,
  title TEXT NOT NULL,
  status TEXT DEFAULT 'active',  -- active, concluded, archived
  summoned_agents TEXT,  -- JSON array
  human_participants TEXT,  -- JSON array
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  concluded_at TEXT,
  FOREIGN KEY (issue_id) REFERENCES issues(id)
);

-- Agora 메시지 테이블 (토론 내용)
CREATE TABLE IF NOT EXISTS agora_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  agent_id TEXT,           -- NULL if human
  human_id TEXT,           -- NULL if agent
  message_type TEXT NOT NULL,  -- opinion, rebuttal, question, chatter, summon
  content TEXT NOT NULL,
  evidence TEXT,           -- JSON: 근거 카드
  tier_used TEXT,          -- tier1 or tier2
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES agora_sessions(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

-- Agent 잡담 로그 (로비 활동)
CREATE TABLE IF NOT EXISTS agent_chatter (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  message TEXT NOT NULL,
  context TEXT,  -- 잡담 맥락 (뉴스 반응, 차트 확인 등)
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

CREATE INDEX IF NOT EXISTS idx_agent_chatter_time ON agent_chatter(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agora_messages_session ON agora_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_time ON activity_log(timestamp DESC);
```

---

### Phase 2: 3티어 스케줄러 + Budget Manager

#### 2.1 티어별 작업 분류 (에이전트 연동)

| Tier | 비용 | 실행 주기 | 작업 | 에이전트 |
|------|------|----------|------|---------|
| Tier 0 | 무료 | 1-10분 | RSS/GitHub/On-chain 수집 | The Operatives 5인 |
| Tier 1 | Local LLM | 5분 | 잡담, 간단 요약, 태깅, Issue 후보 | 30인 전체 (Idle 잡담) |
| Tier 2 | External LLM | 트리거 시 | 본격 토론, Decision Packet | 소환된 에이전트만 |

#### 2.2 Budget Manager 기능

- Provider별 (OpenAI/Anthropic) 일일 USD 예산: $10/day
- Tier2 호출은 **중요 이슈 + 소환된 에이전트**에만 허용
- 예산 부족 시 Tier1로 자동 대체 + UI "Degraded" 표시

#### 2.3 새 파일 생성

**`/apps/api/src/budget/`**
- `types.ts` - Budget 관련 타입 정의
- `budget-manager.ts` - 예산 관리 로직
- `cost-estimator.ts` - 토큰/비용 추정
- `index.ts` - 모듈 export

**`/apps/api/src/scheduler/`**
- `tier-scheduler.ts` - 3티어 스케줄러 메인
- `task-queue.ts` - 작업 큐 관리
- `tier0-runner.ts` - 무료/저렴 작업 (RSS, GitHub, On-chain)
- `tier1-runner.ts` - Local LLM 작업 (Ollama)
- `tier2-runner.ts` - External LLM 작업 (Claude/GPT)
- `trigger-manager.ts` - Tier2 트리거 조건 평가
- `index.ts` - 모듈 export

---

### Phase 3: 24/7 Activity Log + Agent Chatter

#### 3.1 Activity 이벤트 타입 확장

```typescript
type ActivityEventType =
  // 시스템 이벤트
  | "HEARTBEAT"
  | "COLLECTOR"
  | "NORMALIZE"
  | "DEDUPE"
  | "BUDGET_THROTTLE"
  | "SYSTEM_STATUS"

  // 에이전트 이벤트 (NEW)
  | "AGENT_CHATTER"       // 로비 잡담
  | "AGENT_SUMMONED"      // 토론방 소환
  | "AGENT_SPEAKING"      // 발언 중
  | "AGENT_DISMISSED"     // 퇴장

  // 토론 이벤트
  | "AGORA_SESSION_START"
  | "AGORA_ROUND_COMPLETE"
  | "AGORA_CONSENSUS_REACHED"
  | "DECISION_PACKET_DRAFT"
  | "DISCLOSURE_PUBLISH";
```

#### 3.2 Agent Chatter 시스템

```typescript
// 5-15초마다 랜덤 에이전트가 잡담
class ChatterService {
  private agents: Agent[];

  generateChatter(): AgentChatter {
    const agent = this.selectRandomIdleAgent();
    const context = this.getCurrentContext();  // 최신 뉴스, 차트 등

    // Tier1 Local LLM으로 페르소나에 맞는 잡담 생성
    const message = await this.tier1Runner.generateChatter(
      agent.persona_prompt,
      agent.speaking_style,
      context
    );

    return { agentId: agent.id, message, context };
  }
}

// 예시 잡담 출력
// [Degen Trader] "비트코인 4% 상승 중... 이번엔 진짜 불장인가? 🚀"
// [Rust Evangelist] "방금 새 crate 업데이트 봤는데, 메모리 안전성 개선됐더라."
// [White Hat] "Curve 해킹 사후 분석 읽는 중... 우리 컨트랙트는 괜찮겠지?"
```

---

### Phase 4: Agora UI/UX

#### 4.1 새 페이지: `/agora`

```typescript
// /apps/web/src/app/agora/page.tsx

export default function AgoraPage() {
  return (
    <div className="grid grid-cols-12 gap-4 h-screen">
      {/* 왼쪽: 로비 (대기 에이전트들) */}
      <div className="col-span-3">
        <AgentLobby />
      </div>

      {/* 중앙: 토론장 */}
      <div className="col-span-6">
        <DiscussionArena />
      </div>

      {/* 오른쪽: 근거 패널 + 소환 버튼 */}
      <div className="col-span-3">
        <EvidencePanel />
        <SummonPanel />
      </div>
    </div>
  );
}
```

#### 4.2 컴포넌트 구조

**`AgentLobby.tsx`** - 로비/대기실
```typescript
// 30인 에이전트 아바타 그리드
// 상태별 표시: Idle(회색), Active(초록), Speaking(노랑)
// 잡담 말풍선 팝업
// 호버 시 프로필 카드
```

**`DiscussionArena.tsx`** - 토론장
```typescript
// 활성 세션의 대화 스레드
// 발언자 아바타 + 이름 + 그룹 배지
// 메시지 타입별 스타일 (의견/반박/질문)
// 근거 카드 인라인 표시
// 사람 개입 입력창
```

**`EvidencePanel.tsx`** - 근거 패널
```typescript
// 현재 토론에 인용된 출처 목록
// 출처별 신뢰도 라벨 (official/media/social)
// Evidence coverage 게이지
```

**`SummonPanel.tsx`** - 소환 패널
```typescript
// 그룹별 에이전트 목록
// 원클릭 소환 버튼
// 소환 이유 입력 (선택)
// 현재 소환된 에이전트 표시
```

#### 4.3 Socket.IO 이벤트

```typescript
// 에이전트 관련 실시간 이벤트
socket.on('agent:chatter', (data: AgentChatter) => { ... });
socket.on('agent:summoned', (data: { sessionId, agentId }) => { ... });
socket.on('agent:speaking', (data: { sessionId, agentId }) => { ... });
socket.on('agent:message', (data: AgoraMessage) => { ... });

// 토론 관련 이벤트
socket.on('agora:session_started', (session: AgoraSession) => { ... });
socket.on('agora:consensus_update', (data: { score, trend }) => { ... });
```

---

### Phase 5: 출력/공시 파이프라인

#### 5.1 Daily Ops Report 자동 생성

```typescript
interface DailyOpsReport {
  reportDate: string;
  sections: {
    signalsSummary: { category: string; count: number; highlights: string[] }[];
    issueCandidates: { id: string; title: string; priority: string; status: string }[];
    ongoingDeliberations: { issueId: string; agentCount: number; round: number }[];
    decisionPacketDrafts: { issueId: string; recommendation: string }[];
    executionStatus: { proposalId: string; status: string }[];
  };
  generatedBy: "local" | "external";
  irFormattedContent: string;
}
```

- **Tier1**: 매일 자동 초안 생성 (Local LLM)
- **Tier2**: 하루 1-2회 IR 톤 강화 (External LLM)

#### 5.2 Disclosure Log (Provenance 메타데이터)

모든 산출물에 필수 포함:
```typescript
interface Provenance {
  inputSource: string;       // RSS, GitHub, On-chain 등
  timestamp: Date;           // 생성 시간
  modelUsed: string;         // "local:llama3.2" | "anthropic:claude-sonnet-4"
  promptTemplateVersion: string;  // "v1.0.0"
  taskId: string;            // 작업 ID
  contentHash: string;       // SHA-256 해시 (변조 방지)
}
```

---

### Phase 6: API 엔드포인트

**`/apps/api/src/index.ts`에 추가**

```typescript
// 기존 엔드포인트 + 새 엔드포인트

// Scheduler
GET  /api/scheduler/status
POST /api/scheduler/control
POST /api/scheduler/trigger-tier2
GET  /api/scheduler/queue

// Budget
GET  /api/budget/status
GET  /api/budget/status/:provider
PATCH /api/budget/config/:provider
GET  /api/budget/history

// Activity
GET  /api/activity/recent

// Disclosure
GET  /api/disclosure-logs
GET  /api/disclosure-logs/:id
GET  /api/disclosure-logs/:id/verify

// Daily Reports
GET  /api/daily-reports
GET  /api/daily-reports/:date
GET  /api/daily-reports/latest
POST /api/daily-reports/generate

// Agents (30인 명부)
GET    /api/agents                      // 전체 에이전트 목록
GET    /api/agents/:id                  // 에이전트 상세
GET    /api/agents/group/:groupName     // 그룹별 에이전트
GET    /api/agents/:id/state            // 에이전트 현재 상태
PATCH  /api/agents/:id/state            // 상태 변경

// Agent Chatter
GET    /api/chatter/recent              // 최근 잡담 (30개)
GET    /api/chatter/agent/:agentId      // 특정 에이전트 잡담 히스토리

// Agora (토론방)
GET    /api/agora/sessions              // 세션 목록
GET    /api/agora/sessions/:id          // 세션 상세
POST   /api/agora/sessions              // 새 세션 생성
POST   /api/agora/sessions/:id/summon   // 에이전트 소환
POST   /api/agora/sessions/:id/dismiss  // 에이전트 퇴장
POST   /api/agora/sessions/:id/message  // 메시지 전송 (사람)
GET    /api/agora/sessions/:id/messages // 메시지 히스토리
POST   /api/agora/sessions/:id/conclude // 세션 종료

// Dynamic Summoning
GET    /api/summoning/rules             // 소환 규칙 목록
POST   /api/summoning/suggest           // 이슈 기반 소환 추천
```

---

## 수정 대상 파일 목록

### 백엔드 (생성)
- `/apps/api/src/budget/` - Budget Manager 모듈
- `/apps/api/src/scheduler/` - 3티어 스케줄러
- `/apps/api/src/activity.ts` - Activity Service
- `/apps/api/src/disclosure.ts` - Disclosure Service
- `/apps/api/src/daily-ops-report.ts` - Daily Report Generator
- `/apps/api/src/agents/` - **NEW** Agent 관리 모듈
  - `roster.ts` - 30인 명부 정의
  - `state-manager.ts` - 상태 관리
  - `chatter-service.ts` - 잡담 생성
  - `summoning-engine.ts` - 동적 소환 엔진
- `/apps/api/src/agora/` - **NEW** Agora 토론 모듈
  - `session-manager.ts` - 세션 관리
  - `message-handler.ts` - 메시지 처리
  - `consensus-calculator.ts` - 합의도 계산

### 백엔드 (수정)
- `/apps/api/src/db.ts` - 새 테이블 추가
- `/apps/api/src/index.ts` - 새 API 엔드포인트 + 스케줄러 통합

### 패키지 (생성/수정)
- `/packages/core/src/types/agent.ts` - Agent 타입 정의
- `/packages/core/src/types/agora.ts` - Agora 타입 정의
- `/packages/agentic-consensus/src/agents/` - 30인 에이전트 클래스

### 프론트엔드 (생성)
- `/apps/web/src/components/EngineRoom.tsx`
- `/apps/web/src/components/StatusBar.tsx`
- `/apps/web/src/components/agora/` - **NEW** Agora 컴포넌트
  - `AgentLobby.tsx`
  - `AgentAvatar.tsx`
  - `DiscussionArena.tsx`
  - `MessageBubble.tsx`
  - `EvidencePanel.tsx`
  - `SummonPanel.tsx`
  - `ConsensusGauge.tsx`
- `/apps/web/src/hooks/useActivityLog.ts`
- `/apps/web/src/hooks/useAgentChatter.ts` - **NEW**
- `/apps/web/src/hooks/useAgoraSession.ts` - **NEW**
- `/apps/web/src/app/engine/page.tsx`
- `/apps/web/src/app/disclosure/page.tsx`
- `/apps/web/src/app/agents/page.tsx`
- `/apps/web/src/app/agora/page.tsx` - **NEW**

### 프론트엔드 (수정)
- `/apps/web/src/app/layout.tsx` - StatusBar 추가
- `/apps/web/src/components/Header.tsx` - 네비게이션 추가
- `/apps/web/src/lib/api.ts` - 새 API 메서드 추가

---

## 검증 방법 (Acceptance Criteria)

1. **Activity Log 연속성**: UI에서 Activity Log가 최대 10초 이상 멈추지 않음 (에이전트 잡담 포함)
2. **Agent Chatter**: 로비에서 5-15초마다 에이전트 잡담이 표시됨
3. **Dynamic Summoning**: 이슈 생성 시 관련 에이전트가 자동 소환됨
4. **Human Summoning**: 사용자가 버튼/명령으로 특정 에이전트 소환 가능
5. **Tier 분리**: 잡담은 Tier1(Local), 본격 토론은 Tier2(External)
6. **Budget 제한 동작**: 외부 LLM 예산 소진 시 Tier1 대체 + UI "Degraded" 표시
7. **Daily Ops Report**: 최소 하루 1회 자동 생성 + /disclosure에서 조회 가능
8. **Provenance 메타데이터**: 모든 산출물에 출처/시간/모델/작업ID/해시 포함

---

## 확정된 설정

- **Local LLM**: Ollama + llama3.2
- **일일 예산**: Anthropic $10/day, OpenAI $10/day
- **에이전트 수**: 30인 (5개 그룹 + Core Moderators + Specialists)
- **우선순위**: Activity Log + Agent Chatter 우선 구현 (아고라 느낌 먼저)

---

## 구현 순서 (아고라 우선)

### Step 1: 30인 에이전트 명부 + Chatter 시스템 (핵심)
1. Database Schema - agents, agent_states, agent_chatter 테이블 (1시간)
2. 30인 에이전트 정의 (roster.ts) (2시간)
3. Agent State Manager 구현 (1시간)
4. Chatter Service + Tier1 연동 (2시간)
5. Socket.IO agent:chatter 이벤트 (30분)
6. Frontend AgentLobby + AgentAvatar 컴포넌트 (2시간)
7. useAgentChatter hook (30분)

**Step 1 완료 후**: 로비에서 30인 에이전트가 잡담하며 "웅성거리는" 느낌

### Step 2: Dynamic Summoning + Agora 기본
1. Summoning Engine 구현 (1.5시간)
2. Agora Session Manager (1.5시간)
3. Database - agora_sessions, agora_messages 테이블 (30분)
4. Agora API 엔드포인트 (1시간)
5. Frontend DiscussionArena + SummonPanel (2시간)
6. useAgoraSession hook (1시간)

**Step 2 완료 후**: 이슈 기반 자동 소환 + 사용자 수동 소환 가능

### Step 3: Activity Log + StatusBar
1. Activity Service 확장 (agent 이벤트 포함) (1시간)
2. StatusBar 컴포넌트 (1시간)
3. EngineRoom 컴포넌트 (1시간)
4. Layout 통합 (15분)

**Step 3 완료 후**: 전체 시스템 활동 실시간 모니터링

### Step 4: Budget Manager + 3티어 스케줄러
1. Budget Manager 구현 (1.5시간)
2. Tier Scheduler 구현 (2시간)
3. Tier0/1/2 Runner 구현 (3시간)
4. Chatter와 Tier1 연동 완성 (1시간)

**Step 4 완료 후**: 비용 최적화된 에이전트 운영

### Step 5: 출력/공시 파이프라인
1. Disclosure Service (1시간)
2. Daily Ops Report Generator (1.5시간)
3. /disclosure 페이지 (1.5시간)

**Step 5 완료 후**: Daily Ops Report 자동 생성

### Step 6: 통합 및 완성
1. /agora 페이지 완성 (2시간)
2. /agents 페이지 (에이전트 관리) (1.5시간)
3. /engine 페이지 (1시간)
4. Header 네비게이션 업데이트 (15분)
5. i18n 메시지 추가 (30분)
6. 통합 테스트 + 버그 수정 (3시간)

---

## 환경변수 설정

```bash
# .env
# Local LLM (Tier1)
LOCAL_LLM_ENDPOINT=http://localhost:11434
LOCAL_LLM_MODEL=llama3.2

# Tier Configuration
TIER0_INTERVAL=60000      # 1분
TIER1_INTERVAL=300000     # 5분
TIER2_SCHEDULED_RUNS=6,12,18,23  # 하루 4회

# Budget Configuration
ANTHROPIC_DAILY_BUDGET_USD=10.00
OPENAI_DAILY_BUDGET_USD=10.00
ANTHROPIC_HOURLY_CALL_LIMIT=20
OPENAI_HOURLY_CALL_LIMIT=20

# Chatter Configuration
CHATTER_INTERVAL_MIN=5000   # 5초
CHATTER_INTERVAL_MAX=15000  # 15초
```

---

**총 예상 시간**: 약 38시간
