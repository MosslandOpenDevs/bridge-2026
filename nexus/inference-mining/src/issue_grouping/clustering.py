"""
Issue Clustering

유사한 이슈들을 클러스터링합니다.
"""

from typing import List, Dict, Any, Optional
from dataclasses import dataclass
import numpy as np


@dataclass
class Cluster:
    """클러스터"""
    id: str
    issues: List[str]  # 이슈 ID 리스트
    centroid: Dict[str, float]
    similarity_score: float


@dataclass
class ClusteringResult:
    """클러스터링 결과"""
    clusters: List[Cluster]
    method: str
    details: Dict[str, Any]


class IssueClusterer:
    """이슈 클러스터링기"""
    
    def __init__(self, similarity_threshold: float = 0.7):
        """
        Args:
            similarity_threshold: 유사도 임계값 (0-1)
        """
        self.similarity_threshold = similarity_threshold
    
    def extract_features(self, issue: Dict[str, Any]) -> np.ndarray:
        """
        이슈에서 특징 벡터를 추출합니다.
        
        Args:
            issue: 이슈 딕셔너리
        
        Returns:
            특징 벡터
        """
        features = []
        
        # 우선순위 점수 (0-1)
        priority_map = {"low": 0.25, "medium": 0.5, "high": 0.75, "critical": 1.0}
        features.append(priority_map.get(issue.get("priority", "medium"), 0.5))
        
        # 카테고리 인코딩 (간단한 예시)
        categories = issue.get("categories", [])
        category_count = len(categories)
        features.append(min(category_count / 5.0, 1.0))
        
        # 증거 신호 수
        evidence_signals = issue.get("evidence", {}).get("signals", [])
        signal_count = len(evidence_signals)
        features.append(min(signal_count / 10.0, 1.0))
        
        # 이상 점수
        anomaly_score = issue.get("evidence", {}).get("statisticalEvidence", {}).get("anomalyScore", 0.0)
        features.append(anomaly_score)
        
        return np.array(features)
    
    def calculate_similarity(self, features1: np.ndarray, features2: np.ndarray) -> float:
        """
        두 특징 벡터 간의 유사도를 계산합니다 (코사인 유사도).
        
        Args:
            features1: 첫 번째 특징 벡터
            features2: 두 번째 특징 벡터
        
        Returns:
            유사도 (0-1)
        """
        dot_product = np.dot(features1, features2)
        norm1 = np.linalg.norm(features1)
        norm2 = np.linalg.norm(features2)
        
        if norm1 == 0 or norm2 == 0:
            return 0.0
        
        similarity = dot_product / (norm1 * norm2)
        return float(max(0.0, min(1.0, similarity)))  # 0-1 범위로 제한
    
    def cluster_simple(self, issues: List[Dict[str, Any]]) -> ClusteringResult:
        """
        간단한 거리 기반 클러스터링을 수행합니다.
        
        Args:
            issues: 이슈 리스트
        
        Returns:
            ClusteringResult: 클러스터링 결과
        """
        if len(issues) == 0:
            return ClusteringResult(
                clusters=[],
                method="simple",
                details={"reason": "No issues to cluster"}
            )
        
        # 특징 벡터 추출
        features_map = {}
        for issue in issues:
            issue_id = issue.get("id")
            if issue_id:
                features_map[issue_id] = self.extract_features(issue)
        
        # 클러스터 생성
        clusters: List[Cluster] = []
        assigned = set()
        
        for issue_id, features in features_map.items():
            if issue_id in assigned:
                continue
            
            # 새 클러스터 시작
            cluster_issues = [issue_id]
            assigned.add(issue_id)
            
            # 유사한 이슈 찾기
            for other_id, other_features in features_map.items():
                if other_id in assigned:
                    continue
                
                similarity = self.calculate_similarity(features, other_features)
                if similarity >= self.similarity_threshold:
                    cluster_issues.append(other_id)
                    assigned.add(other_id)
            
            # 클러스터 생성
            cluster_features = [features_map[iid] for iid in cluster_issues]
            centroid = np.mean(cluster_features, axis=0).tolist()
            
            # 평균 유사도 계산
            similarities = []
            for i, iid1 in enumerate(cluster_issues):
                for iid2 in cluster_issues[i+1:]:
                    sim = self.calculate_similarity(
                        features_map[iid1],
                        features_map[iid2]
                    )
                    similarities.append(sim)
            
            avg_similarity = np.mean(similarities) if similarities else 1.0
            
            cluster = Cluster(
                id=f"cluster-{len(clusters)}",
                issues=cluster_issues,
                centroid={f"feature_{i}": val for i, val in enumerate(centroid)},
                similarity_score=float(avg_similarity)
            )
            clusters.append(cluster)
        
        return ClusteringResult(
            clusters=clusters,
            method="simple",
            details={
                "total_issues": len(issues),
                "total_clusters": len(clusters),
                "similarity_threshold": self.similarity_threshold
            }
        )
    
    def cluster(self, issues: List[Dict[str, Any]], method: str = "simple") -> ClusteringResult:
        """
        이슈들을 클러스터링합니다.
        
        Args:
            issues: 이슈 리스트
            method: 클러스터링 방법
        
        Returns:
            ClusteringResult: 클러스터링 결과
        """
        if method == "simple":
            return self.cluster_simple(issues)
        else:
            raise ValueError(f"Unknown clustering method: {method}")









