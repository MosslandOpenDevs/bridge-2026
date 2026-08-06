# BRIDGE 2026 Frontend

모스코인 홀더를 위한 DAO 웹 인터페이스입니다.

## 개요

BRIDGE 2026의 주요 사용자 인터페이스로, 모스코인(ERC-20) 홀더가 거버넌스에 참여할 수 있는 웹 애플리케이션입니다.

## 기술 스택

- **Next.js 14**: React 프레임워크
- **TypeScript**: 타입 안전성
- **Tailwind CSS**: 스타일링
- **Wagmi + RainbowKit**: Web3 연결
- **Ethers.js**: 블록체인 상호작용
- **React Query**: 데이터 페칭

## 주요 기능

### 1. Reality Feed
- 실시간 신호 모니터링
- 이상 징후 하이라이트
- 신호 소스별 필터링

### 2. Proposals
- AI Assisted Proposal 목록
- Decision Packet 시각화
- 투표 인터페이스
- 투표 결과 확인

### 3. Delegation
- 위임 정책 설정
- 에이전트 선택
- 위임 내역 및 리포트

### 4. Outcomes
- 결과 리포트
- KPI 추적
- 에이전트 평판

## Moss Coin

- **Contract Address**: `0x8bbfe65e31b348cd823c62e02ad8c19a84dd0dab`
- **Type**: ERC-20
- **Purpose**: 거버넌스 토큰

## 시작하기

### 설치

이 패키지는 `@bridge-2026/shared`를 `workspace:*`로 참조하므로 **이 디렉터리에서
단독으로 설치할 수 없습니다.** 워크스페이스 루트(`nexus/`)에서 한 번 설치하면
`shared`가 함께 빌드되고 심볼릭 링크가 생성됩니다.

```bash
cd ..          # nexus/
pnpm install
```

### 환경 변수 설정

`.env.local` 파일을 생성하고 다음을 설정하세요:

```env
# 백엔드 API 주소 (기본값: http://localhost:3001)
NEXT_PUBLIC_API_URL=http://localhost:3001

NEXT_PUBLIC_MOSS_COIN_ADDRESS=0x8bbfe65e31b348cd823c62e02ad8c19a84dd0dab
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your-project-id
```

### 실행

```bash
npm run dev     # 개발 서버

npm run build   # 프로덕션 빌드
npm start

npm run lint
```

### 데모 모드

백엔드 없이 UI만 확인하려면 데모 모드로 실행합니다.

```bash
NEXT_PUBLIC_DEMO_MODE=true npm run dev
```

데모 모드에서는 API를 **호출하지 않고** `src/lib/demo-data.ts`의 예시 데이터를
보여주며, 모든 페이지 상단에 데모 배너가 표시되고 식별자에 `demo-` 접두사가
붙습니다. 이 값은 빌드 시점에 인라인되므로, 플래그 없이 빌드한 번들에서는 데모
모드를 켤 수 없습니다.

데모 데이터는 API 실패 시의 대체물이 **아닙니다**. 데모 모드가 꺼져 있으면 조회
실패는 화면에 오류로 표시되며, 존재하지 않는 데이터가 대신 노출되지 않습니다.

## 프로젝트 구조

```
src/
├── app/              # Next.js App Router
│   ├── page.tsx      # 홈 페이지
│   ├── reality-feed/ # Reality Feed 페이지
│   ├── proposals/    # Proposals 페이지
│   ├── delegation/   # Delegation 페이지
│   └── outcomes/     # Outcomes 페이지
├── components/       # React 컴포넌트
├── hooks/            # Custom hooks
├── lib/              # 유틸리티 함수
└── config/           # 설정 파일
```

## 개발 상태

현재 기본 구조와 주요 기능이 구현되었습니다:
- ✅ Next.js 14 프로젝트 설정
- ✅ Tailwind CSS 설정
- ✅ Wagmi + RainbowKit 연동
- ✅ 주요 페이지 구현:
  - 홈 페이지 (대시보드)
  - Reality Feed (신호 목록 및 필터링)
  - Proposals (제안 목록, 상세, 투표 기능)
  - Delegation (위임 정책 관리)
  - Outcomes (결과 리포트)
- ✅ 주요 컴포넌트:
  - ProposalCard, ProposalDetail
  - SignalCard
  - DelegationPolicyCard
  - OutcomeCard
- ✅ 백엔드 API 연동 (`src/lib/api.ts`, `NEXT_PUBLIC_API_URL`)
- 🚧 실제 투표 트랜잭션 (거버넌스 컨트랙트 미배포 — 투표는 API에만 기록됩니다)
- 🚧 Decision Packet 조회 API (제안 상세의 AI 분석 영역은 아직 비어 있습니다)

