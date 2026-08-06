/**
 * Moderator
 * 
 * 에이전트들의 추론을 종합하여 Decision Packet을 생성하는 모더레이터입니다.
 */

import type {
  Issue,
  DecisionPacket,
  AgentReasoning,
  Alternative,
  Risk,
  KPI,
  DissentingOpinion,
} from '@bridge-2026/shared';
import type { DeliberationResult } from '../deliberation/deliberation-engine';

export interface ModeratorConfig {
  /** 모더레이터 버전 */
  version: string;
  /** 모델 정보 (LLM 사용 시) */
  model?: string;
}

/** 호출자가 version을 생략했을 때 Decision Packet에 기록되는 버전. */
export const DEFAULT_MODERATOR_VERSION = '1.0.0';

/**
 * 모더레이터
 */
export class Moderator {
  private config: ModeratorConfig;

  // version은 DecisionPacket.moderator에서 필수이므로 내부적으로는 항상 채워두되,
  // 호출자에게는 부분 설정만 넘기도록 허용한다.
  constructor(config: Partial<ModeratorConfig> = {}) {
    this.config = {
      ...config,
      version: config.version ?? DEFAULT_MODERATOR_VERSION,
    };
  }
  
  /**
   * 협의 결과로부터 Decision Packet을 생성합니다.
   */
  async synthesize(
    issue: Issue,
    deliberationResult: DeliberationResult
  ): Promise<DecisionPacket> {
    const reasonings = Array.from(deliberationResult.finalReasonings.values());
    
    // 주요 추천 사항 추출
    const recommendation = this.extractRecommendation(reasonings);
    
    // 대안 추출
    const alternatives = this.extractAlternatives(reasonings);
    
    // 위험 추출
    const risks = this.extractRisks(reasonings);
    
    // KPI 추출
    const kpis = this.extractKPIs(reasonings, issue);
    
    // 반대 의견 추출
    const dissentingOpinions = this.extractDissentingOpinions(reasonings);
    
    // 전체 신뢰도 계산
    const overallConfidence = this.calculateOverallConfidence(reasonings, deliberationResult);
    
    // 불확실성 요약
    const uncertaintySummary = this.summarizeUncertainties(reasonings);
    
    const decisionPacket: DecisionPacket = {
      id: `dp-${issue.id}-${Date.now()}`,
      issueId: issue.id,
      recommendation: recommendation.text,
      recommendationDetails: recommendation.details,
      alternatives,
      risks,
      kpis,
      dissentingOpinions,
      agentReasoning: reasonings,
      overallConfidence,
      uncertaintySummary,
      createdAt: Date.now(),
      moderator: {
        version: this.config.version,
        model: this.config.model,
      },
    };
    
    return decisionPacket;
  }
  
  /**
   * 주요 추천 사항을 추출합니다.
   */
  private extractRecommendation(reasonings: AgentReasoning[]): {
    text: string;
    details: string;
  } {
    if (reasonings.length === 0) {
      return {
        text: '추가 분석이 필요합니다.',
        details: '에이전트 추론이 없습니다.',
      };
    }
    
    // 신뢰도가 가장 높은 에이전트의 추천 사용
    const highestConfidence = reasonings.reduce((prev, curr) =>
      curr.confidence > prev.confidence ? curr : prev
    );
    
    // 모든 에이전트의 추천을 종합
    const recommendations = reasonings.map(r => r.recommendation);
    const commonThemes = this.findCommonThemes(recommendations);
    
    return {
      text: highestConfidence.recommendation,
      details: `주요 추천: ${highestConfidence.recommendation}\n\n공통 주제: ${commonThemes.join(', ')}\n\n신뢰도: ${(highestConfidence.confidence * 100).toFixed(1)}%`,
    };
  }
  
  /**
   * 대안을 추출합니다.
   */
  private extractAlternatives(reasonings: AgentReasoning[]): Alternative[] {
    const alternatives: Alternative[] = [];
    
    // 각 에이전트의 고려사항에서 대안 추출
    reasonings.forEach(reasoning => {
      const considerations = reasoning.considerations || [];
      
      considerations.forEach(consideration => {
        // 대안으로 보이는 고려사항 찾기
        if (consideration.includes('대안') || consideration.includes('대체')) {
          alternatives.push({
            title: `대안: ${consideration.substring(0, 50)}`,
            description: consideration,
            advantages: ['에이전트 검토됨'],
            disadvantages: [],
            recommendedBy: [reasoning.agentType],
          });
        }
      });
    });
    
    // 중복 제거 및 정리
    return this.deduplicateAlternatives(alternatives);
  }
  
  /**
   * 위험을 추출합니다.
   */
  private extractRisks(reasonings: AgentReasoning[]): Risk[] {
    const risks: Risk[] = [];
    
    reasonings.forEach(reasoning => {
      // 불확실성에서 위험 추출
      const uncertainties = reasoning.uncertainties || [];
      
      uncertainties.forEach(uncertainty => {
        if (uncertainty.includes('위험') || uncertainty.includes('제약')) {
          risks.push({
            title: `위험: ${uncertainty.substring(0, 50)}`,
            description: uncertainty,
            severity: this.assessRiskSeverity(uncertainty),
            probability: 0.5, // 기본값
            identifiedBy: [reasoning.agentType],
          });
        }
      });
    });
    
    return this.deduplicateRisks(risks);
  }
  
