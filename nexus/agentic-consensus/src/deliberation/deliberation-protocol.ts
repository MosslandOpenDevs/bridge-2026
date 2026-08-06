/**
 * Deliberation Protocol
 * 
 * 구조화된 토론 프로토콜을 구현합니다.
 * Evidence → Proposal → Critique → Synthesis
 */

import { AgentType } from '@bridge-2026/shared';
import type { Issue, AgentReasoning } from '@bridge-2026/shared';
import type { IAgent } from '../agents/base-agent';

/**
 * 증거 인용
 */
export interface EvidenceCitation {
  /** 신호 ID */
  signalId: string;
  /** 인용 이유 */
  reason: string;
  /** 관련성 점수 (0-1) */
  relevance: number;
}

/**
 * 제안 라운드 결과
 */
export interface ProposalRoundResult {
  /** 에이전트 타입 */
  agentType: AgentType;
  /** 실행안 */
  proposal: {
    title: string;
    description: string;
    cost?: number;
    kpis: Array<{ name: string; target: number }>;
    timeline?: string;
  };
  /** 신뢰도 */
  confidence: number;
}

/**
 * 비판 라운드 결과
 */
export interface CritiqueRoundResult {
  /** 비판하는 에이전트 */
  criticAgent: AgentType;
  /** 비판받는 에이전트 */
  targetAgent: AgentType;
  /** 비판 내용 */
  critique: {
    risks: string[];
    sideEffects: string[];
    alternatives?: string[];
  };
  /** 비판 강도 (0-1) */
  severity: number;
}

/**
 * 토론 프로토콜
 */
export class DeliberationProtocol {
  /**
   * Evidence Round: 각 에이전트가 근거 신호를 인용합니다.
   */
  async evidenceRound(
    issue: Issue,
    agents: Map<AgentType, IAgent>,
    context?: Record<string, unknown>
  ): Promise<Map<AgentType, EvidenceCitation[]>> {
    const evidenceMap = new Map<AgentType, EvidenceCitation[]>();
    
    // 각 에이전트가 최소 3개의 신호를 인용
    for (const [agentType, agent] of agents.entries()) {
      if (agentType === AgentType.MODERATOR) {
        continue; // Moderator는 Evidence Round에 참여하지 않음
      }
      
      const citations = await this.collectEvidence(agent, issue, 3);
      evidenceMap.set(agentType, citations);
    }
    
    return evidenceMap;
  }
  
  /**
   * Proposal Round: 각 에이전트가 실행안을 제시합니다.
   */
  async proposalRound(
    issue: Issue,
    agents: Map<AgentType, IAgent>,
    evidenceMap: Map<AgentType, EvidenceCitation[]>,
    context?: Record<string, unknown>
  ): Promise<Map<AgentType, ProposalRoundResult>> {
    const proposals = new Map<AgentType, ProposalRoundResult>();
    
    for (const [agentType, agent] of agents.entries()) {
      if (agentType === AgentType.MODERATOR) {
        continue; // Moderator는 Proposal Round에 참여하지 않음
      }
      
      const reasoning = await agent.analyze(issue, context);
      const citations = evidenceMap.get(agentType) || [];
      
      // 실행안 추출 (실제로는 LLM이나 규칙 기반으로 생성)
      const proposal = this.extractProposal(reasoning, citations);
      
      proposals.set(agentType, {
        agentType,
        proposal,
        confidence: reasoning.confidence,
      });
    }
    
    return proposals;
  }
  
  /**
   * Critique Round: 에이전트들이 서로의 안을 비판합니다.
   */
  async critiqueRound(
    issue: Issue,
    agents: Map<AgentType, IAgent>,
    proposals: Map<AgentType, ProposalRoundResult>
  ): Promise<CritiqueRoundResult[]> {
    const critiques: CritiqueRoundResult[] = [];
    const proposalArray = Array.from(proposals.entries());
    
    // 각 에이전트가 다른 에이전트의 제안을 비판
    for (const [criticType, criticAgent] of agents.entries()) {
      if (criticType === AgentType.MODERATOR) {
        continue;
      }
      
      // 자신의 제안을 제외한 다른 제안들을 비판
      const otherProposals = proposalArray.filter(([type]) => type !== criticType);
      
      for (const [targetType, targetProposal] of otherProposals) {
        const critique = await this.generateCritique(
          criticAgent,
          issue,
          targetProposal,
          criticType
        );
        
        critiques.push({
          criticAgent: criticType,
          targetAgent: targetType,
          critique,
          severity: this.calculateSeverity(critique),
        });
      }
    }
    
    return critiques;
  }
  
