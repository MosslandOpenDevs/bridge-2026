# Nexus

**Nexus**는 BRIDGE 2026의 핵심 구현 코드를 담는 코드네임입니다. 

"Nexus"는 **연결점**을 의미하며, 5개의 거버넌스 레이어가 만나고 상호작용하는 중심을 나타냅니다.

## 구조

이 폴더는 BRIDGE 2026의 모든 구현 레이어를 포함합니다:

- **reality-oracle/** - 실세계 신호를 검증 가능한 거버넌스 입력으로 변환 ✅ (기본 프레임워크 + 온체인/체크인 수집기 완료)
- **inference-mining/** - 신호에서 이슈 추출 및 제안 초안 생성 ✅ (기본 구조 완료)
- **agentic-consensus/** - 멀티 에이전트 협의 및 Decision Packet 생성 ✅ (5개 에이전트 완료)
- **human-governance/** - 인간 거버넌스 인터페이스 및 투표 시스템 ✅ (기본 구조 + Delegation 완료)
- **atomic-actuation/** - 거버넌스 통과 시 온체인/오프체인 실행을 원자적으로 트리거 ✅ (기본 구조 완료)
- **proof-of-outcome/** - 결과 측정, 평가 및 온체인 증명 ✅ (기본 구조 완료)
- **shared/** - 모든 레이어에서 공유하는 타입, 유틸리티, 설정 ✅ (타입 정의 완료)
- **infrastructure/** - 시스템 인프라 컴포넌트 (이벤트 버스, 데이터베이스, 모니터링) ✅ (이벤트 버스, DB 스키마 완료)
- **frontend/** - 웹 인터페이스 (Next.js) ✅ (기본 구조 완료)
- **scripts/** - 유틸리티 스크립트
- **implementation/** - 구현 계획 및 프로젝트 구조 문서

## 거버넌스 루프

```
Reality Oracle → Inference Mining → Agentic Consensus → Human Governance → Atomic Actuation → Proof of Outcome
                                                                                                      ↓
                                                                                              (Feedback Loop)
```

각 레이어는 독립적으로 개발 가능하지만, `shared/`와 `infrastructure/`를 통해 통합됩니다.

## 구현 상태

### ✅ 완료된 작업

1. **공통 타입 정의** (`shared/types/`)
   - Signal, Issue, DecisionPacket, Proposal, Outcome 타입 정의
   - TypeScript로 완전히 타입 안전한 구조

2. **이벤트 버스** (`infrastructure/event-bus/`)
   - 이벤트 발행/구독 시스템
   - 레이어 간 비동기 통신 지원

3. **Reality Oracle 기본 프레임워크** (`reality-oracle/`)
   - 신호 수집기 기본 클래스
   - 신호 정규화 엔진
   - 암호화 서명 및 해시 체인
   - 메인 Reality Oracle 서비스

4. **Inference Mining 기본 구조** (`inference-mining/`)
   - 통계적 이상 탐지 (Z-score, IQR)
   - 시계열 트렌드 분석
   - 이슈 클러스터링
   - 메인 Inference Mining 서비스

5. **데이터베이스 스키마** (`infrastructure/database/`)
   - PostgreSQL 스키마 정의
   - 모든 주요 엔티티 테이블
   - 인덱스 및 제약조건
   - 마이그레이션 파일

6. **Agentic Consensus 기본 구조** (`agentic-consensus/`)
   - 5개 전문 에이전트 (Risk, Treasury, Community, Product, Moderator)
   - 멀티 라운드 협의 엔진
   - 모더레이터 및 Decision Packet 생성
   - 합의 점수 계산

7. **Human Governance 기본 구조** (`human-governance/`)
   - 거버넌스 서비스 (Decision Packet → Proposal)
   - Agora 연동
   - 정책 기반 위임 시스템 (Delegation)
   - 투표 관리 및 결과 계산

8. **Atomic Actuation 기본 구조** (`atomic-actuation/`)
   - 온체인 실행 (트레저리, 파라미터 변경)
   - 오프체인 실행 (GitHub, 캠페인, 공지)
   - 원자적 실행 보장

9. **Proof of Outcome 기본 구조** (`proof-of-outcome/`)
   - KPI 추적 시스템
   - 결과 평가 엔진
   - 신뢰도 및 평판 시스템

10. **구체적인 수집기 구현**
    - 온체인 수집기 (거버넌스 활동 모니터링)
    - 체크인 수집기 (Proof-of-Presence)
    - City Pulse 수집기 (도시 오픈데이터: 날씨, 대기질, 교통, 유동인구, 이벤트)
    - GitHub 수집기 (PR, 이슈, 릴리즈, 워크플로우)

11. **토론 프로토콜 구현** (`agentic-consensus/`)
    - Evidence Round: 근거 신호 인용
    - Proposal Round: 실행안 제시
    - Critique Round: 상호 비판
    - Synthesis Round: Moderator 최종 종합

12. **LLM 통합 준비** (`agentic-consensus/`, `inference-mining/`)
    - Gemini API 클라이언트 기본 구조
    - 제안 초안 생성기

13. **BridgeLog 스마트 컨트랙트** (`human-governance/contracts/`)
    - 일일 신호 머클루트 앵커링
    - Decision Packet CID 앵커링
    - Outcome Proof CID 앵커링

14. **전체 시스템 통합 예제** (`integration/`)
    - 전체 거버넌스 루프 실행 예제

15. **설정 관리** (`shared/config/`)
    - 전역 설정 관리 시스템
    - 환경 변수 기반 설정
    - 타입 안전한 설정 인터페이스

16. **유틸리티 함수** (`shared/utils/`)
    - 에러 핸들링 (커스텀 에러 타입)
    - 로깅 시스템 (Logger)
    - 데이터 검증 (Validation)
    - 데이터 포맷팅 (Format)
    - 기본 테스트 코드

17. **웹 프론트엔드** (`frontend/`)
    - Next.js 14 기반 웹 인터페이스
    - 모스코인 홀더를 위한 DAO 인터페이스
    - Wagmi + RainbowKit 연동
    - 주요 페이지: Reality Feed, Proposals, Delegation, Outcomes
    - Moss Coin (ERC-20) 컨트랙트 주소 설정
    - 백엔드 API 연동

18. **백엔드 API 서버** (`backend/`)
    - NestJS 기반 RESTful API
    - 주요 엔드포인트: Signals, Proposals, Delegation, Outcomes
    - Moss Coin 잔액 조회 (투표 가중치 계산)
    - 블록체인 서비스 (Ethers.js)

### 📋 다음 단계

- 실제 LLM API 통합 (Gemini API 실제 호출)
- 프론트엔드 UI 구현 (Reality Feed, Decision Packet 뷰, Delegation Console)
- 공개 데이터셋 어댑터 (City Pulse Oracle)
- GitHub 신호 오라클
- 실제 블록체인 RPC 연동
- 실제 Agora API 연동
- BridgeLog 컨트랙트 배포 및 연동
- 통합 테스트 및 E2E 테스트

## 시작하기

### 의존성 설치

`nexus/`는 하나의 pnpm 워크스페이스입니다. 레이어 패키지들은 서로를
`workspace:*`로 참조하는데, 이 지정자는 워크스페이스 루트를 통해서만 해석됩니다.
(npm은 `workspace:` 프로토콜을 지원하지 않으므로 개별 폴더에서 `npm install`을
실행하면 해석에 실패합니다.) 설치는 `nexus/`에서 한 번만 합니다:

```bash
cd nexus
pnpm install
```

설치가 끝나면 각 패키지의 `node_modules/@bridge-2026/*`가 워크스페이스 폴더로
심볼릭 링크되고, `shared`는 자신의 `prepare` 스크립트로 자동 빌드됩니다
(다른 패키지가 `shared/dist`의 타입을 바로 참조할 수 있어야 하기 때문입니다).

나머지 레이어는 워크스페이스 의존성 순서대로 빌드합니다:

```bash
pnpm -r build

# 특정 패키지만
pnpm --filter @bridge-2026/reality-oracle build
```

앱 실행:

```bash
pnpm --filter @bridge-2026/backend start:dev
pnpm --filter @bridge-2026/frontend dev
```

### 사용 예제

```typescript
import { realityOracle } from '@bridge-2026/reality-oracle';
import { eventSubscriber, EventType } from '@bridge-2026/event-bus';

// 이벤트 구독
eventSubscriber.subscribe(EventType.SIGNAL_COLLECTED, (event) => {
  console.log('Signal collected:', event.data);
});

// Reality Oracle 시작
await realityOracle.startCollectors();
```

## 상세 문서

각 레이어의 상세한 설명은 각 폴더의 README.md를 참조하세요.

전체 구현 계획은 `implementation/implementation-plan.md`를 참조하세요.
