/**
 * Proof of Outcome
 * 
 * 결과 측정, 평가 및 온체인 증명을 관리하는 메인 서비스입니다.
 */

import { OutcomeStatus } from '@bridge-2026/shared';
import type { Outcome, Proposal, DecisionPacket } from '@bridge-2026/shared';
import { kpiTracker } from './kpi-tracking/kpi-tracker';
import { outcomeEvaluator } from './evaluation/evaluator';
import { reputationManager } from './reputation/reputation-manager';
import { v4 as uuidv4 } from 'uuid';
import { eventPublisher, EventType } from '@bridge-2026/event-bus';

/**
 * Proof of Outcome 서비스
 */
export class ProofOfOutcome {
  private outcomes: Map<string, Outcome> = new Map();
  
  /**
   * 결과를 생성하고 측정을 시작합니다.
   */
  async createOutcome(
    proposal: Proposal,
    decisionPacket: DecisionPacket,
    executionStartTime: number
  ): Promise<Outcome> {
    const outcome: Outcome = {
      id: uuidv4(),
      proposalId: proposal.id,
      decisionPacketId: decisionPacket.id,
      status: OutcomeStatus.IN_PROGRESS,
      kpiMeasurements: [],
      executionStartTime,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    this.outcomes.set(outcome.id, outcome);
    
    // KPI 초기 측정 (before)
    const beforeMeasurements = await this.measureKPIs(decisionPacket.kpis, 'before');
    outcome.kpiMeasurements = beforeMeasurements;
    
    return outcome;
  }
  
  /**
   * KPI를 측정합니다.
   */
  async measureKPIs(
    kpis: Array<{ name: string; targetValue?: number }>,
    phase: 'before' | 'after'
  ): Promise<Array<{
    kpiName: string;
    value: number;
    targetValue?: number;
    measuredAt: number;
    measurementMethod: string;
    dataSource: string;
  }>> {
    const measurements = [];
    
    for (const kpi of kpis) {
      // TODO: 실제 데이터 소스에서 값 가져오기
      const value = this.fetchKPIValue(kpi.name, phase);
      
      const measurement = kpiTracker.measureKPI(
        kpi.name,
        value,
        `proof-of-outcome-${phase}`,
        kpi.targetValue
      );
      
      measurements.push(measurement);
    }
    
    return measurements;
  }
  
  /**
   * 결과 측정을 완료하고 평가합니다.
   */
  async finalizeOutcome(
    outcomeId: string,
    executionEndTime: number,
    onChainProofHash?: string,
    ipfsRef?: string
  ): Promise<Outcome> {
    const outcome = this.outcomes.get(outcomeId);
    if (!outcome) {
      throw new Error(`Outcome ${outcomeId} not found`);
    }
    
    // KPI 최종 측정 (after)
    // TODO: Decision Packet에서 KPI 가져오기
    const afterMeasurements = await this.measureKPIs([], 'after');
    
    // 기존 측정값과 병합 (실제로는 before/after를 구분해서 저장)
    outcome.kpiMeasurements = [...outcome.kpiMeasurements, ...afterMeasurements];
    
    // 평가 수행
    outcome.evaluation = outcomeEvaluator.evaluateOutcome(outcome);
    
    // 상태 업데이트
    outcome.status = outcome.evaluation.success
      ? OutcomeStatus.SUCCESS
      : OutcomeStatus.FAILURE;
    outcome.executionEndTime = executionEndTime;
    outcome.onChainProofHash = onChainProofHash;
    outcome.ipfsRef = ipfsRef;
    outcome.updatedAt = Date.now();
    
    // 평판 업데이트
    // TODO: Decision Packet에서 에이전트 정보 가져와서 평판 업데이트
    
    // 이벤트 발행
    await eventPublisher.publish({
      type: EventType.OUTCOME_MEASURED,
      id: `event-${Date.now()}-${Math.random()}`,
      timestamp: Date.now(),
      source: 'proof-of-outcome',
      data: outcome,
    });
    
    await eventPublisher.publish({
      type: EventType.OUTCOME_EVALUATED,
      id: `event-${Date.now()}-${Math.random()}`,
      timestamp: Date.now(),
      source: 'proof-of-outcome',
      data: outcome,
    });
    
    return outcome;
  }
  
  /**
   * KPI 값을 가져옵니다 (임시 구현).
   */
  private fetchKPIValue(kpiName: string, phase: 'before' | 'after'): number {
    // TODO: 실제 데이터 소스에서 값 가져오기
    // 예: 데이터베이스, API, 온체인 데이터 등
    
    // 임시로 랜덤 값 반환
    return Math.random() * 100;
  }
  
  /**
   * 결과를 가져옵니다.
   */
  getOutcome(outcomeId: string): Outcome | undefined {
    return this.outcomes.get(outcomeId);
  }
  
  /**
   * 제안의 결과를 가져옵니다.
   */
  getOutcomeByProposal(proposalId: string): Outcome | undefined {
    return Array.from(this.outcomes.values()).find(o => o.proposalId === proposalId);
  }
}

/**
 * 싱글톤 인스턴스
 */
export const proofOfOutcome = new ProofOfOutcome();









