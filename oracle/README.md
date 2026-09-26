# BRIDGE Oracle — 현실 신호 거버넌스 실험실

> **상태 (2026-09-26):** MIP-1 `Lab` 서비스. 저장소 전체의 현황과 수치는
> [루트 README 의 Status](../README.md#status), 단계별 표는
> [`PROGRESS.md`](PROGRESS.md) 에 있습니다.

BRIDGE 는 **모스랜드(Mossland)** 의 공개 신호를 모아 이상·추세를 이슈로 표시하는
실험 서비스이고, 이 디렉터리가 [bridge.moss.land](https://bridge.moss.land) 에
배포되는 코드입니다. 지금 운영에서 도는 것은 다음과 같습니다.

- **자동:** 신호 수집(60초마다: MOC 시세·시장·온체인, 모스랜드 공시·로드맵,
  GitHub 커밋, Medium), 규칙 기반 이슈 탐지(300초마다), 마감된 제안 확정.
- **관리자 요청 시에만:** AI 에이전트 심의·토론, 제안 생성.
- **꺼짐:** 자동 심의·자동 제안·결과 평가([#29](https://github.com/MosslandOpenDevs/bridge-2026/pull/29)), BRIDGE 자체 투표·위임([#34](https://github.com/MosslandOpenDevs/bridge-2026/pull/34)).
  모스랜드 DAO 의 구속력 있는 결정은 [Agora](https://agora.moss.land) 에서
  내려지고, BRIDGE 제안은 구속력이 없습니다.
- **없음:** 실행과 온체인 기록. `OracleGovernance` 는 배포된 적이 없습니다.

앞으로의 방향(Agora 결정·공시의 날짜 있는 약속을 읽기 전용으로 추적하는 시범
운영과 2026-10-20 / 11-20 / 12-21 의 판단 시점)은
[루트 README](../README.md#direction-under-review) 에 적혀 있고, 확정된 계획이
아닙니다.

## 핵심 비전 (설계 개념)

아래는 BRIDGE 가 처음 설계된 방향입니다. 위 목록에서 보듯 운영에서는 앞의 두
단계만 자동으로 돕니다.

**기존 DAO**: 사람이 제안 → 사람 토론 → 투표

**BRIDGE**: 현실 신호 → AI 의제화 → 에이전트 토론 → 사람 승인/위임 → 실행 → 결과증명

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      BRIDGE Governance Loop                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   Reality         Inference        Agentic          Human               │
│   Oracle    ───▶  Mining     ───▶  Consensus  ───▶  Governance          │
│   (신호수집)       (이슈발굴)        (에이전트토론)    (MOC 홀더투표)       │
│      │                                                   │              │
│      │                                                   ▼              │
│      │                                            Atomic Actuation      │
│      │                                            (실행)                │
│      │                                                   │              │
│      └───────────────────  Proof of Outcome  ◀───────────┘              │
│                            (결과증명/평판)                               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## 모스코인 (MOC)

| 속성 | 값 |
|------|------|
| 네트워크 | Ethereum Mainnet |
| 표준 | ERC-20 + `ERC20Votes` 체크포인트 ([on-chain-state](docs/on-chain-state.md)) |
| 컨트랙트 | `0x8bbfe65e31b348cd823c62e02ad8c19a84dd0dab` |

설계상 MOC 홀더의 3가지 역할 (지금은 셋 다 운영되지 않습니다):
1. **Direct Voter** - 직접 투표/토론 참여 — BRIDGE 투표는 기본으로 꺼져 있고
   ([#34](https://github.com/MosslandOpenDevs/bridge-2026/pull/34)), 모스랜드 DAO 투표는 Agora 에서 합니다.
2. **Delegator** - 정책 기반으로 에이전트에게 위임 — 위임도 함께 꺼져 있습니다.
   위임은 운영에서 한 번도 만들어진 적이 없습니다.
3. **Oracle Contributor** - 현실 신호 제공 (체크인/리포트) — 구현되지 않았습니다.

## Quick Start

```bash
# 의존성 설치
pnpm install

# 프로덕션 빌드 (pm2 기동에 선행 필요: web은 next start가 .next를,
# api는 node가 apps/api/dist를 읽는다)
pnpm --filter "@oracle/web..." build
pnpm --filter "@oracle/api..." build

# pm2로 서버 실행 (권장)
# bridge-deploy는 운영 서버 전용 자동배포 프로세스 — 로컬에서 켜지 말 것
pm2 start ecosystem.config.cjs --only oracle-api,oracle-web

# 접속
# Frontend: http://localhost:3100
# Backend:  http://localhost:3101

# pm2 명령어
pm2 status                            # 상태 확인
pm2 logs                              # 로그 보기
pm2 restart oracle-api oracle-web     # 재시작 (운영 서버는 공유 박스 — restart all 금지)

# 개별 실행 (개발용)
PORT=3101 pnpm --filter @oracle/api dev   # API (PORT 미지정 시 4000)
pnpm --filter @oracle/web dev             # Web (port 3100)
```

> **투표·위임은 기본으로 꺼져 있습니다** ([#34](https://github.com/MosslandOpenDevs/bridge-2026/pull/34)): 투표·위임 쓰기 요청은 `410`
> (`VOTING_MOVED_TO_AGORA`) 으로 답하고, 웹은 지갑 버튼·투표 UI 를 숨기고
> `/delegation` 을 Agora 안내로 바꿉니다. 로컬에서 실험하려면 API 에 `VOTING_ENABLED=1`, 웹 빌드에
> `NEXT_PUBLIC_VOTING_ENABLED=1` 을 함께 두세요(절차는 `apps/api/.env.example`).
> 켜면 공개 이더리움 RPC 로 MOC 잔고를 검증하고, 투표에는 지갑 서명(EIP-191)과
> 제안 스냅샷 블록 시점의 MOC 잔고가 필요합니다. 기본값인 스냅샷 가중치는
> 아카이브 RPC 가 있어야 동작합니다. 오픈 데모 모드는 `MAINNET_RPC_URL=off`.

## 배포 (Production)

bridge.moss.land는 nginx(SSL) 뒤에서 pm2로 `oracle-api`(3101) /
`oracle-web`(3100)을 실행하며, 헬스체크는 `GET /api/health` 입니다(`ok` /
`degraded` / `down` 을 파생해 답하고, 상태코드만 보는 모니터는
`?strict=1` — `down` 일 때만 503).

배포는 **pull 방식 자동배포**입니다: pm2 앱 `bridge-deploy`가 5분마다
[`scripts/deploy.sh`](scripts/deploy.sh)를 실행해 `origin/main`이 움직였을 때만
변경 분류 → SQLite 스냅샷 → 필요한 것만 빌드 → 해당 pm2 앱만 재시작 →
헬스체크(실패 시 자동 롤백)를 수행합니다. **코드가 main에 머지되면 곧
배포**되고, 문서만 바뀐 머지는 서버 체크아웃만 동기화하며 배포로 취급하지
않습니다(빌드·재시작 없음, 로그에 `SYNCED`로 기록). 자세한 운영 방법은
[`deploy/README.md`](deploy/README.md) 참고.

## 2026 H1 MVP 범위

### 포함 (계획 → 2026-09-26 운영 상태)

| 레이어 | 계획한 기능 | 운영 상태 |
|--------|------|------|
| Reality Oracle v0 | 온체인 이벤트, Agora 활동, Proof-of-Presence 체크인 | MOC·공시·로드맵·GitHub·Medium 수집만 자동. Agora 활동·체크인은 없음 |
| Inference Mining v0 | 규칙 기반 트리거 + LLM 이슈 요약, 제안 초안 생성 | 규칙 기반 탐지 자동. 제안 초안 자동 승격은 꺼짐 |
| Agentic Consensus v0 | 5 에이전트 토론, Decision Packet 생성 | 관리자 요청 시에만 |
| Human Governance | MOC 토큰 가중치 투표, AI Assisted Proposal | 꺼짐 ([#34](https://github.com/MosslandOpenDevs/bridge-2026/pull/34)). 투표 0건 |
| Delegation v0 | 정책 기반 위임 (카테고리/상한/거부권) | 꺼짐 ([#34](https://github.com/MosslandOpenDevs/bridge-2026/pull/34)). 위임 0건 |
| Proof of Outcome v0 | KPI 측정, 에이전트 평판 업데이트 | 꺼짐. 실행 0건, 결과 증명 0건 |

### 제외 (2027+)

- 에이전트의 트레저리 직접 집행
- 완전 자동화 DAO
- 빌딩 BMS/로봇 제어

## 프로젝트 구조

```
oracle/
├── packages/
│   ├── core/                 # 공유 타입 및 유틸리티
│   ├── reality-oracle/       # L0: 신호 수집 어댑터
│   ├── inference-mining/     # L1: 이슈 탐지기
│   ├── agentic-consensus/    # L2: AI 에이전트 + Moderator
│   ├── human-governance/     # L3: 투표 + 위임
│   ├── proof-of-outcome/     # L4: 결과 추적
│   └── contracts/            # Solidity 컨트랙트 (배포된 적 없음)
├── apps/
│   ├── web/                  # Next.js 웹 프론트엔드
│   └── api/                  # Express REST API
```

## 웹 UI 구성

| 페이지 | 설명 |
|--------|------|
| Reality Feed | 실시간 신호 스트림, 이상징후 하이라이트 |
| Issues | 탐지된 이슈, 에이전트 토론 로그, Decision Packet |
| Proposals | 제안 목록 (비구속). 데모 제안은 기본으로 숨기고, 정족수 없이 끝난 제안은 "만료"로 표시. 투표 UI 는 꺼져 있음 ([#34](https://github.com/MosslandOpenDevs/bridge-2026/pull/34)) |
| Delegation | Agora 안내 페이지 ([#34](https://github.com/MosslandOpenDevs/bridge-2026/pull/34)). 위임 설정 UI 는 `NEXT_PUBLIC_VOTING_ENABLED=1` 빌드에서만 |
| Outcomes | 실행 결과, KPI 변화, 증명 — 운영에는 아직 한 건도 없음 |

## 5-레이어 아키텍처 (설계 개념)

각 레이어가 설계상 하는 일입니다. 운영 상태는 위 MVP 범위 표를 보세요.

### L0. Reality Oracle (Signal → Verified Data)

현실 세계 신호를 검증 가능한 데이터로 변환:
- 온체인 이벤트 (MOC 전송, 거버넌스 활동)
- Agora 텔레메트리 (참여율, 제안 패턴)
- Proof-of-Presence (QR/NFC 체크인)
- 공개 API (도시 데이터, 환경 신호)

### L1. Inference Mining (Data → Issues)

신호에서 이슈를 발굴:
- 이상 탐지 (참여율 급락, 이상 투표 패턴)
- 임계값 알림 (예산 소진, 에러율)
- 추세 분석 (장기 패턴 변화)
- 자동 제안 초안 생성

### L2. Agentic Consensus (Issues → Decision Packet)

5개 에이전트가 구조화된 토론:

| 에이전트 | 관점 |
|----------|------|
| Risk & Security | 보안/악성/거버넌스 공격 |
| Treasury | 예산/재무 영향 |
| Community | 커뮤니티 반응/공정성 |
| Product | 구현 가능성/개발 난이도 |
| Moderator | 토론 정리 + Decision Packet 작성 |

토론 프로토콜:
1. **Evidence Round**: 근거 신호 인용
2. **Proposal Round**: 실행안 제시 (비용/KPI)
3. **Critique Round**: 상호 비판
4. **Synthesis Round**: 최종 합의안

### L3. Human Governance (Decision → Vote)

- MOC 토큰 가중치 투표
- Policy-based Delegation (정책 기반 위임)
- 위임 조건: 카테고리 제한, 예산 상한, 긴급안건 제외, 거부권

### L4. Proof of Outcome (Execute → Verify)

- KPI 측정 (참여율, 토론량, 실행 완료)
- 결과 증명 생성
- 에이전트/위임자 평판 업데이트

## 기술 스택

- **Frontend**: Next.js 14, TailwindCSS, next-intl
- **Backend**: Node.js, Express, TypeScript, SQLite
- **Blockchain**: Ethereum, viem (MOC 잔고 읽기 전용 — 체인에 쓰는 경로는 없음)
- **AI**: Claude API, OpenAI GPT-4 (하이브리드)
- **DevOps**: pm2, nginx
- **Monorepo**: pnpm + Turborepo

## 성공 기준 (2026 H1)

| 기준 | 결과 (2026-09-26) |
|------|------|
| AI Assisted Proposal 10개 생성 / 3개 이상 투표 진행 | 실제 제안 21개가 생겼지만 18개는 수집기 결함([#37](https://github.com/MosslandOpenDevs/bridge-2026/pull/37))에서 나왔고, 투표는 0건 |
| 체크인 오라클 참여 지갑 1,000+ | 체크인 오라클은 구현되지 않음 |
| 제안 작성/읽기 시간 30% 감소 | 측정한 적 없음 |

## 스크린샷

- 아래 화면들은 2026 H1 MVP 기준 UI 프로토타입이며, 모든 수치·이벤트·KPI는 목업(Mock) 데이터입니다.
1. Dashboard — Governance at a Glance
<img width="1111" height="968" alt="1" src="https://github.com/user-attachments/assets/47a80621-bd27-4190-99af-c1ea26a98308" />

2. Reality Feed — Signal → Issue Entry Point
<img width="1111" height="968" alt="2" src="https://github.com/user-attachments/assets/1d2abbb7-cfad-4cba-acc4-9cc3fce8ad09" />

3. Issues — AI-Detected Governance Problems
<img width="1111" height="968" alt="3" src="https://github.com/user-attachments/assets/045686bc-3f73-4683-a167-b02ae899834c" />

4. Proposals — AI Assisted Governance
<img width="1111" height="968" alt="4" src="https://github.com/user-attachments/assets/f009b10e-ee33-4c17-b325-4e2f03a1f1ee" />

5. Delegation — Policy-Based Trust
<img width="1111" height="968" alt="5" src="https://github.com/user-attachments/assets/b6e182e2-f558-4d48-8a9c-fd4838623f0c" />

6. Outcomes — Proof of Outcome
<img width="1111" height="968" alt="6" src="https://github.com/user-attachments/assets/8f99d790-a64f-442b-af72-17271d7551bb" />


## 링크

| 채널 | URL |
|------|-----|
| Website | [https://moss.land](https://moss.land) |
| Twitter | [https://x.com/TheMossland](https://x.com/TheMossland) |
| Medium | [https://medium.com/mossland-blog](https://medium.com/mossland-blog) |
| GitHub | [https://github.com/mossland](https://github.com/mossland) |
| Contact | contact@moss.land |

## 라이선스

Business Source License (BUSL 1.1)

---

© 2025, 2026 MOSSLAND. ALL RIGHTS RESERVED.
