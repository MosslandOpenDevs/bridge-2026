# Reality Oracle

Reality Oracle는 실세계 또는 시스템 레벨 신호를 검증 가능한 거버넌스 입력으로 변환하는 레이어입니다.

## 개요

이 레이어는 BRIDGE 2026 거버넌스 시스템의 첫 번째 단계로, 다양한 소스에서 신호를 수집하고 정규화하며 증명합니다.

## 주요 기능

- **신호 수집**: 온체인 활동, 커뮤니티 참여, 공개 데이터셋, 제품 원격 측정
- **신호 정규화**: 다양한 형식의 신호를 표준 형식으로 변환
- **증명 및 감사**: 신호의 무결성 검증 및 감사 로그 생성

## 구조

- `collectors/`: 신호 수집기
  - `base-collector.ts`: 기본 수집기 클래스
  - `onchain/`: 온체인 거버넌스 활동 수집기 ✅
  - `community/`: 커뮤니티 체크인 수집기 ✅
  - `public-data/`: 공개 데이터셋 어댑터 ✅
    - `city-pulse-collector.ts`: 도시 오픈데이터 수집기 (날씨, 대기질, 교통, 유동인구, 이벤트)
  - `telemetry/`: 제품 원격 측정 ✅
    - `github-collector.ts`: GitHub 개발 신호 수집기 (PR, 이슈, 릴리즈, 워크플로우)
- `normalizers/`: 신호 정규화 엔진 ✅
- `attestation/`: 증명 및 감사 레이어 ✅
- `reality-oracle.ts`: 메인 서비스 ✅

## 사용 예제

```typescript
import { realityOracle, OnChainCollector, CheckInCollector } from '@bridge-2026/reality-oracle';

// 온체인 수집기 등록
const onchainCollector = new OnChainCollector({
  rpcUrl: 'https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY',
  contractAddress: '0x...',
});
realityOracle.registerCollector(onchainCollector);

// 체크인 수집기 등록
const checkinCollector = new CheckInCollector();
realityOracle.registerCollector(checkinCollector);

// 수집기 시작
await realityOracle.startCollectors(60000); // 1분마다 수집
```

## 테스트

```bash
pnpm --filter @bridge-2026/reality-oracle test
```

해시 체인(`attestation/hash-chain.ts`)의 `verify()`는 저장된 노드만으로 판정하도록
설계되어 있어, 원본 신호 없이도 변조·재정렬·중간 삭제를 잡아냅니다. 단, 꼬리에서
노드를 잘라낸 체인은 그 자체로 유효한 접두사이므로 `verify()`만으로는 탐지되지
않습니다. 절단까지 막으려면 마지막 노드의 해시를 체인 밖에 고정해 두고 대조해야
합니다. 페이로드 자체의 변조는 원본 신호를 가진 쪽에서 `verifySignal(signal)`로
확인합니다.

## 개발 상태

현재 기본 구조가 구현되었습니다:
- ✅ 기본 수집기 프레임워크
- ✅ 온체인 수집기 (거버넌스 활동 모니터링)
- ✅ 체크인 수집기 (Proof-of-Presence)
- ✅ City Pulse 수집기 (도시 오픈데이터: 날씨, 대기질, 교통, 유동인구, 이벤트)
- ✅ GitHub 수집기 (PR, 이슈, 릴리즈, 워크플로우)
- ✅ 신호 정규화 및 증명 레이어
- 🚧 실제 API 연동 (향후 개선 예정)

