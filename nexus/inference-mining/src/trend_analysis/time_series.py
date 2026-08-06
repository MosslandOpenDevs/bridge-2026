"""
Time Series Analysis

시계열 데이터를 분석하여 트렌드를 감지합니다.
"""

import numpy as np
from typing import List, Dict, Any, Optional
from dataclasses import dataclass
from datetime import datetime, timedelta


@dataclass
class TrendResult:
    """트렌드 분석 결과"""
    direction: str  # 'increasing', 'decreasing', 'stable'
    strength: float  # 0-1 범위
    slope: float
    confidence: float
    details: Dict[str, Any]


class TimeSeriesAnalyzer:
    """시계열 분석기"""
    
    def __init__(self, min_data_points: int = 3):
        """
        Args:
            min_data_points: 최소 데이터 포인트 수
        """
        self.min_data_points = min_data_points
    
    def detect_trend(self, values: List[float], timestamps: Optional[List[float]] = None) -> TrendResult:
        """
        선형 회귀를 사용하여 트렌드를 감지합니다.
        
        Args:
            values: 값들의 리스트
            timestamps: 타임스탬프 리스트 (None이면 인덱스 사용)
        
        Returns:
            TrendResult: 트렌드 분석 결과
        """
        if len(values) < self.min_data_points:
            return TrendResult(
                direction="stable",
                strength=0.0,
                slope=0.0,
                confidence=0.0,
                details={"reason": "Insufficient data points"}
            )
        
        values_array = np.array(values)
        
        # 타임스탬프 생성
        if timestamps is None:
            x = np.arange(len(values))
        else:
            x = np.array(timestamps)
        
        # 선형 회귀
        slope, intercept = np.polyfit(x, values_array, 1)
        
        # 트렌드 방향 결정
        if slope > 0.01:
            direction = "increasing"
        elif slope < -0.01:
            direction = "decreasing"
        else:
            direction = "stable"
        
        # 트렌드 강도 계산 (R² 값 사용)
        y_pred = slope * x + intercept
        ss_res = np.sum((values_array - y_pred) ** 2)
        ss_tot = np.sum((values_array - np.mean(values_array)) ** 2)
        
        if ss_tot == 0:
            r_squared = 0.0
        else:
            r_squared = 1 - (ss_res / ss_tot)
        
        strength = abs(r_squared)
        confidence = min(len(values) / 10.0, 1.0)  # 데이터 포인트가 많을수록 신뢰도 증가
        
        return TrendResult(
            direction=direction,
            strength=strength,
            slope=float(slope),
            confidence=confidence,
            details={
                "r_squared": float(r_squared),
                "slope": float(slope),
                "intercept": float(intercept),
                "data_points": len(values),
                "mean": float(np.mean(values_array)),
                "std": float(np.std(values_array))
            }
        )
    
    def detect_change_point(self, values: List[float], window_size: int = 5) -> Optional[int]:
        """
        변화점을 감지합니다.
        
        Args:
            values: 값들의 리스트
            window_size: 비교할 윈도우 크기
        
        Returns:
            변화점 인덱스 (없으면 None)
        """
        if len(values) < window_size * 2:
            return None
        
        values_array = np.array(values)
        
        # 각 윈도우의 평균 계산
        window_means = []
        for i in range(len(values) - window_size + 1):
            window_means.append(np.mean(values_array[i:i+window_size]))
        
        # 연속된 윈도우 간 차이 계산
        differences = []
        for i in range(len(window_means) - 1):
            diff = abs(window_means[i+1] - window_means[i])
            differences.append(diff)
        
        if not differences:
            return None
        
        # 차이의 평균과 표준편차
        mean_diff = np.mean(differences)
        std_diff = np.std(differences)
        
        if std_diff == 0:
            return None
        
        # 가장 큰 변화점 찾기
        max_diff_idx = np.argmax(differences)
        max_diff = differences[max_diff_idx]
        
        # 임계값 (평균 + 2*표준편차)
        threshold = mean_diff + 2 * std_diff
        
        if max_diff > threshold:
            return max_diff_idx + window_size
        
        return None
    
    def calculate_volatility(self, values: List[float]) -> float:
        """
        변동성을 계산합니다.
        
        Args:
            values: 값들의 리스트
        
        Returns:
            변동성 점수 (0-1)
        """
        if len(values) < 2:
            return 0.0
        
        values_array = np.array(values)
        
        # 변동성 = 표준편차 / 평균 (변동계수)
        mean = np.mean(values_array)
        if mean == 0:
            return 0.0
        
        cv = np.std(values_array) / mean
        
        # 0-1 범위로 정규화 (임의의 최대값 2.0 사용)
        volatility = min(cv / 2.0, 1.0)
        
        return float(volatility)









