/**
 * Deliberation Engine
 * 
 * 멀티 에이전트 협의를 관리하는 엔진입니다.
 */

import { AgentType } from '@bridge-2026/shared';
import type { Issue, AgentReasoning } from '@bridge-2026/shared';
import type { IAgent } from '../agents/base-agent';
import { DeliberationProtocol } from './deliberation-protocol';

export interface DeliberationConfig {
  /** 최대 라운드 수 */
  maxRounds?: number;
  /** 합의 임계값 (0-1) */
  consensusThreshold?: number;
  /** 각 라운드 간 대기 시간 (ms) */
  roundDelay?: number;
}

export interface DeliberationRound {
  /** 라운드 번호 */
  round: number;
  /** 각 에이전트의 추론 */
  reasonings: Map<AgentType, AgentReasoning>;
  /** 라운드 종료 시간 */
  timestamp: number;
}

export interface DeliberationResult {
  /** 최종 추론들 */
  finalReasonings: Map<AgentType, AgentReasoning>;
  /** 합의 도달 여부 */
  consensusReached: boolean;
  /** 합의 점수 (0-1) */
  consensusScore: number;
  /** 라운드 히스토리 */
  rounds: DeliberationRound[];
  /** 총 라운드 수 */
  totalRounds: number;
}

/**
 * 협의 엔진
 */
export class DeliberationEngine {
  private agents: Map<AgentType, IAgent> = new Map();
  private config: Required<DeliberationConfig>;
  private protocol: DeliberationProtocol;
  
  constructor(config: DeliberationConfig = {}) {
    this.config = {
      maxRounds: config.maxRounds || 3,
      consensusThreshold: config.consensusThreshold || 0.7,
      roundDelay: config.roundDelay || 1000,
    };
    this.protocol = new DeliberationProtocol();
  }
  
  /**
   * 에이전트를 등록합니다.
   */
  registerAgent(agent: IAgent): void {
    this.agents.set(agent.type, agent);
  }
  
  /**
   * 여러 에이전트를 등록합니다.
   */
  registerAgents(agents: IAgent[]): void {
    agents.forEach(agent => this.registerAgent(agent));
  }
  
  /**
   * 이슈에 대해 협의를 시작합니다 (구조화된 프로토콜 사용).
   */
  async deliberate(
    issue: Issue,
    context?: Record<string, unknown>
  ): Promise<DeliberationResult> {
    const rounds: DeliberationRound[] = [];
    const reasonings: Map<AgentType, AgentReasoning> = new Map();
    
    // Moderator 에이전트 찾기
    const moderatorAgent = Array.from(this.agents.values()).find(
      a => a.type === AgentType.MODERATOR
    );
    
    if (!moderatorAgent) {
      throw new Error('Moderator agent not found');
    }
    
    // 1. Evidence Round: 근거 신호 인용
    await this.delay(this.config.roundDelay);
    const evidenceMap = await this.protocol.evidenceRound(issue, this.agents, context);
    
    // 2. Proposal Round: 실행안 제시
    await this.delay(this.config.roundDelay);
    const proposals = await this.protocol.proposalRound(issue, this.agents, evidenceMap, context);
    
    // Proposal Round 결과를 AgentReasoning으로 변환
    for (const [agentType, proposal] of proposals.entries()) {
      const agent = this.agents.get(agentType);
      if (agent) {
        const reasoning = await agent.analyze(issue, {
          ...context,
          proposal: proposal.proposal,
          evidence: evidenceMap.get(agentType),
        });
        reasonings.set(agentType, reasoning);
      }
    }
    
    rounds.push({
      round: 1,
      reasonings: new Map(reasonings),
      timestamp: Date.now(),
    });
    
    // 3. Critique Round: 상호 비판
    await this.delay(this.config.roundDelay);
    const critiques = await this.protocol.critiqueRound(issue, this.agents, proposals);
    
    // 비판을 반영하여 추론 업데이트
    for (const critique of critiques) {
      const targetAgent = this.agents.get(critique.targetAgent);
      const targetReasoning = reasonings.get(critique.targetAgent);
      const criticReasoning = reasonings.get(critique.criticAgent);
      
      if (targetAgent && targetReasoning && criticReasoning) {
        // 비판을 반영하여 추론 업데이트
        const updatedReasoning = await targetAgent.respond(issue, criticReasoning, targetReasoning);
        
        // 비판 내용을 분석에 추가
        updatedReasoning.analysis = `${updatedReasoning.analysis}\n\n비판 반영: ${critique.critique.risks.join('; ')}`;
        updatedReasoning.confidence = Math.max(0.1, updatedReasoning.confidence - critique.severity * 0.2);
        
        reasonings.set(critique.targetAgent, updatedReasoning);
      }
    }
    
    rounds.push({
      round: 2,
      reasonings: new Map(reasonings),
      timestamp: Date.now(),
    });
    
    // 4. Synthesis Round: Moderator가 최종 종합
    await this.delay(this.config.roundDelay);
    const synthesis = await this.protocol.synthesisRound(
      issue,
      moderatorAgent,
      proposals,
      critiques,
      evidenceMap
    );
    
    // Moderator의 최종 추론 생성
    const moderatorReasoning: AgentReasoning = {
      agentType: AgentType.MODERATOR,
      analysis: `최종 종합:\n${synthesis.recommendation}\n\n위험: ${synthesis.risks.map(r => r.title).join(', ')}`,
      recommendation: synthesis.recommendation,
      confidence: synthesis.confidence,
      considerations: synthesis.alternatives.map(a => a.title),
    };
    
    reasonings.set(AgentType.MODERATOR, moderatorReasoning);
    
    rounds.push({
      round: 3,
      reasonings: new Map(reasonings),
      timestamp: Date.now(),
    });
    
    // 합의 점수 계산
    const consensusScore = this.calculateConsensusScore(reasonings);
    
    return {
      finalReasonings: reasonings,
      consensusReached: consensusScore >= this.config.consensusThreshold,
      consensusScore,
      rounds,
      totalRounds: 3, // 프로토콜 라운드 수
    };
  }
  
