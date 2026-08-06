"""
Inference Mining

신호로부터 이슈를 추출하고 제안 초안을 생성하는 메인 서비스입니다.
"""

from typing import List, Dict, Any, Optional
from datetime import datetime
import uuid

from .anomaly_detection.statistical_detector import StatisticalDetector, AnomalyResult
from .trend_analysis.time_series import TimeSeriesAnalyzer, TrendResult
from .issue_grouping.clustering import IssueClusterer, ClusteringResult
from .proposal_drafting.draft_generator import ProposalDraftGenerator, proposal_draft_generator


class InferenceMining:
    """Inference Mining 서비스"""
    
    def __init__(self):
        self.anomaly_detector = StatisticalDetector(threshold=3.0)
        self.trend_analyzer = TimeSeriesAnalyzer(min_data_points=3)
        self.issue_clusterer = IssueClusterer(similarity_threshold=0.7)
        self.draft_generator = proposal_draft_generator
        self.detected_issues: List[Dict[str, Any]] = []
    
    def detect_anomaly(self, signal_data: List[Dict[str, Any]], metric_key: str) -> Optional[AnomalyResult]:
        """
        신호 데이터에서 이상을 탐지합니다.
        
        Args:
            signal_data: 신호 데이터 리스트
            metric_key: 분석할 메트릭 키
        
        Returns:
            AnomalyResult 또는 None
        """
        values = []
        for signal in signal_data:
            if metric_key in signal.get("data", {}):
                try:
                    value = float(signal["data"][metric_key])
                    values.append(value)
                except (ValueError, TypeError):
                    continue
        
        if len(values) < 2:
            return None
        
        return self.anomaly_detector.detect(values, method="zscore")
    
    def analyze_trend(self, signal_data: List[Dict[str, Any]], metric_key: str) -> Optional[TrendResult]:
        """
        신호 데이터의 트렌드를 분석합니다.
        
        Args:
            signal_data: 신호 데이터 리스트
            metric_key: 분석할 메트릭 키
        
        Returns:
            TrendResult 또는 None
        """
        values = []
        timestamps = []
        
        for signal in signal_data:
            if metric_key in signal.get("data", {}):
                try:
                    value = float(signal["data"][metric_key])
                    values.append(value)
                    timestamps.append(signal.get("metadata", {}).get("timestamp", 0))
                except (ValueError, TypeError):
                    continue
        
        if len(values) < 3:
            return None
        
        return self.trend_analyzer.detect_trend(values, timestamps if timestamps else None)
    
    def extract_issue(self, signal_data: List[Dict[str, Any]], issue_title: str, 
                      issue_description: str, priority: str = "medium") -> Dict[str, Any]:
        """
        신호 데이터로부터 이슈를 추출합니다.
        
        Args:
            signal_data: 관련 신호 데이터
            issue_title: 이슈 제목
            issue_description: 이슈 설명
            priority: 우선순위
        
        Returns:
            이슈 딕셔너리
        """
        now = int(datetime.now().timestamp() * 1000)
        
        # 관련 신호 정보 수집
        related_signals = []
        for signal in signal_data:
            related_signals.append({
                "signalId": signal.get("id", ""),
                "relevanceScore": 1.0,
                "relevanceReason": "Directly related to issue"
            })
        
        # 통계적 증거 수집
        statistical_evidence = {}
        if len(signal_data) > 0:
            # 첫 번째 메트릭으로 이상 탐지 시도
            first_signal = signal_data[0]
            if isinstance(first_signal.get("data"), dict):
                metric_keys = list(first_signal["data"].keys())
                if metric_keys:
                    anomaly_result = self.detect_anomaly(signal_data, metric_keys[0])
                    if anomaly_result and anomaly_result.is_anomaly:
                        statistical_evidence["anomalyScore"] = anomaly_result.anomaly_score
            
            # 트렌드 분석
            if metric_keys:
                trend_result = self.analyze_trend(signal_data, metric_keys[0])
                if trend_result:
                    statistical_evidence["trendDirection"] = trend_result.direction
                    statistical_evidence["trendStrength"] = trend_result.strength
        
        issue = {
            "id": str(uuid.uuid4()),
            "title": issue_title,
            "description": issue_description,
            "priority": priority,
            "status": "detected",
            "evidence": {
                "signals": related_signals,
                "statisticalEvidence": statistical_evidence
            },
            "categories": [],
            "detectedAt": now,
            "updatedAt": now
        }
        
        self.detected_issues.append(issue)
        return issue
    
    def group_issues(self, issues: List[Dict[str, Any]]) -> ClusteringResult:
        """
        이슈들을 그룹화합니다.
        
        Args:
            issues: 이슈 리스트
        
        Returns:
            ClusteringResult: 클러스터링 결과
        """
        return self.issue_clusterer.cluster(issues, method="simple")
    
    def generate_proposal_draft(
        self,
        issue: Dict[str, Any],
        context: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        이슈로부터 제안 초안을 생성합니다.
        
        Args:
            issue: 이슈 딕셔너리
            context: 추가 컨텍스트
        
        Returns:
            제안 초안 딕셔너리
        """
        evidence_signals = issue.get('evidence', {}).get('signals', [])
        draft = self.draft_generator.generate_draft(issue, evidence_signals, context)
        
        # 이슈에 초안 추가
        issue['auto_generated_proposal_draft'] = draft
        
        return draft
    
    def get_detected_issues(self) -> List[Dict[str, Any]]:
        """감지된 이슈들을 반환합니다."""
        return self.detected_issues.copy()
    
    def clear_issues(self):
        """감지된 이슈들을 초기화합니다."""
        self.detected_issues = []


# 싱글톤 인스턴스
inference_mining = InferenceMining()

