/**
 * KPI Tracker
 * 
 * KPI를 추적하고 측정하는 서비스입니다.
 */

import type { KPI, KPIMeasurement } from '@bridge-2026/shared';

/**
 * KPI 추적기
 */
export class KPITracker {
  private measurements: Map<string, KPIMeasurement[]> = new Map();
  
  /**
   * KPI를 정의합니다.
   */
  defineKPI(kpi: KPI): KPI {
    return kpi;
  }
  
  /**
   * KPI를 측정합니다.
   */
  measureKPI(
    kpiName: string,
    value: number,
    dataSource: string,
    targetValue?: number
  ): KPIMeasurement {
    const measurement: KPIMeasurement = {
      kpiName,
      value,
      targetValue,
      measuredAt: Date.now(),
      measurementMethod: 'automatic',
      dataSource,
    };
    
    const measurements = this.measurements.get(kpiName) || [];
    measurements.push(measurement);
    this.measurements.set(kpiName, measurements);
    
    return measurement;
  }
  
  /**
   * KPI 측정값을 가져옵니다.
   */
  getMeasurements(kpiName: string): KPIMeasurement[] {
    return this.measurements.get(kpiName) || [];
  }
  
  /**
   * 최신 KPI 측정값을 가져옵니다.
   */
  getLatestMeasurement(kpiName: string): KPIMeasurement | undefined {
    const measurements = this.measurements.get(kpiName) || [];
    if (measurements.length === 0) {
      return undefined;
    }
    return measurements[measurements.length - 1];
  }
  
  /**
   * KPI 목표 달성 여부를 확인합니다.
   */
  checkTargetAchievement(kpiName: string): {
    achieved: boolean;
    currentValue: number;
    targetValue?: number;
    percentage?: number;
  } {
    const latest = this.getLatestMeasurement(kpiName);
    if (!latest) {
      return { achieved: false, currentValue: 0 };
    }
    
    if (!latest.targetValue) {
      return { achieved: false, currentValue: latest.value };
    }
    
    const achieved = latest.value >= latest.targetValue;
    const percentage = (latest.value / latest.targetValue) * 100;
    
    return {
      achieved,
      currentValue: latest.value,
      targetValue: latest.targetValue,
      percentage,
    };
  }
}

/**
 * 싱글톤 인스턴스
 */
export const kpiTracker = new KPITracker();









