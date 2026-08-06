/**
 * Moderator Agent
 * 
 * 토론 규칙을 집행하고 최종 Decision Packet을 작성하는 모더레이터 에이전트입니다.
 */

import { BaseAgent } from './base-agent';
import { AgentType } from '@bridge-2026/shared';
import type { AgentReasoning, Issue } from '@bridge-2026/shared';

export class ModeratorAgent extends BaseAgent {
  constructor() {
    super(AgentType.MODERATOR, 'Moderator Agent');
  }
  
  async analyze(issue: Issue, context?: Record<string, unknown>): Promise<AgentReasoning> {
    // Moderator는 다른 에이전트들의 추론을 종합하는 역할이므로
    // 초기 분석에서는 중립적인 관점을 제공
    const considerations: string[] = [];
    
    considerations.push('토론 규칙 집행 및 합의 도달 지원');
    considerations.push('모든 에이전트의 의견을 공정하게 종합');
    considerations.push('반대 의견 및 불확실성 명시');
    
    const analysis = `모더레이터 관점:

이슈: ${issue.title}
우선순위: ${issue.priority}
관련 신호 수: ${issue.evidence.signals.length}개

모더레이터는 다른 전문 에이전트들의 토론을 관리하고, 
최종 Decision Packet을 작성하는 역할을 합니다.

토론 프로토콜:
1. Evidence Round: 근거 신호 인용
2. Proposal Round: 실행안 제시
3. Critique Round: 상호 검토
4. Synthesis Round: 최종 종합`;
    
    const recommendation = '다른 전문 에이전트들의 토론을 기다린 후 종합하여 Decision Packet을 생성합니다.';
    
    return this.createReasoning(
      analysis,
      recommendation,
      0.8, // 높은 신뢰도 (모더레이터는 중립적 역할)
      considerations,
      ['다른 에이전트들의 의견이 수집된 후 최종 판단 필요']
    );
  }
  
  /**
   * 다른 에이전트들의 추론을 종합하여 Decision Packet을 생성합니다.
   * (이 메서드는 DeliberationEngine에서 호출됨)
   */
  synthesizeReasonings(
    issue: Issue,
    reasonings: AgentReasoning[]
  ): {
    recommendation: string;
    confidence: number;
    summary: string;
  } {
    if (reasonings.length === 0) {
      return {
        recommendation: '추가 분석이 필요합니다.',
        confidence: 0.0,
        summary: '에이전트 추론이 없습니다.',
      };
    }
    
    // 신뢰도 가중 평균 계산
    const totalConfidence = reasonings.reduce((sum, r) => sum + r.confidence, 0);
    const avgConfidence = totalConfidence / reasonings.length;
    
    // 가장 높은 신뢰도의 에이전트 추천 사용
    const highestConfidence = reasonings.reduce((prev, curr) =>
      curr.confidence > prev.confidence ? curr : prev
    );
    
    // 공통 주제 추출
    const commonThemes = this.extractCommonThemes(reasonings);
    
    const summary = `모더레이터 종합:

총 ${reasonings.length}개 에이전트의 의견을 종합했습니다.
평균 신뢰도: ${(avgConfidence * 100).toFixed(1)}%

주요 추천: ${highestConfidence.recommendation}
추천 에이전트: ${highestConfidence.agentType}

공통 주제: ${commonThemes.join(', ')}

각 에이전트 관점:
${reasonings.map(r => `- ${r.agentType}: ${r.recommendation.substring(0, 100)}...`).join('\n')}`;
    
    return {
      recommendation: highestConfidence.recommendation,
      confidence: avgConfidence,
      summary,
    };
  }
  
  /**
   * 공통 주제를 추출합니다.
   */
  private extractCommonThemes(reasonings: AgentReasoning[]): string[] {
    const themes = new Map<string, number>();
    
    reasonings.forEach(reasoning => {
      const words = reasoning.recommendation.toLowerCase().split(/\s+/);
      words.forEach(word => {
        if (word.length > 3) {
          themes.set(word, (themes.get(word) || 0) + 1);
        }
      });
    });
    
    // 2번 이상 나타난 단어
    return Array.from(themes.entries())
      .filter(([, count]) => count >= 2)
      .map(([word]) => word)
      .slice(0, 5);
  }
}

