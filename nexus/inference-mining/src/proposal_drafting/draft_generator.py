"""
Proposal Draft Generator

LLM을 사용하여 제안 초안을 생성합니다.
"""

from typing import List, Dict, Any, Optional
import json


class ProposalDraftGenerator:
    """제안 초안 생성기"""
    
    def __init__(self, llm_client=None):
        """
        Args:
            llm_client: LLM 클라이언트 (Gemini API 등)
        """
        self.llm_client = llm_client
    
    def generate_draft(
        self,
        issue: Dict[str, Any],
        evidence_signals: List[Dict[str, Any]],
        context: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        이슈로부터 제안 초안을 생성합니다.
        
        Args:
            issue: 이슈 딕셔너리
            evidence_signals: 증거 신호 리스트
            context: 추가 컨텍스트
        
        Returns:
            제안 초안 딕셔너리
        """
        # LLM이 있으면 사용, 없으면 템플릿 기반 생성
        if self.llm_client:
            return self._generate_with_llm(issue, evidence_signals, context)
        else:
            return self._generate_with_template(issue, evidence_signals)
    
    def _generate_with_llm(
        self,
        issue: Dict[str, Any],
        evidence_signals: List[Dict[str, Any]],
        context: Optional[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """LLM을 사용하여 제안 초안 생성"""
        # TODO: 실제 LLM API 호출
        # prompt = self._build_prompt(issue, evidence_signals, context)
        # response = self.llm_client.generate(prompt)
        # return self._parse_llm_response(response)
        
        # 임시 구현
        return self._generate_with_template(issue, evidence_signals)
    
    def _generate_with_template(
        self,
        issue: Dict[str, Any],
        evidence_signals: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """템플릿 기반 제안 초안 생성"""
        draft = {
            "title": f"[AI Assisted] {issue.get('title', '제안')}",
            "description": self._build_description(issue, evidence_signals),
            "background": {
                "issue": issue.get('description', ''),
                "evidence_count": len(evidence_signals),
                "priority": issue.get('priority', 'medium'),
            },
            "proposed_actions": self._extract_actions(issue),
            "expected_outcomes": self._extract_outcomes(issue),
            "risks": self._extract_risks(issue),
            "implementation_timeline": "1-2주",
        }
        
        return draft
    
    def _build_description(
        self,
        issue: Dict[str, Any],
        evidence_signals: List[Dict[str, Any]]
    ) -> str:
        """설명을 생성합니다."""
        description = f"""
## 문제 상황

{issue.get('description', '')}

## 증거

관련 신호 {len(evidence_signals)}개가 수집되었습니다.

## 제안

이 문제를 해결하기 위해 다음과 같은 조치를 제안합니다.
"""
        return description.strip()
    
    def _extract_actions(self, issue: Dict[str, Any]) -> List[str]:
        """액션을 추출합니다."""
        # 이슈의 제안된 액션에서 추출
        suggested_actions = issue.get('suggested_actions', [])
        if suggested_actions:
            return suggested_actions
        
        # 기본 액션
        return [
            "문제 분석 및 원인 파악",
            "해결 방안 수립",
            "실행 및 모니터링",
        ]
    
    def _extract_outcomes(self, issue: Dict[str, Any]) -> List[str]:
        """예상 결과를 추출합니다."""
        return [
            "문제 해결",
            "시스템 개선",
            "커뮤니티 만족도 향상",
        ]
    
    def _extract_risks(self, issue: Dict[str, Any]) -> List[str]:
        """위험을 추출합니다."""
        # 증거에서 위험 정보 추출
        evidence = issue.get('evidence', {})
        risks = []
        
        if evidence.get('statisticalEvidence', {}).get('anomalyScore', 0) > 0.7:
            risks.append("높은 이상 점수로 인한 예상치 못한 결과 가능")
        
        return risks if risks else ["일반적인 실행 위험"]


# 싱글톤 인스턴스
proposal_draft_generator = ProposalDraftGenerator()









