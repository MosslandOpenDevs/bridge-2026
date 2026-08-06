# Inference Mining

Inference Mining은 원시 신호에서 이슈를 추출하고 거버넌스 관련 제안 초안을 생성하는 레이어입니다.

## 개요

이 레이어는 Reality Oracle에서 수집된 신호를 분석하여 거버넌스에 관련된 이슈를 식별하고 구조화된 제안 초안을 생성합니다.

## 주요 기능

- **이상 탐지**: 통계적 이상치 및 패턴 변화 감지
- **트렌드 분석**: 시계열 분석 및 예측 모델링
- **이슈 그룹화**: 유사 신호 클러스터링 및 우선순위화
- **제안 초안 생성**: LLM 기반 구조화된 제안서 생성 (예정)

## 구조

디렉터리와 파일 이름은 모두 밑줄을 쓴다. 다른 레이어는 하이픈을 쓰지만,
하이픈이 들어간 이름은 Python 식별자가 아니라서 import할 수 없다.

- `src/anomaly_detection/`: 이상 탐지 알고리즘
  - `statistical_detector.py`: Z-score, IQR 기반 이상 탐지
- `src/trend_analysis/`: 트렌드 및 패턴 분석
  - `time_series.py`: 시계열 분석 및 변화점 감지
- `src/issue_grouping/`: 이슈 클러스터링 및 우선순위화
  - `clustering.py`: 유사도 기반 이슈 클러스터링
- `src/proposal_drafting/`: 제안 초안 생성
  - `draft_generator.py`: 템플릿/LLM 기반 제안 초안 생성
- `src/cli.py`: TypeScript 레이어가 쓰는 stdin/stdout JSON 프로세스 경계

## 설치

```bash
cd nexus/inference-mining
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

## 사용 예제

패키지 루트는 `nexus/inference-mining`이고 import 이름은 `src`다.
아래 코드는 그 디렉터리에서 실행해야 한다.

```python
from src import inference_mining

# 신호 데이터로부터 이슈 추출
signal_data = [...]  # 신호 리스트
issue = inference_mining.extract_issue(
    signal_data=signal_data,
    issue_title="거버넌스 참여율 감소",
    issue_description="최근 거버넌스 참여율이 지속적으로 감소하고 있습니다.",
    priority="high"
)

# 이슈 그룹화
issues = inference_mining.get_detected_issues()
clustering_result = inference_mining.group_issues(issues)
```

## 다른 런타임에서 호출하기

TypeScript 레이어에는 이 코드에 해당하는 구현이 없다. 인프로세스로 부를 방법이
없으므로 `src/cli.py`가 프로세스 경계를 담당한다. 요청 JSON은 stdin으로,
결과 JSON은 stdout으로 오간다.

```bash
cd nexus/inference-mining
echo '{
  "signalData": [{"id": "s1", "data": {"participation": 10}, "metadata": {"timestamp": 1}}],
  "issueTitle": "거버넌스 참여율 감소",
  "issueDescription": "최근 거버넌스 참여율이 지속적으로 감소하고 있습니다.",
  "priority": "high"
}' | python3 -m src.cli extract-issue
```

실패하면 종료 코드가 0이 아니고 stderr로 `{"error": ...}`가 나온다.
호출 예시는 `nexus/integration/governance-loop.ts`를 참고.

## 개발 상태

현재 기본 구조가 구현되었습니다:
- ✅ 이상 탐지 (Z-score, IQR)
- ✅ 트렌드 분석 (선형 회귀)
- ✅ 이슈 클러스터링
- ✅ 제안 초안 생성기 (템플릿 기반, LLM 통합 준비 완료)
- 🚧 실제 LLM API 통합 (향후 개선 예정)