  /**
   * KPI를 추출합니다.
   */
  private extractKPIs(reasonings: AgentReasoning[], issue: Issue): KPI[] {
    const kpis: KPI[] = [];
    
    // 기본 KPI
    kpis.push({
      name: '이슈 해결 시간',
      description: '이슈가 감지된 시점부터 해결까지의 시간',
      measurementMethod: '타임스탬프 차이 계산',
      unit: '일',
    });
    
    kpis.push({
      name: '에이전트 합의 점수',
      description: '에이전트 간 합의 수준',
      measurementMethod: '협의 결과의 합의 점수',
      unit: '0-1 점수',
    });
    
    // 우선순위 기반 KPI
    if (issue.priority === 'critical' || issue.priority === 'high') {
      kpis.push({
        name: '응답 시간',
        description: '이슈 감지부터 초기 대응까지의 시간',
        measurementMethod: '타임스탬프 차이 계산',
        unit: '시간',
      });
    }
    
    return kpis;
  }
  
  /**
   * 반대 의견을 추출합니다.
   */
  private extractDissentingOpinions(reasonings: AgentReasoning[]): DissentingOpinion[] {
    const dissentingOpinions: DissentingOpinion[] = [];
    
    if (reasonings.length < 2) {
      return dissentingOpinions;
    }
    
    // 신뢰도가 낮은 에이전트의 의견 찾기
    const avgConfidence = reasonings.reduce((sum, r) => sum + r.confidence, 0) / reasonings.length;
    
    reasonings.forEach(reasoning => {
      if (reasoning.confidence < avgConfidence * 0.7) {
        // 평균보다 현저히 낮은 신뢰도
        dissentingOpinions.push({
          agentType: reasoning.agentType,
          opinion: reasoning.recommendation,
          reasoning: reasoning.analysis,
        });
      }
    });
    
    return dissentingOpinions;
  }
  
  /**
   * 전체 신뢰도를 계산합니다.
   */
  private calculateOverallConfidence(
    reasonings: AgentReasoning[],
    deliberationResult: DeliberationResult
  ): number {
    if (reasonings.length === 0) {
      return 0.0;
    }
    
    // 평균 신뢰도
    const avgConfidence = reasonings.reduce((sum, r) => sum + r.confidence, 0) / reasonings.length;
    
    // 합의 점수 가중
    const consensusWeight = deliberationResult.consensusScore;
    
    // 전체 신뢰도 = 평균 신뢰도 * 합의 점수
    return avgConfidence * consensusWeight;
  }
  
  /**
   * 불확실성을 요약합니다.
   */
  private summarizeUncertainties(reasonings: AgentReasoning[]): string {
    const allUncertainties = reasonings
      .flatMap(r => r.uncertainties || [])
      .filter((u, i, arr) => arr.indexOf(u) === i); // 중복 제거
    
    if (allUncertainties.length === 0) {
      return '주요 불확실성 없음';
    }
    
    return `주요 불확실성:\n${allUncertainties.map((u, i) => `${i + 1}. ${u}`).join('\n')}`;
  }
  
  /**
   * 공통 주제를 찾습니다.
   */
  private findCommonThemes(texts: string[]): string[] {
    // 간단한 키워드 추출 (실제로는 더 정교한 NLP 필요)
    const keywords = new Map<string, number>();
    
    texts.forEach(text => {
      const words = text.toLowerCase().split(/\s+/);
      words.forEach(word => {
        if (word.length > 3) {
          keywords.set(word, (keywords.get(word) || 0) + 1);
        }
      });
    });
    
    // 2번 이상 나타난 키워드
    return Array.from(keywords.entries())
      .filter(([, count]) => count >= 2)
      .map(([word]) => word)
      .slice(0, 5);
  }
  
  /**
   * 대안 중복 제거
   */
  private deduplicateAlternatives(alternatives: Alternative[]): Alternative[] {
    const seen = new Set<string>();
    return alternatives.filter(alt => {
      const key = alt.title.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }
  
  /**
   * 위험 중복 제거
   */
  private deduplicateRisks(risks: Risk[]): Risk[] {
    const seen = new Set<string>();
    return risks.filter(risk => {
      const key = risk.title.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }
  
  /**
   * 위험 심각도 평가
   */
  private assessRiskSeverity(description: string): 'low' | 'medium' | 'high' | 'critical' {
    const lowerDesc = description.toLowerCase();
    
    if (lowerDesc.includes('critical') || lowerDesc.includes('긴급') || lowerDesc.includes('심각')) {
      return 'critical';
    }
    if (lowerDesc.includes('high') || lowerDesc.includes('높은') || lowerDesc.includes('중요')) {
      return 'high';
    }
    if (lowerDesc.includes('medium') || lowerDesc.includes('중간')) {
      return 'medium';
    }
    
    return 'low';
  }
}









