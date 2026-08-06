/**
 * Community Impact Agent
 * 
 * 커뮤니티 영향 관점에서 이슈를 분석하는 에이전트입니다.
 */

import { BaseAgent } from './base-agent';
import { AgentType } from '@bridge-2026/shared';
import type { AgentReasoning, Issue } from '@bridge-2026/shared';

/** `analyze` 가 각 평가 메서드의 결과를 묶어 넘기는 구조. */
interface CommunityAssessments {
  communityImpact: { level: string; affectedGroups: string[] };
  participationImpact: { level: string; details: string[] };
  sentimentImpact: { level: string; direction: 'positive' | 'negative' | 'neutral' };
}

export class CommunityAgent extends BaseAgent {
  constructor() {
    super(AgentType.COMMUNITY, 'Community Impact Agent');
  }
  
  async analyze(issue: Issue, context?: Record<string, unknown>): Promise<AgentReasoning> {
    const considerations: string[] = [];
    const uncertainties: string[] = [];
    
    // 커뮤니티 영향 분석
    const communityImpact = this.assessCommunityImpact(issue);
    const participationImpact = this.assessParticipationImpact(issue);
    const sentimentImpact = this.assessSentimentImpact(issue, context);
    
    considerations.push(`커뮤니티 영향: ${communityImpact.level}`);
    considerations.push(`참여 영향: ${participationImpact.level}`);
    considerations.push(`감정 영향: ${sentimentImpact.level}`);
    
    // 신뢰도 계산
    const confidence = this.calculateConfidence(issue, {
      communityImpact,
      participationImpact,
      sentimentImpact,
    });
    
    // 추천 사항 생성
    const recommendation = this.generateRecommendation(issue, {
      communityImpact,
      participationImpact,
      sentimentImpact,
    });
    
    // 분석 내용 생성
    const analysis = this.generateAnalysis(issue, {
      communityImpact,
      participationImpact,
      sentimentImpact,
    });
    
    if (communityImpact.level === 'high') {
      uncertainties.push('높은 커뮤니티 영향으로 인해 광범위한 커뮤니케이션이 필요할 수 있습니다.');
    }
    
    if (sentimentImpact.level === 'negative') {
      uncertainties.push('부정적 감정 영향이 예상되므로 신중한 접근이 필요합니다.');
    }
    
    return this.createReasoning(
      analysis,
      recommendation,
      confidence,
      considerations,
      uncertainties
    );
  }
  
  private assessCommunityImpact(issue: Issue): { level: string; affectedGroups: string[] } {
    const affectedGroups: string[] = [];
    let level = 'low';
    
    // 우선순위 기반
    if (issue.priority === 'critical' || issue.priority === 'high') {
      level = 'high';
      affectedGroups.push('전체 커뮤니티');
    }
    
    // 카테고리 기반
    const categories = issue.categories || [];
    if (categories.includes('governance')) {
      level = 'high';
      affectedGroups.push('거버넌스 참여자');
    }
    if (categories.includes('treasury')) {
      level = 'medium';
      affectedGroups.push('토큰 보유자');
    }
    if (categories.includes('technical')) {
      level = 'medium';
      affectedGroups.push('개발자 커뮤니티');
    }
    
    // 증거 신호 수
    const signalCount = issue.evidence.signals.length;
    if (signalCount > 10) {
      level = 'high';
      affectedGroups.push('광범위한 사용자');
    }
    
    return { level, affectedGroups };
  }
  
  private assessParticipationImpact(issue: Issue): { level: string; details: string[] } {
    const details: string[] = [];
    let level = 'low';
    
    // 거버넌스 관련 이슈는 참여에 직접적 영향
    const categories = issue.categories || [];
    if (categories.includes('governance')) {
      level = 'high';
      details.push('거버넌스 프로세스에 직접적 영향');
    }
    
    // 우선순위 기반
    if (issue.priority === 'critical') {
      level = 'high';
      details.push('긴급 이슈로 인한 높은 관심도 예상');
    }
    
    // 트렌드 분석
    const trendDirection = issue.evidence.statisticalEvidence?.trendDirection;
    if (trendDirection === 'decreasing') {
      level = 'high';
      details.push('참여율 감소 트렌드로 인한 추가 조치 필요');
    }
    
    return { level, details };
  }
  
  private assessSentimentImpact(
    issue: Issue,
    context?: Record<string, unknown>
  ): { level: string; direction: 'positive' | 'negative' | 'neutral' } {
    // 컨텍스트에서 감정 정보 가져오기
    const sentiment = context?.sentiment as string || 'neutral';
    
    let level = 'low';
    let direction: 'positive' | 'negative' | 'neutral' = 'neutral';
    
    if (sentiment === 'positive') {
      direction = 'positive';
      level = 'medium';
    } else if (sentiment === 'negative') {
      direction = 'negative';
      level = 'high';
    }
    
    // 우선순위 기반 조정
    if (issue.priority === 'critical' && direction === 'negative') {
      level = 'high';
    }
    
    return { level, direction };
  }
  
  private calculateConfidence(
    issue: Issue,
    assessments: CommunityAssessments
  ): number {
    let confidence = 0.65; // 기본 신뢰도
    
    // 증거가 많을수록 신뢰도 증가
    const signalCount = issue.evidence.signals.length;
    confidence += Math.min(signalCount / 20, 0.2);
    
    // 커뮤니티 데이터가 있으면 신뢰도 증가
    if (assessments.sentimentImpact.level !== 'low') {
      confidence += 0.1;
    }
    
    return Math.max(0.5, Math.min(0.9, confidence));
  }
  
  private generateRecommendation(
    issue: Issue,
    assessments: CommunityAssessments
  ): string {
    if (assessments.sentimentImpact.direction === 'negative') {
      return '부정적 감정 영향이 예상되므로 투명한 커뮤니케이션과 신중한 접근이 필요합니다.';
    }
    
    if (assessments.communityImpact.level === 'high') {
      return '높은 커뮤니티 영향으로 인해 광범위한 커뮤니티 피드백 수집과 단계적 실행을 권장합니다.';
    }
    
    if (assessments.participationImpact.level === 'high') {
      return '참여에 직접적 영향을 미치므로 커뮤니티와의 소통을 강화해야 합니다.';
    }
    
    return '커뮤니티 관점에서 표준 프로세스를 따르면 됩니다.';
  }
  
  private generateAnalysis(
    issue: Issue,
    assessments: CommunityAssessments
  ): string {
    return `커뮤니티 영향 관점 분석:

커뮤니티 영향 수준: ${assessments.communityImpact.level}
영향을 받는 그룹: ${assessments.communityImpact.affectedGroups.join(', ') || '없음'}

참여 영향 수준: ${assessments.participationImpact.level}
${assessments.participationImpact.details.length > 0 ? assessments.participationImpact.details.map(d => `- ${d}`).join('\n') : ''}

감정 영향: ${assessments.sentimentImpact.level} (${assessments.sentimentImpact.direction})

우선순위: ${issue.priority}
관련 신호 수: ${issue.evidence.signals.length}개`;
  }
}









