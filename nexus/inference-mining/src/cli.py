"""
Inference Mining CLI

Inference Mining은 Python(numpy)으로 구현되어 있고 나머지 레이어는 TypeScript로
구현되어 있다. 두 런타임 사이에는 인프로세스 호출 경로가 없으므로, 이 모듈이
stdin/stdout JSON 프로토콜을 쓰는 프로세스 경계 역할을 한다.
(사용처: nexus/integration/governance-loop.ts)

실행:
    cd nexus/inference-mining
    python3 -m src.cli <command> < request.json

프로토콜:
    - 요청: stdin으로 들어오는 JSON 객체 하나
    - 성공: stdout으로 JSON 객체 하나, 종료 코드 0
    - 실패: stderr로 {"error": ...} JSON, 종료 코드 1

stdout은 반드시 JSON만 담아야 한다. 진단 출력은 전부 stderr로 보낸다.
"""

import json
import sys
from typing import Any, Dict

from .inference_mining import InferenceMining


def _extract_issue(request: Dict[str, Any]) -> Dict[str, Any]:
    """
    요청 JSON에서 이슈를 추출합니다.

    호출마다 새 InferenceMining 인스턴스를 만든다. 프로세스가 한 번의 요청만
    처리하고 끝나므로, 모듈 싱글톤의 detected_issues 누적은 여기서 의미가 없다.
    """
    signal_data = request.get("signalData", [])
    if not isinstance(signal_data, list):
        raise ValueError("signalData must be a list")

    title = request.get("issueTitle")
    description = request.get("issueDescription")
    if not title or not description:
        raise ValueError("issueTitle and issueDescription are required")

    return InferenceMining().extract_issue(
        signal_data=signal_data,
        issue_title=title,
        issue_description=description,
        priority=request.get("priority", "medium"),
    )


COMMANDS = {
    "extract-issue": _extract_issue,
}


def main(argv: list) -> int:
    if len(argv) != 2 or argv[1] not in COMMANDS:
        known = ", ".join(sorted(COMMANDS))
        print(
            json.dumps({"error": f"usage: python3 -m src.cli <{known}>"}),
            file=sys.stderr,
        )
        return 2

    try:
        request = json.loads(sys.stdin.read() or "{}")
        if not isinstance(request, dict):
            raise ValueError("request body must be a JSON object")
        result = COMMANDS[argv[1]](request)
    except Exception as exc:  # 호출자는 JSON만 파싱하므로 예외도 JSON으로 보고한다
        print(json.dumps({"error": f"{type(exc).__name__}: {exc}"}), file=sys.stderr)
        return 1

    json.dump(result, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
