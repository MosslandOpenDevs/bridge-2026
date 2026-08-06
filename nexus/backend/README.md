# BRIDGE 2026 Backend API Server

모스코인 홀더를 위한 DAO 백엔드 API 서버입니다.

## 개요

NestJS 기반의 RESTful API 서버로, 프론트엔드와 거버넌스 레이어를 연결합니다.

## 기술 스택

- **NestJS**: Node.js 프레임워크
- **TypeScript**: 타입 안전성
- **TypeORM**: PostgreSQL ORM
- **Ethers.js**: 블록체인 상호작용 및 지갑 서명 검증

## 주요 API 엔드포인트

### Health Check
- `GET /health` - 서버 상태 확인

### Signals
- `GET /api/signals` - 신호 목록 조회 (`sourceType`, `limit`, `offset`)
- `POST /api/signals/collect` - 신호 수집 트리거

### Proposals
- `GET /api/proposals` - 제안 목록 조회 (`status`, `limit`, `offset`)
- `GET /api/proposals/:id` - 제안 상세 조회
- `POST /api/proposals/:id/vote` - 투표 (지갑 서명 필요)
- `POST /api/proposals/:id/tally` - 투표 집계

### Delegation
- `GET /api/delegation/policies` - 위임 정책 목록 (`wallet`)
- `POST /api/delegation/policies` - 위임 정책 생성 (지갑 서명 필요)
- `DELETE /api/delegation/policies/:id` - 위임 정책 삭제 (지갑 서명 필요)

### Blockchain
- `GET /api/blockchain/balance/:address` - Moss Coin 잔액
- `GET /api/blockchain/total-supply` - 총 공급량
- `GET /api/blockchain/transaction/:txHash` - 트랜잭션 조회

## 지갑 서명 (투표 · 위임)

투표 가중치는 요청이 지목한 주소의 Moss Coin 잔액이고, 위임 정책은 그 지갑의
영향력을 에이전트에게 넘깁니다. 따라서 주소를 적어 내는 것만으로는 부족하고,
해당 지갑이 서명한 증거가 함께 와야 합니다. 검증 로직은 `src/security.ts`에
있으며 oracle 트리의 `apps/api/src/security.ts`와 같은 모양입니다.

요청에 `signature`, `nonce`, `timestamp`(epoch ms)를 함께 보냅니다. 서명은
`personal_sign`(EIP-191)이고, 서명 대상 문자열은 다음과 같이 구성합니다.

투표:

```
BRIDGE 2026 Vote
Proposal: <proposalId>
Voter: <소문자 주소>
Choice: <yes|no|abstain>
Nonce: <nonce>
Timestamp: <timestamp>
```

위임 생성:

```
BRIDGE 2026 Delegation
Action: create
Wallet: <소문자 주소>
Agent: <agent_id>
Policy: <정책 항목의 canonical JSON>
Nonce: <nonce>
Timestamp: <timestamp>
```

위임 삭제는 `Action: delete`와 `PolicyId: <id>`를 사용합니다.

`Policy`에 들어가는 canonical JSON은 아래 객체를 키 알파벳순으로 정렬해 직렬화한
것입니다. 값이 없는 항목은 `JSON.stringify`가 그렇듯 빠지며, `scope`는 생략 시
`{}`입니다.

```
{ scope, max_budget_per_month, max_budget_per_proposal, no_vote_on_emergency,
  cooldown_window_hours, veto_enabled, require_human_review_above,
  max_votes_per_day }
```

정책 항목이 서명 대상에 포함되므로, 가로챈 서명으로 예산 한도만 올려 재제출할 수
없습니다.

- 유효 시간은 ±5분이고, 같은 nonce는 한 번만 사용할 수 있습니다.
- 첫 줄의 `BRIDGE 2026`은 도메인 구분자입니다. oracle 트리는 `BRIDGE Oracle`로
  시작하므로 한쪽에서 받은 서명을 다른 쪽에 재사용할 수 없습니다.
- nonce 기록은 프로세스 메모리에 있습니다. 인스턴스를 여러 개 띄우면 공유 저장소가
  필요하고, 그전까지는 같은 서명을 인스턴스마다 한 번씩 쓸 수 있습니다.

## 시작하기

### 설치

이 패키지는 `nexus/` pnpm 워크스페이스의 일부입니다. 워크스페이스 루트에서 한 번
설치하세요. 이 디렉터리에서 `npm install`을 실행하면 `workspace:*` 의존성을
해석하지 못합니다.

```bash
cd nexus
pnpm install
pnpm -r build   # shared와 레이어 패키지를 먼저 빌드합니다
```

### 환경 변수 설정

`.env` 파일을 생성하고 다음을 설정하세요:

```env
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:3000

# 데이터베이스: DATABASE_URL이 있으면 그것을 쓰고, 없으면 DB_* 값을 씁니다.
DATABASE_URL=postgresql://user:password@localhost:5432/bridge2026
# DB_HOST=localhost
# DB_PORT=5432
# DB_USERNAME=postgres
# DB_PASSWORD=postgres
# DB_NAME=bridge2026

RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
MOSS_COIN_ADDRESS=0x8bbfe65e31b348cd823c62e02ad8c19a84dd0dab

# 분당 전역 요청 한도 (기본 120)
RATE_LIMIT_GLOBAL=120

# 지갑 서명 요구 여부. 기본값은 요구입니다. "never"는 NODE_ENV=production이
# 아닐 때만 존중되며, 데모 목적 외에는 켜지 마세요.
# REQUIRE_VOTE_SIGNATURE=never
# REQUIRE_DELEGATION_SIGNATURE=never

GEMINI_API_KEY=
```

### 데이터베이스 준비

`synchronize`는 `NODE_ENV=development`일 때만 켜집니다. 그 외 환경에서는 스키마를
직접 적용해야 합니다.

```bash
psql -U postgres -d bridge2026 -f ../infrastructure/database/migrations/001_initial_schema.sql
```

엔티티(`src/entities/`)는 이 마이그레이션의 테이블에 그대로 매핑됩니다. 한쪽만
바꾸면 서버가 존재하지 않는 컬럼을 조회하게 됩니다.

### 실행

```bash
# 개발 서버 실행
npm run start:dev

# 프로덕션 빌드
npm run build
npm run start:prod
```

## 개발 상태

- ✅ NestJS 프로젝트 설정
- ✅ 주요 API 엔드포인트 구현
- ✅ Moss Coin 잔액 조회 (투표 가중치 계산)
- ✅ PostgreSQL 데이터베이스 연동 (TypeORM)
- ✅ 데이터베이스 엔티티 및 리포지토리 구현
- ✅ 투표·위임 지갑 서명 검증 (nonce·timestamp 재사용 방지 포함)
- ✅ LLM 서비스 (Gemini API) — 클라이언트는 아직 스텁 응답을 돌려줍니다
- 🚧 자동화 테스트 없음 (`npm test`는 테스트 파일이 없어 실패합니다)
- 🚧 실제 블록체인 트랜잭션 서명 및 전송 (예정)
