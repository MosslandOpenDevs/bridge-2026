/**
 * Outcome Evaluator
 * 
 * 결과를 평가하는 서비스입니다.
 */

import { OutcomeStatus } from '@bridge-2026/shared';
import type { Outcome, OutcomeEvaluation } from '@bridge-2026/shared';

/**
 * 결과 평가기
 */
export class OutcomeEvaluator {
  /**
   * 결과를 평가합니다.
   */
  evaluateOutcome(outcome: Outcome): OutcomeEvaluation {
    const kpiResults = outcome.kpiMeasurements.map(measurement => {
      const target = measurement.targetValue;
      if (!target) {
        return { kpiName: measurement.kpiName, achieved: false, score: 0 };
      }
      
      const achieved = measurement.value >= target;
      const score = Math.min(1.0, measurement.value / target);
      
      return { kpiName: measurement.kpiName, achieved, score };
    });
    
    const successCount = kpiResults.filter(r => r.achieved).length;
    const successRate = kpiResults.length > 0 ? successCount / kpiResults.length : 0;
    const avgScore = kpiResults.length > 0
      ? kpiResults.reduce((sum, r) => sum + r.score, 0) / kpiResults.length
      : 0;
    
    const success = successRate >= 0.5; // 50% 이상 달성 시 성공
    
    const reasoning = this.generateReasoning(outcome, kpiResults, successRate);
    
    return {
      evaluator: 'automatic',
      success,
      successRate,
      reasoning,
      evaluatedAt: Date.now(),
    };
  }
  
  /**
   * 평가 근거를 생성합니다.
   */
  private generateReasoning(
    outcome: Outcome,
    kpiResults: Array<{ kpiName: string; achieved: boolean; score: number }>,
    successRate: number
  ): string {
    const achievedKPIs = kpiResults.filter(r => r.achieved).map(r => r.kpiName);
    const failedKPIs = kpiResults.filter(r => !r.achieved).map(r => r.kpiName);
    
    let reasoning = `결과 평가:\n\n`;
    reasoning += `성공률: ${(successRate * 100).toFixed(1)}%\n`;
    reasoning += `달성한 KPI: ${achievedKPIs.length}개 / ${kpiResults.length}개\n`;
    
    if (achievedKPIs.length > 0) {
      reasoning += `\n달성한 KPI:\n${achievedKPIs.map(k => `- ${k}`).join('\n')}\n`;
    }
    
    if (failedKPIs.length > 0) {
      reasoning += `\n미달성 KPI:\n${failedKPIs.map(k => `- ${k}`).join('\n')}\n`;
    }
    
    if (outcome.status === OutcomeStatus.SUCCESS) {
      reasoning += `\n전체적으로 성공적으로 실행되었습니다.`;
    } else if (outcome.status === OutcomeStatus.PARTIAL_SUCCESS) {
      reasoning += `\n부분적으로 성공했습니다. 일부 KPI는 목표를 달성하지 못했습니다.`;
    } else {
      reasoning += `\n실행이 실패했습니다. 대부분의 KPI가 목표를 달성하지 못했습니다.`;
    }
    
    return reasoning;
  }
  
  /**
   * 수동 평가를 생성합니다.
   */
  createManualEvaluation(
    outcome: Outcome,
    evaluatorId: string,
    success: boolean,
    reasoning: string
  ): OutcomeEvaluation {
    return {
      evaluator: 'manual',
      evaluatorId,
      success,
      successRate: success ? 1.0 : 0.0,
      reasoning,
      evaluatedAt: Date.now(),
    };
  }
}

/**
 * 싱글톤 인스턴스
 */
export const outcomeEvaluator = new OutcomeEvaluator();









