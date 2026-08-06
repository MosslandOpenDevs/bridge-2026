"""
Statistical Anomaly Detector

통계적 방법을 사용하여 이상치를 탐지합니다.
"""

import numpy as np
from typing import List, Dict, Any, Optional
from dataclasses import dataclass


@dataclass
class AnomalyResult:
    """이상 탐지 결과"""
    is_anomaly: bool
    anomaly_score: float
    method: str
    details: Dict[str, Any]


class StatisticalDetector:
    """통계적 이상 탐지기"""
    
    def __init__(self, threshold: float = 3.0):
        """
        Args:
            threshold: Z-score 임계값 (기본값: 3.0, 약 99.7% 신뢰구간)
        """
        self.threshold = threshold
    
    def detect_zscore(self, values: List[float], window_size: Optional[int] = None) -> AnomalyResult:
        """
        Z-score 방법을 사용하여 이상치를 탐지합니다.
        
        Args:
            values: 탐지할 값들의 리스트
            window_size: 이동 평균 윈도우 크기 (None이면 전체 데이터 사용)
        
        Returns:
            AnomalyResult: 이상 탐지 결과
        """
        if len(values) < 2:
            return AnomalyResult(
                is_anomaly=False,
                anomaly_score=0.0,
                method="zscore",
                details={"reason": "Insufficient data"}
            )
        
        values_array = np.array(values)
        
        if window_size and len(values) > window_size:
            # 이동 평균 및 표준편차 계산
            recent_values = values_array[-window_size:]
            mean = np.mean(recent_values)
            std = np.std(recent_values)
        else:
            mean = np.mean(values_array)
            std = np.std(values_array)
        
        if std == 0:
            return AnomalyResult(
                is_anomaly=False,
                anomaly_score=0.0,
                method="zscore",
                details={"reason": "Zero standard deviation"}
            )
        
        # 마지막 값의 Z-score 계산
        last_value = values_array[-1]
        z_score = abs((last_value - mean) / std)
        
        is_anomaly = z_score > self.threshold
        anomaly_score = min(z_score / self.threshold, 1.0)  # 0-1 범위로 정규화
        
        return AnomalyResult(
            is_anomaly=is_anomaly,
            anomaly_score=anomaly_score,
            method="zscore",
            details={
                "z_score": float(z_score),
                "mean": float(mean),
                "std": float(std),
                "value": float(last_value),
                "threshold": self.threshold
            }
        )
    
    def detect_iqr(self, values: List[float]) -> AnomalyResult:
        """
        IQR (Interquartile Range) 방법을 사용하여 이상치를 탐지합니다.
        
        Args:
            values: 탐지할 값들의 리스트
        
        Returns:
            AnomalyResult: 이상 탐지 결과
        """
        if len(values) < 4:
            return AnomalyResult(
                is_anomaly=False,
                anomaly_score=0.0,
                method="iqr",
                details={"reason": "Insufficient data for IQR"}
            )
        
        values_array = np.array(values)
        q1 = np.percentile(values_array, 25)
        q3 = np.percentile(values_array, 75)
        iqr = q3 - q1
        
        if iqr == 0:
            return AnomalyResult(
                is_anomaly=False,
                anomaly_score=0.0,
                method="iqr",
                details={"reason": "Zero IQR"}
            )
        
        lower_bound = q1 - 1.5 * iqr
        upper_bound = q3 + 1.5 * iqr
        
        last_value = values_array[-1]
        is_anomaly = last_value < lower_bound or last_value > upper_bound
        
        # 이상치 점수 계산
        if is_anomaly:
            if last_value < lower_bound:
                distance = abs(last_value - lower_bound) / iqr
            else:
                distance = abs(last_value - upper_bound) / iqr
            anomaly_score = min(distance, 1.0)
        else:
            anomaly_score = 0.0
        
        return AnomalyResult(
            is_anomaly=is_anomaly,
            anomaly_score=anomaly_score,
            method="iqr",
            details={
                "q1": float(q1),
                "q3": float(q3),
                "iqr": float(iqr),
                "lower_bound": float(lower_bound),
                "upper_bound": float(upper_bound),
                "value": float(last_value)
            }
        )
    
    def detect(self, values: List[float], method: str = "zscore") -> AnomalyResult:
        """
        이상치를 탐지합니다.
        
        Args:
            values: 탐지할 값들의 리스트
            method: 탐지 방법 ("zscore" 또는 "iqr")
        
        Returns:
            AnomalyResult: 이상 탐지 결과
        """
        if method == "zscore":
            return self.detect_zscore(values)
        elif method == "iqr":
            return self.detect_iqr(values)
        else:
            raise ValueError(f"Unknown method: {method}")









