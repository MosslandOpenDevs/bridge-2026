# Integration Examples

전체 거버넌스 루프를 통합하는 예제입니다.

## Governance Loop

`governance-loop.ts`는 전체 거버넌스 루프를 실행하는 예제입니다:

1. **Reality Oracle**: 신호 수집
2. **Inference Mining**: 이슈 추출 — 이 단계만 Python 프로세스 호출
3. **Agentic Consensus**: 에이전트 협의
4. **Human Governance**: Proposal 생성 및 투표
5. **Atomic Actuation**: 실행
6. **Proof of Outcome**: 결과 측정

2번을 제외한 모든 레이어는 TypeScript로 구현되어 있어 직접 import한다.
Inference Mining은 Python(numpy)이라 인프로세스로 부를 수 없고,
`nexus/inference-mining/src/cli.py`를 자식 프로세스로 띄워 stdin/stdout JSON을
주고받는다. 그래서 이 예제는 Node뿐 아니라 Python 런타임도 필요하다.

## 사용 방법

```typescript
import { runGovernanceLoop } from './governance-loop';

// 전체 루프 실행
await runGovernanceLoop();
```

## 실행 전 준비

1. TypeScript 레이어 설치 및 빌드 (nexus 루트에서):
   ```bash
   cd nexus
   pnpm install
   pnpm -r build
   ```
   `governance-loop.ts`는 `../reality-oracle` 처럼 디렉터리를 가리키는 상대
   경로로 각 레이어를 import한다. 이 경로는 해당 패키지 package.json의
   `main`/`types`, 즉 `dist/`로 해석되므로 빌드가 먼저 끝나 있어야 한다.

2. Python 레이어 설치:
   ```bash
   cd nexus/inference-mining
   python3 -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
   ```

3. 환경 변수 설정:
   - `RPC_URL`: 이더리움 RPC URL
   - `GEMINI_API_KEY`: Gemini API 키 (선택)
   - `PYTHON_BIN`: Python 인터프리터 경로 (선택, 기본값 `python3`).
     venv를 쓰면서 그 venv를 activate하지 않은 셸에서 실행할 때 필요하다.

4. 실행:
   ```bash
   pnpm dlx tsx nexus/integration/governance-loop.ts
   ```
   이 디렉터리에는 package.json이 없다. pnpm 워크스페이스 멤버가 아니라서
   자체 node_modules도 없으므로, TypeScript 러너는 위처럼 외부에서 가져와야
   한다. 예제 한 개짜리 디렉터리를 별도 패키지로 만들지 않으려는 선택이다.