  /**
   * Synthesis Round: Moderator가 최종 Decision Packet을 생성합니다.
   */
  async synthesisRound(
    issue: Issue,
    moderatorAgent: IAgent,
    proposals: Map<AgentType, ProposalRoundResult>,
    critiques: CritiqueRoundResult[],
    evidenceMap: Map<AgentType, EvidenceCitation[]>
  ): Promise<{
    recommendation: string;
    alternatives: Array<{ title: string; description: string }>;
    risks: Array<{ title: string; description: string; severity: string }>;
    confidence: number;
  }> {
    // Moderator가 모든 정보를 종합
    const reasoning = await moderatorAgent.analyze(issue, {
      proposals: Array.from(proposals.values()),
      critiques,
      evidence: Array.from(evidenceMap.values()).flat(),
    });
    
    // 위험 추출
    const risks = critiques
      .filter(c => c.severity > 0.7)
      .map(c => ({
        title: `${c.criticAgent}의 ${c.targetAgent} 제안에 대한 비판`,
        description: c.critique.risks.join('; '),
        severity: c.severity > 0.8 ? 'high' : 'medium',
      }));
    
    // 대안 추출
    const alternatives = Array.from(proposals.values())
      .filter(p => p.agentType !== proposals.keys().next().value) // 첫 번째 제안 제외
      .map(p => ({
        title: p.proposal.title,
        description: p.proposal.description,
      }));
    
    return {
      recommendation: reasoning.recommendation,
      alternatives,
      risks,
      confidence: reasoning.confidence,
    };
  }
  
  /**
   * 증거를 수집합니다.
   */
  private async collectEvidence(
    agent: IAgent,
    issue: Issue,
    minCount: number
  ): Promise<EvidenceCitation[]> {
    const signals = issue.evidence.signals || [];
    const citations: EvidenceCitation[] = [];
    
    // 관련 신호 중 상위 N개 선택
    const relevantSignals = signals
      .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0))
      .slice(0, Math.max(minCount, signals.length));
    
    for (const signal of relevantSignals) {
      citations.push({
        signalId: signal.signalId,
        reason: `관련 신호: ${signal.relevanceReason || '높은 관련성'}`,
        relevance: signal.relevanceScore || 0.5,
      });
    }
    
    return citations;
  }
  
  /**
   * 추론에서 실행안을 추출합니다.
   */
  private extractProposal(
    reasoning: AgentReasoning,
    citations: EvidenceCitation[]
  ): ProposalRoundResult['proposal'] {
    // 추론의 추천 사항을 기반으로 실행안 생성
    return {
      title: reasoning.recommendation.substring(0, 100),
      description: reasoning.recommendation,
      cost: this.extractCost(reasoning),
      kpis: this.extractKPIs(reasoning),
      timeline: this.extractTimeline(reasoning),
    };
  }
  
  /**
   * 비용을 추출합니다.
   */
  private extractCost(reasoning: AgentReasoning): number | undefined {
    // 추론에서 비용 정보 추출 (실제로는 더 정교한 파싱 필요)
    const costMatch = reasoning.recommendation.match(/\$?(\d+(?:,\d+)*(?:\.\d+)?)/);
    if (costMatch) {
      return parseFloat(costMatch[1].replace(/,/g, ''));
    }
    return undefined;
  }
  
  /**
   * KPI를 추출합니다.
   */
  private extractKPIs(reasoning: AgentReasoning): Array<{ name: string; target: number }> {
    // 추론의 고려사항에서 KPI 추출
    const kpis: Array<{ name: string; target: number }> = [];
    
    reasoning.considerations?.forEach(consideration => {
      // 간단한 패턴 매칭 (실제로는 LLM 사용)
      if (consideration.includes('참여율')) {
        kpis.push({ name: '참여율', target: 0.7 });
      }
      if (consideration.includes('예산')) {
        kpis.push({ name: '예산 효율성', target: 0.8 });
      }
    });
    
    return kpis;
  }
  
  /**
   * 일정을 추출합니다.
   */
  private extractTimeline(reasoning: AgentReasoning): string | undefined {
    // 추론에서 일정 정보 추출
    const timelineMatch = reasoning.recommendation.match(/(\d+)\s*(주|개월|일)/);
    if (timelineMatch) {
      return timelineMatch[0];
    }
    return undefined;
  }
  
  /**
   * 비판을 생성합니다.
   */
  private async generateCritique(
    criticAgent: IAgent,
    issue: Issue,
    targetProposal: ProposalRoundResult,
    criticType: AgentType
  ): Promise<CritiqueRoundResult['critique']> {
    // 에이전트의 추론을 기반으로 비판 생성
    const reasoning = await criticAgent.analyze(issue, {
      targetProposal: targetProposal.proposal,
    });
    
    const risks: string[] = [];
    const sideEffects: string[] = [];
    
    // 불확실성에서 위험 추출
    reasoning.uncertainties?.forEach(uncertainty => {
      if (uncertainty.includes('위험') || uncertainty.includes('리스크')) {
        risks.push(uncertainty);
      } else {
        sideEffects.push(uncertainty);
      }
    });
    
    // 고려사항에서 추가 위험 추출
    reasoning.considerations?.forEach(consideration => {
      if (consideration.includes('위험') || consideration.includes('제약')) {
        risks.push(consideration);
      }
    });
    
    return {
      risks,
      sideEffects,
      alternatives: reasoning.considerations?.filter(c => c.includes('대안')),
    };
  }
  
  /**
   * 비판 강도를 계산합니다.
   */
  private calculateSeverity(critique: CritiqueRoundResult['critique']): number {
    let severity = 0.0;
    
    // 위험 수에 따라 강도 증가
    severity += Math.min(critique.risks.length * 0.2, 0.6);
    
    // 부작용 수에 따라 강도 증가
    severity += Math.min(critique.sideEffects.length * 0.1, 0.3);
    
    // 대안이 있으면 강도 감소
    if (critique.alternatives && critique.alternatives.length > 0) {
      severity -= 0.1;
    }
    
    return Math.max(0.0, Math.min(1.0, severity));
  }
}









