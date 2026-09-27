# BRIDGE Oracle - 개발 진행 현황

## 현재 상태 (2026-09-27)

BRIDGE 는 MIP-1 의 `Lab` 서비스입니다(레지스트리에 지정된 maintainer 는 아직
없음). 아래 표가 이 문서에서 유일하게 현재를 말하는 부분이고, 그 아래
"History (superseded)" 는 예전 기록입니다.

수치 출처: `GET https://bridge.moss.land/api/stats` 와 `/api/health`
(2026-09-27 조회), 2026-09-26 04:37Z 의 운영 DB 스냅샷, 2026-09-27 압축 실행 로그.

### 단계별 운영 상태

| 단계 | 상태 | 운영 수치 / 근거 |
|------|------|------|
| 신호 수집 (L0) | **자동** — 60초마다 | 관측 행 104,082 (어댑터 3개: Mossland·GitHub·Medium, 2026-09-27 압축 후). 2026-09-27 전까지는 하루 약 9.5k 행이 쌓였고 그중 약 99%가 직전 분의 반복이었음. 지금은 바뀐 값만 저장 (#39). 압축 전 최근 7일 카테고리별 서로 다른 (value, description) 조합: github_commit 1/10,078, mossland_disclosure 1/10,080, mossland_roadmap 1/10,080, medium_activity 1/6,212, moc_market 423/10,080 |
| 이슈 탐지 (L1) | **자동** — 300초마다 | 관측 이슈 754행, 서로 다른 조건(category·kind·direction) 12개. `/api/stats` 의 이슈 수는 조건 수의 약 60배 |
| 에이전트 심의 (L2) | **관리자 요청 시에만** | `POST /api/deliberate`, `POST /api/debate` 는 `ADMIN_API_KEY` 필요. 자동 심의 `AUTO_DELIBERATE_ENABLED` 기본 off ([#29](https://github.com/MosslandOpenDevs/bridge-2026/pull/29)) |
| 제안 생성 | **관리자만** | 자동 승격 `AUTO_PROPOSAL_ENABLED` 기본 off ([#29](https://github.com/MosslandOpenDevs/bridge-2026/pull/29)). 제안 164개 = 실제 21 (진행 중 1, 만료 20) + 데모 143 (모두 만료). 실제 21개 중 18개는 수집기 결함에서 나옴 ([#37](https://github.com/MosslandOpenDevs/bridge-2026/pull/37) 참고) |
| 투표·위임 (L3) | **꺼짐** ([#34](https://github.com/MosslandOpenDevs/bridge-2026/pull/34)) | votes 0행, delegations 0행 — 한 번도 쓰인 적 없음. nginx 까지 온 투표 POST 는 통틀어 2건(400, 503). 스냅샷 잔고 조회는 무료 비아카이브 RPC 에서 동작하지 않음. 구속력 있는 결정은 [Agora](https://agora.moss.land) (EIP-712 서명, 스냅샷 시점의 `getPastVotesOrBalance`) |
| 제안 확정 | **자동** — 60초마다 | 마감된 투표를 확정. 정족수 미달은 `expired` ([#29](https://github.com/MosslandOpenDevs/bridge-2026/pull/29)). 부팅 마이그레이션이 투표 0건으로 `rejected` 였던 163개를 `expired` 로 바로잡음 |
| 실행 (Atomic Actuation) | **쓰인 적 없음** | executions 0행. 통과한 제안이 없음 |
| 결과 증명 (L4) | **꺼짐** | `OUTCOME_EVAL_ENABLED` 기본 off ([#29](https://github.com/MosslandOpenDevs/bridge-2026/pull/29)). outcome proofs 0행, `outcomes.successRate` = null |
| 온체인 기록 | **없음** | `OracleGovernance` 미배포. `blockchainService` 의 쓰기 메서드는 호출하는 곳이 없음. 체인은 MOC 잔고 읽기에만 씀 ([docs/on-chain-state.md](docs/on-chain-state.md)) |
| 데모 데이터 | **꺼짐, 표시됨** | 합성 신호 223,074행(가장 최근 2026-08-08) 중 이슈가 참조하는 22,688행만 남기고 2026-09-27 에 파일로 내보낸 뒤 삭제. 합성 이슈 3,057, 합성 제안 143. `/api/stats` 에서 분리 집계, 신호·이슈 페이지에서는 라벨로 표시, 제안 목록에서는 기본으로 숨김 ([#31](https://github.com/MosslandOpenDevs/bridge-2026/pull/31)) |
| 헬스 | **파생** ([#30](https://github.com/MosslandOpenDevs/bridge-2026/pull/30)) | `/api/health` 가 DB 읽기와 최신 관측 신호 나이로 `ok` / `degraded` / `down` 을 답함. 배포 게이트는 `?strict=1` |
| DB · 백업 | 배포 전 스냅샷 + 수동 외부 사본 | 압축으로 482.5 MB → 63.4 MB (2026-09-27). 압축 전에는 하루 약 7.5 MB 증가, 그중 96% 가 signals 와 그 인덱스. 매일 백업(#35)은 운영자가 켜야 돌고, 외부 사본은 수동(2026-09-26 스냅샷, 2026-09-27 압축 전 스냅샷) |

### 알려진 문제와 이 문제를 다루는 PR

위 표는 [#29](https://github.com/MosslandOpenDevs/bridge-2026/pull/29)–[#41](https://github.com/MosslandOpenDevs/bridge-2026/pull/41) 이 머지·배포되고(2026-09-26~27) 2026-09-27 에
신호 압축을 실행한 뒤의 운영 상태입니다. 아래는 그중 #33 이후 PR 입니다.

- **[#34](https://github.com/MosslandOpenDevs/bridge-2026/pull/34)** — BRIDGE 투표·위임 쓰기를 끄고(410 `VOTING_MOVED_TO_AGORA`) 웹의
  지갑·투표 UI 를 숨기며 `/delegation` 을 Agora 안내로 바꿉니다. 측정된 적 없는
  에이전트 평판·정확도 숫자도 뺍니다. 다시 켜는 절차는 `apps/api/.env.example`.
- **[#39](https://github.com/MosslandOpenDevs/bridge-2026/pull/39)** — 바뀌지 않은 관측 신호를 다시 저장하지 않습니다(하루 약 9.5k →
  약 340행). `signals.stream` 컬럼과 부분 인덱스가 추가됩니다. moss.land
  공시 대시보드의 BRIDGE 신선도는 이제 `/api/health` 의 `lastProcessedAt` 을
  씁니다([MosslandCore/mossland-website-2026#50](https://github.com/MosslandCore/mossland-website-2026/pull/50), 먼저 배포).
- **[#37](https://github.com/MosslandOpenDevs/bridge-2026/pull/37)** — 공시 문서마다 나던 "새 공시" 이벤트(value=1)와 공시 총계(약 53)가
  같은 카테고리 `mossland_disclosure` 에 섞여 이상 탐지가 둘을 함께 z-score
  했고, 재시작마다 "새 공시"를 다시 냈습니다. 실제 제안 21개 중 18개가 여기서
  나왔습니다. 이벤트를 `mossland_disclosure_published` 로 분리하고 재시작에도
  다시 알리지 않게 합니다. `moc_price_alert` 는 Upbit 24시간 변동률이 5% 를
  넘는 동안 매분 다시 났고 부호 없는 값을 저장했는데, 거래일·방향마다 한 번,
  부호 있는 값으로 바뀝니다.
- **[#41](https://github.com/MosslandOpenDevs/bridge-2026/pull/41)** — `/api/stats` 를 최대 30초 캐시하고 소켓 연결도 같은 캐시를 읽습니다
  (예전에는 연결마다 110만 행 COUNT). `issues.conditions`, `signals.lastDay`,
  `asOf` 가 추가되고 기존 키는 그대로입니다. `/api/proposals` 에
  `limit`/`offset` (응답이 3.38 MB 였음), `/api/issues` 는 최대 200행에 큰
  페이지는 신호를 빼고 줍니다(`limit=500` 이 6.8 MB 였음).
- **[#36](https://github.com/MosslandOpenDevs/bridge-2026/pull/36)** — 리얼리티 피드가 같은 관측의 반복을 한 줄로 접습니다(`/signals` 에
  같은 메시지 7개가 약 71번씩 반복돼 보였음). 이슈 카드는 실제 관련 신호 수와
  반복 감지 횟수를 보여 줍니다.
- **[#40](https://github.com/MosslandOpenDevs/bridge-2026/pull/40)** — 이미 쌓인 반복 신호 행을 운영자가 직접 돌릴 때만 압축하는
  스크립트. 2026-09-27 01:35Z 에 운영에서 실행했습니다(유지보수자 승인, API 약
  35초 정지): 관측 889,617 → 104,082행, 합성 223,074행은 내보낸 뒤 이슈가
  참조하는 22,688행만 남김, DB 482.5 → 63.4 MB, 참조되는 신호 id 37,046개는
  모두 그대로. 압축 전 스냅샷과 내보낸 파일은 서버와 외부에 보관. 절차는
  `deploy/README.md`.
- **[#35](https://github.com/MosslandOpenDevs/bridge-2026/pull/35)** — 매일 검증된 DB 백업(`bridge-db-backup`). 머지만으로는 돌지 않고
  운영자가 켜야 합니다.
- **[#38](https://github.com/MosslandOpenDevs/bridge-2026/pull/38)** — API 를 한 주소에만 바인드하고 지정한 프록시의 `X-Forwarded-For`
  만 믿게 하는 옵션. `HOST`/`TRUST_PROXY` 를 두기 전까지 동작은 같습니다.
- **[#33](https://github.com/MosslandOpenDevs/bridge-2026/pull/33)** — 배포되지 않던 `nexus/` 참조 스택을 main 에서 걷어내고 태그
  `archive/nexus-2026-09` 로 보존합니다.

### 방향

BRIDGE 의 방향은 검토 중입니다. 논의 중인 안은 Agora 결정과
[공시 예고 관리 목록](https://github.com/mossland/Disclosure-and-Materials/blob/main/disclosures/TRACKING.md)
의 날짜 있는 약속을 읽기 전용으로 추적하는 시범 운영이고, 판단 시점은
2026-10-20 (소유자의 답), 2026-11-20 (외부 사용 여부), 2026-12-21 (유지 /
GitHub Action 으로 이전 / 보관) 입니다. 약속이 아니라 검토입니다.

---

## History (superseded)

> 아래는 2026년 초에 쓴 진행 기록입니다. 지우지 않고 남겨 두지만, 현재 상태는
> 위 표가 기준입니다. 특히 "온체인 투표 기록 (완료)", "MOC 홀더 투표 검증",
> "에이전트 학습·평판", "실행 트랜잭션" 같은 항목은 코드가 있다는 뜻이지 운영에서
> 쓰였다는 뜻이 아닙니다 — 운영에서 투표·위임·실행·결과 증명은 0건이고, 온체인
> 쓰기 경로는 호출되지 않습니다. 부제였던 "Physical AI Governance OS for MOC
> Token Holders" 도 더 이상 이 서비스를 설명하지 않습니다.

### 프로젝트 개요

BRIDGE는 Mossland의 MOC 토큰 홀더를 위한 Physical AI 거버넌스 운영체제입니다.

🔗 **Live Demo**: [https://bridge.moss.land](https://bridge.moss.land)

**핵심 플로우:** Reality Signals → Agents Deliberate → Humans Decide → Outcomes Proven

---

### 구현 완료 (Completed)

#### 1. 5-Layer 아키텍처

##### Layer 0: Reality Oracle (신호 수집)
- [x] SignalRegistry - 어댑터 관리 및 신호 수집 통합
- [x] **EtherscanAdapter** - MOC 토큰 전송, 가스 가격 모니터링
- [x] **MosslandAdapter** - 공시 정보, MOC 시세 수집
- [x] **GitHubAdapter** - 커밋 활동, 이슈/PR 모니터링
- [x] **SocialAdapter** - Medium 블로그, Twitter 활동 수집
- [x] **MockAdapter** - 데모용 시뮬레이션 데이터
- [x] 다국어 신호 생성 (한국어/영어)

##### Layer 1: Inference Mining (이슈 탐지)
- [x] **AnomalyDetector** - 통계적 이상 탐지 (Z-score 기반)
- [x] **ThresholdDetector** - 규칙 기반 임계값 알림
- [x] **TrendDetector** - 시계열 추세 분석
  - [x] MetricConfig 시스템 - 카테고리별 트렌드 해석
  - [x] TrendDirection (increasing/decreasing/stable)
  - [x] IssueKind (issue vs insight) 구분
- [x] ProposalGenerator - 제안서 초안 생성

##### Layer 2: Agentic Consensus (에이전트 심의)
- [x] **4개 전문 에이전트**
  - RiskAgent - 보안, 취약점, 네트워크 분석
  - TreasuryAgent - 재무, 토큰 가격, TVL 분석
  - CommunityAgent - 커뮤니티 참여, 소셜 분석
  - ProductAgent - 개발 활동, 제품 로드맵 분석
- [x] **Moderator** - 의견 종합 및 Decision Packet 생성
- [x] AGENT_CATEGORY_MAPPING - 에이전트별 전문 분야 매핑
- [x] ConsensusScore 계산 (agreement 40% + confidence 30% + direction 30%)
- [x] ProposalType 결정 (action vs investigation)
- [x] **Multi-LLM 지원**
  - Anthropic Claude (claude-sonnet-4-20250514)
  - OpenAI GPT-4
  - 환경변수 기반 설정
- [x] **에이전트 토론 시스템**
  - Multi-round 토론 (기본 3라운드)
  - 에이전트 간 반박/지지/양보 메시지
  - 라운드별 합의 변화 추적
  - 입장 변경 기록 및 이유 문서화
  - 조기 종료 (높은 합의 도달 시)
  - 실시간 WebSocket 업데이트
- [x] **에이전트 학습 시스템**
  - 과거 결정 히스토리 DB 저장
  - 에이전트별 성과 추적 (정확도, 신뢰도)
  - 심의 시 히스토리컬 컨텍스트 제공
  - 카테고리별 성공률 분석
  - 결과 피드백 루프 (실행 후 학습)
  - 에이전트 신뢰도 점수 자동 업데이트

##### Layer 3: Human Governance (인간 거버넌스)
- [x] **VotingSystem**
  - 제안 생성/활성화
  - MOC 토큰 가중치 투표
  - 정족수 및 통과 기준 검증
  - 투표 집계 및 확정
  - 제안 실행
- [x] **DelegationManager**
  - 위임 정책 생성/조회/삭제
  - 조건부 자동 위임 (카테고리, 금액, 위험도)
  - 만료 시간 관리

##### Layer 4: Proof of Outcome (결과 증명)
- [x] **OutcomeTracker** - 실행 기록 및 KPI 추적
- [x] **TrustManager** - 신뢰도 점수 계산
  - 정확도, 일관성, 적시성 평가
  - 엔티티별 (에이전트, 제안자, 위임자) 점수
- [x] 증명 해시 생성

##### 블록체인 연동
- [x] **BlockchainService** - 온체인 상호작용 서비스
  - viem 기반 Ethereum 클라이언트
  - OracleGovernance 컨트랙트 연동
  - MOC 토큰 잔액 조회 (ERC-20)
- [x] **MOC 홀더 투표 검증**
  - 투표 시 MOC 잔액 자동 확인
  - MOC 잔액 = 투표 가중치
  - 비홀더 투표 차단
- [x] **온체인 투표 기록** (환경변수 설정 시)
  - 제안 온체인 생성
  - 투표 온체인 기록
  - 결과 온체인 확정

#### 2. API 서버 (Express)

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/health` | 헬스체크 |
| GET | `/api/signals` | 신호 목록 (DB) |
| POST | `/api/signals/collect` | 신호 수집 |
| GET | `/api/issues` | 이슈 목록 (DB) |
| POST | `/api/issues/detect` | 이슈 탐지 |
| PATCH | `/api/issues/:id` | 이슈 상태 업데이트 |
| POST | `/api/deliberate` | 에이전트 심의 |
| POST | `/api/debate` | 멀티라운드 토론 |
| GET | `/api/debate/:id` | 토론 세션 조회 |
| GET | `/api/debates` | 토론 목록 |
| GET | `/api/proposals` | 제안 목록 |
| POST | `/api/proposals` | 제안 생성 |
| POST | `/api/proposals/:id/vote` | 투표 |
| POST | `/api/proposals/:id/tally` | 집계 |
| POST | `/api/proposals/:id/finalize` | 확정 |
| POST | `/api/proposals/:id/execute` | 실행 |
| GET | `/api/delegations` | 위임 목록 |
| POST | `/api/delegations` | 위임 생성 |
| POST | `/api/outcomes` | 결과 기록 |
| GET | `/api/outcomes/:id/proof` | 증명 생성 |
| GET | `/api/trust/:entityId` | 신뢰 점수 |
| GET | `/api/stats` | 시스템 통계 |
| GET | `/api/blockchain/status` | 블록체인 연동 상태 |
| GET | `/api/blockchain/moc/:address` | MOC 잔액 조회 |
| GET | `/api/blockchain/verify-voter/:address` | 투표 자격 검증 |

#### 3. Web Frontend (Next.js)

| 페이지 | 경로 | 기능 |
|--------|------|------|
| Dashboard | `/` | 거버넌스 현황, MOC 잔액, 시스템 상태 |
| Signals | `/signals` | 실시간 신호 스트림, 소스/카테고리 필터, 검색 |
| Issues | `/issues` | AI 탐지 이슈, 심의 시작, Decision Packet |
| Proposals | `/proposals` | 제안 목록, MOC 가중치 투표, 실행 |
| Delegation | `/delegation` | 에이전트 위임 설정, 정책 관리 |
| Outcomes | `/outcomes` | 실행 결과, KPI 측정, 신뢰도 점수 |

#### 4. UI/UX 기능

- [x] **다국어 지원** (i18n) - 한국어/영어
- [x] **데모 모드** - 지갑 연동 없이 체험 가능
- [x] **심의 프로그레스 UI** - 단계별 진행상황 표시
- [x] **Decision Packet 독립 스크롤**
- [x] **제안서 상세 정보**
  - 목적 (이슈 컨텍스트)
  - 에이전트 합의 점수
  - 에이전트별 의견 (입장, 근거, 권고)
  - 목표 및 KPI
  - 대안
  - 리스크 및 완화 방안
- [x] **WebSocket 실시간 업데이트**
  - 연결 상태 표시 (Live/Offline 인디케이터)
  - 실시간 신호 수집 알림
  - 실시간 이슈 탐지 알림
  - 제안 생성/투표 실시간 반영
  - 시스템 통계 실시간 업데이트
- [x] **토스트 알림 시스템**
  - ToastProvider Context 기반 전역 상태 관리
  - 4가지 타입 (success, error, warning, info)
  - 6가지 카테고리 (system, signal, issue, proposal, debate, vote)
  - 프로그레스 바 및 자동 dismiss
  - WebSocket 이벤트 자동 알림
  - 다국어 지원 (한국어/영어)
- [x] **모바일 반응형 최적화**
  - 햄버거 메뉴 (모바일 내비게이션)
  - 반응형 그리드 레이아웃
  - 터치 친화적 버튼 크기
  - 모바일 우선 타이포그래피
- [x] **헤더/푸터 개선**
  - 헤더 로고 "BRIDGE"
  - 푸터 컴포넌트 (MOSSLAND 브랜딩)
  - 소셜 링크 (Website, Twitter, Medium, GitHub, Email)
- [x] **대시보드 버그 수정**
  - Signals/Issue Detection 값 0 표시 수정
  - API 타입 정의 수정
  - 신호 목록 기본 limit 500으로 증가
  - CORS 설정 (bridge.moss.land 추가)

#### 5. 데이터 지속성

- [x] **SQLite 데이터베이스**
  - signals 테이블 - 수집된 신호 저장
  - issues 테이블 - 탐지된 이슈 저장
  - kind, direction 컬럼 추가 (마이그레이션)
- [x] 자동 신호 수집 (60초 간격)
- [x] 자동 이슈 탐지 (300초 간격)

#### 6. 테스트

- [x] E2E 테스트 (16개 테스트 케이스)
  - 신호 수집 및 조회
  - 이슈 탐지 및 상태 변경
  - 제안 생성 및 투표
  - 위임 정책 관리
  - 결과 기록 및 증명

---

#### 7. 서버 운영

- [x] **pm2 프로세스 관리**
  - ecosystem.config.cjs 설정 파일
  - 자동 재시작 (autorestart)
  - 로그 관리 (logs/)
- [x] **포트 설정**
  - Frontend: 3100
  - Backend: 3101
- [x] **nginx 프록시 호환**
  - 상대 경로 API URL
  - WebSocket 프록시 지원

---

### 개발 히스토리

| 커밋 | 작업 내용 |
|------|----------|
| `ab14a8f` | 대시보드 통계 버그 수정 및 UI 개선 (헤더/푸터) |
| `b0fc7c0` | pm2 서버 설정 및 데모 모드 문서 업데이트 |
| `6195d45` | WalletConnect 제거 및 pm2 서버 설정 추가 |
| `c6923d1` | 블록체인 연동 가이드 문서 추가 |
| `14ea5e1` | MOC 홀더 투표 검증 및 블록체인 연동 서비스 |
| `f00f544` | 에이전트 학습 시스템 및 피드백 루프 구현 |
| `3d0850a` | 모바일 반응형 최적화 |
| `eb726e1` | 토스트 알림 시스템 고도화 |
| `99b96c4` | 에이전트 심의 시스템 고도화 및 UI/UX 개선 |
| `1550793` | 신호 페이지 검색 및 카테고리 필터 추가 |
| `af55754` | 위임 시스템 완성 및 E2E 테스트 추가 |
| `0ab4a76` | Outcomes 시스템 및 신뢰도 점수 고도화 |
| `972f729` | 투표 UI 연동 및 제안 실행 시스템 구현 |
| `ca5c84b` | 전체 시스템 개선, i18n, 데이터 지속성, E2E 테스트 |

---

### 향후 계획 (Roadmap)

#### 단기 (Short-term)

##### 블록체인 연동 강화
- [x] ~~실제 MOC 토큰 컨트랙트 연동~~ (완료)
- [x] ~~온체인 투표 구현~~ (완료)
- [x] ~~투표 결과 온체인 기록~~ (완료)
- [ ] 실행 트랜잭션 생성 (스마트 컨트랙트 배포 필요)

##### 에이전트 고도화
- [x] ~~에이전트별 학습 데이터 수집~~ (완료)
- [x] ~~과거 결정 기반 컨텍스트 제공~~ (완료)
- [x] ~~에이전트 간 토론 기능~~ (완료)
- [x] ~~반대 의견 상세 분석~~ (완료)

##### UI/UX 개선
- [x] ~~실시간 WebSocket 업데이트~~ (완료)
- [x] ~~투표 현황 실시간 반영~~ (완료)
- [x] ~~토스트 알림 시스템 고도화~~ (완료)
- [x] ~~모바일 반응형 최적화~~ (완료)

#### 중기 (Mid-term)

##### 스마트 컨트랙트
- [ ] BridgeGovernance 컨트랙트 배포
- [ ] 제안 온체인 등록
- [ ] 투표 온체인 기록
- [ ] 실행 자동화 (Timelock)

##### 신호 어댑터 확장
- [ ] Discord 커뮤니티 활동
- [ ] Telegram 그룹 모니터링
- [ ] DeFi 프로토콜 TVL
- [ ] NFT 마켓플레이스 활동

##### 고급 분석
- [ ] ML 기반 이상 탐지
- [ ] 시계열 예측 모델
- [ ] 감성 분석 고도화
- [ ] 크로스체인 신호 수집

#### 장기 (Long-term)

##### 탈중앙화
- [ ] IPFS 기반 Decision Packet 저장
- [ ] 다중 LLM 노드 운영
- [ ] 에이전트 탈중앙화
- [ ] 커뮤니티 운영 전환

##### 생태계 확장
- [ ] 타 DAO 연동
- [ ] 크로스체인 거버넌스
- [ ] SDK 공개
- [ ] 플러그인 시스템

---

### 기술 스택

| 영역 | 기술 |
|------|------|
| Frontend | Next.js 14, TailwindCSS, next-intl |
| Backend | Express, TypeScript, SQLite (better-sqlite3) |
| Blockchain | Ethereum, viem, Solidity |
| AI/LLM | Anthropic Claude, OpenAI GPT-4 |
| DevOps | pm2, nginx |
| Testing | Jest, Supertest |

---

### 실행 방법

```bash
# 의존성 설치
cd oracle && pnpm install

# pm2로 서버 실행 (권장)
pm2 start ecosystem.config.cjs

# pm2 명령어
pm2 status              # 상태 확인
pm2 logs                # 로그 보기
pm2 restart all         # 전체 재시작
pm2 stop all            # 전체 중지

# 개별 실행 (개발용)
pnpm --filter @oracle/api dev   # API (port 3101)
pnpm --filter @oracle/web dev   # Web (port 3100)

# E2E 테스트 (API 서버 실행 필요)
pnpm --filter @oracle/api test

# 빌드
pnpm build
```

---

### 환경 변수

```bash
# API (.env)
PORT=3101
ETHERSCAN_API_KEY=...
GITHUB_TOKEN=...
TWITTER_BEARER_TOKEN=...
ANTHROPIC_API_KEY=...        # 또는 OPENAI_API_KEY
LLM_PROVIDER=anthropic       # 또는 openai
LLM_MODEL=claude-sonnet-4-20250514
SIGNAL_LANGUAGE=ko           # en 또는 ko
SIGNAL_COLLECT_INTERVAL=60
ISSUE_DETECT_INTERVAL=300

# 블록체인 연동 (선택사항)
MAINNET_RPC_URL=...          # MOC 잔액 조회용 Ethereum Mainnet RPC
RPC_URL=...                  # 거버넌스 컨트랙트 배포 네트워크 RPC
GOVERNANCE_CONTRACT_ADDRESS=... # OracleGovernance 컨트랙트 주소
ORACLE_PRIVATE_KEY=...       # 오라클 서명 계정 (0x 포함)
CHAIN_ID=1                   # 1: mainnet, 11155111: sepolia, 31337: hardhat

# Web (.env.local)
NEXT_PUBLIC_API_URL=         # 비워두면 상대 경로 사용 (nginx 프록시용)
```

---

### 주요 파일

| 파일 | 설명 |
|------|------|
| `ecosystem.config.cjs` | pm2 서버 설정 |
| `apps/api/src/index.ts` | API 엔드포인트 |
| `apps/api/src/db.ts` | SQLite 데이터베이스 |
| `apps/api/src/learning.ts` | 에이전트 학습 서비스 |
| `apps/api/src/blockchain.ts` | 블록체인 연동 서비스 |
| `apps/web/src/app/*/page.tsx` | 각 페이지 UI |
| `apps/web/src/lib/api.ts` | API 클라이언트 |
| `apps/web/src/hooks/useMOC.ts` | 데모 모드 훅 |
| `apps/web/src/components/Toast.tsx` | 토스트 알림 컴포넌트 |
| `apps/web/src/contexts/ToastContext.tsx` | 토스트 전역 상태 관리 |
| `apps/web/messages/*.json` | i18n 번역 |
| `packages/core/src/types/` | 공유 타입 정의 |
| `packages/agentic-consensus/src/` | 에이전트 및 Moderator |
| `packages/inference-mining/src/` | 이슈 탐지 |

---

### 라이선스

BUSL 1.1
