/**
 * Reputation Manager
 * 
 * 에이전트 신뢰도 및 평판을 관리하는 서비스입니다.
 */

import type { Reputation, AgentType } from '@bridge-2026/shared';

/**
 * 평판 관리자
 */
export class ReputationManager {
  private reputations: Map<AgentType, Reputation> = new Map();
  
  /**
   * 평판을 초기화합니다.
   */
  initializeReputation(agentType: AgentType): Reputation {
    const reputation: Reputation = {
      agentType,
      totalEvaluations: 0,
      successCount: 0,
      failureCount: 0,
      averageConfidence: 0.0,
      trustScore: 0.5, // 초기 신뢰도 0.5
      updatedAt: Date.now(),
    };
    
    this.reputations.set(agentType, reputation);
    return reputation;
  }
  
  /**
   * 결과를 기반으로 평판을 업데이트합니다.
   */
  updateReputation(
    agentType: AgentType,
    success: boolean,
    confidence: number
  ): Reputation {
    let reputation = this.reputations.get(agentType);
    
    if (!reputation) {
      reputation = this.initializeReputation(agentType);
    }
    
    // 평가 수 증가
    reputation.totalEvaluations += 1;
    
    // 성공/실패 카운트 업데이트
    if (success) {
      reputation.successCount += 1;
    } else {
      reputation.failureCount += 1;
    }
    
    // 평균 신뢰도 업데이트
    const totalConfidence = reputation.averageConfidence * (reputation.totalEvaluations - 1) + confidence;
    reputation.averageConfidence = totalConfidence / reputation.totalEvaluations;
    
    // 신뢰도 점수 계산
    const successRate = reputation.successCount / reputation.totalEvaluations;
    const confidenceWeight = 0.3;
    const successWeight = 0.7;
    
    reputation.trustScore = 
      (successRate * successWeight) + 
      (reputation.averageConfidence * confidenceWeight);
    
    reputation.updatedAt = Date.now();
    
    this.reputations.set(agentType, reputation);
    return reputation;
  }
  
  /**
   * 평판을 가져옵니다.
   */
  getReputation(agentType: AgentType): Reputation | undefined {
    return this.reputations.get(agentType);
  }
  
  /**
   * 모든 평판을 가져옵니다.
   */
  getAllReputations(): Reputation[] {
    return Array.from(this.reputations.values());
  }
  
  /**
   * 평판 순위를 가져옵니다.
   */
  getReputationRanking(): Reputation[] {
    return Array.from(this.reputations.values())
      .sort((a, b) => b.trustScore - a.trustScore);
  }
  
  /**
   * 신뢰도가 높은 에이전트를 추천합니다.
   */
  getRecommendedAgents(threshold: number = 0.7): AgentType[] {
    // Ranked over the map entries rather than the values: `Reputation.agentType`
    // is declared as a plain `string` in the shared types, so only the map key
    // still carries the narrower `AgentType`.
    return Array.from(this.reputations.entries())
      .filter(([, reputation]) => reputation.trustScore >= threshold)
      .sort(([, a], [, b]) => b.trustScore - a.trustScore)
      .map(([agentType]) => agentType);
  }
}

/**
 * 싱글톤 인스턴스
 */
export const reputationManager = new ReputationManager();