  /**
   * 초기 분석을 수행합니다.
   */
  private async initialAnalysis(
    issue: Issue,
    context?: Record<string, unknown>
  ): Promise<AgentReasoning[]> {
    const promises = Array.from(this.agents.values()).map(agent =>
      agent.analyze(issue, context)
    );
    
    return Promise.all(promises);
  }
  
  /**
   * 협의 라운드를 수행합니다.
   */
  private async deliberationRound(
    issue: Issue,
    currentReasonings: Map<AgentType, AgentReasoning>,
    round: number,
    context?: Record<string, unknown>
  ): Promise<Map<AgentType, AgentReasoning>> {
    const updatedReasonings = new Map<AgentType, AgentReasoning>();
    
    // 각 에이전트가 다른 에이전트의 추론을 검토하고 반응
    for (const [agentType, agent] of this.agents.entries()) {
      const myReasoning = currentReasonings.get(agentType)!;
      
      // 다른 에이전트들의 추론 중 가장 다른 의견 찾기
      const otherReasonings = Array.from(currentReasonings.entries())
        .filter(([type]) => type !== agentType)
        .map(([, reasoning]) => reasoning);
      
      if (otherReasonings.length === 0) {
        updatedReasonings.set(agentType, myReasoning);
        continue;
      }
      
      // 가장 다른 의견 선택 (신뢰도 차이가 큰 것)
      const mostDifferent = otherReasonings.reduce((prev, curr) => {
        const prevDiff = Math.abs(prev.confidence - myReasoning.confidence);
        const currDiff = Math.abs(curr.confidence - myReasoning.confidence);
        return currDiff > prevDiff ? curr : prev;
      });
      
      // 반응 생성
      const updatedReasoning = await agent.respond(issue, mostDifferent, myReasoning);
      updatedReasonings.set(agentType, updatedReasoning);
    }
    
    return updatedReasonings;
  }
  
  /**
   * 합의 점수를 계산합니다.
   */
  private calculateConsensusScore(
    reasonings: Map<AgentType, AgentReasoning>
  ): number {
    if (reasonings.size < 2) {
      return 1.0; // 에이전트가 1개 이하면 완전 합의로 간주
    }
    
    const reasoningArray = Array.from(reasonings.values());
    
    // 추천 사항의 유사도 계산 (간단한 버전)
    const recommendations = reasoningArray.map(r => r.recommendation);
    const similarityScores: number[] = [];
    
    for (let i = 0; i < recommendations.length; i++) {
      for (let j = i + 1; j < recommendations.length; j++) {
        const similarity = this.calculateTextSimilarity(
          recommendations[i],
          recommendations[j]
        );
        similarityScores.push(similarity);
      }
    }
    
    // 신뢰도 가중 평균
    const avgConfidence = reasoningArray.reduce(
      (sum, r) => sum + r.confidence,
      0
    ) / reasoningArray.length;
    
    // 유사도 평균
    const avgSimilarity = similarityScores.length > 0
      ? similarityScores.reduce((sum, s) => sum + s, 0) / similarityScores.length
      : 0.5;
    
    // 합의 점수 = 유사도 * 평균 신뢰도
    return avgSimilarity * avgConfidence;
  }
  
  /**
   * 텍스트 유사도를 계산합니다 (간단한 버전).
   */
  private calculateTextSimilarity(text1: string, text2: string): number {
    // 간단한 단어 기반 유사도
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));
    
    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);
    
    if (union.size === 0) return 0;
    
    return intersection.size / union.size;
  }
  
  /**
   * 지연 함수
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

