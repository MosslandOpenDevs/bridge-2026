/**
 * Product Feasibility Agent
 * 
 * 제품 실현 가능성 관점에서 이슈를 분석하는 에이전트입니다.
 */

import { BaseAgent } from './base-agent';
import { AgentType } from '@bridge-2026/shared';
import type { AgentReasoning, Issue } from '@bridge-2026/shared';

/** `analyze` 가 각 평가 메서드의 결과를 묶어 넘기는 구조. */
interface FeasibilityAssessments {
  technicalFeasibility: { level: string; details: string[] };
  timelineFeasibility: { level: string; estimatedTime?: string };
  resourceFeasibility: { level: string; requiredResources: string[] };
}

export class ProductFeasibilityAgent extends BaseAgent {
  constructor() {
    super(AgentType.PRODUCT_FEASIBILITY, 'Product Feasibility Agent');
  }
  
  async analyze(issue: Issue, context?: Record<string, unknown>): Promise<AgentReasoning> {
    const considerations: string[] = [];
    const uncertainties: string[] = [];
    
    // 실현 가능성 분석
    const technicalFeasibility = this.assessTechnicalFeasibility(issue);
    const timelineFeasibility = this.assessTimelineFeasibility(issue, context);
    const resourceFeasibility = this.assessResourceFeasibility(issue, context);
    
    considerations.push(`기술적 실현 가능성: ${technicalFeasibility.level}`);
    considerations.push(`일정 실현 가능성: ${timelineFeasibility.level}`);
    considerations.push(`자원 실현 가능성: ${resourceFeasibility.level}`);
    
    // 신뢰도 계산
    const confidence = this.calculateConfidence(issue, {
      technicalFeasibility,
      timelineFeasibility,
      resourceFeasibility,
    });
    
    // 추천 사항 생성
    const recommendation = this.generateRecommendation(issue, {
      technicalFeasibility,
      timelineFeasibility,
      resourceFeasibility,
    });
    
    // 분석 내용 생성
    const analysis = this.generateAnalysis(issue, {
      technicalFeasibility,
      timelineFeasibility,
      resourceFeasibility,
    });
    
    if (technicalFeasibility.level === 'low') {
      uncertainties.push('기술적 제약으로 인한 실현 가능성에 대한 추가 검토가 필요합니다.');
    }
    
    if (timelineFeasibility.level === 'low') {
      uncertainties.push('일정 제약으로 인한 단계적 접근이 필요할 수 있습니다.');
    }
    
    return this.createReasoning(
      analysis,
      recommendation,
      confidence,
      considerations,
      uncertainties
    );
  }
  
  private assessTechnicalFeasibility(issue: Issue): { level: string; details: string[] } {
    const details: string[] = [];
    let level = 'medium'; // 기본값
    
    // 카테고리 기반
    const categories = issue.categories || [];
    if (categories.includes('technical') || categories.includes('infrastructure')) {
      // 기술 관련 이슈는 더 자세한 검토 필요
      level = 'medium';
      details.push('기술적 복잡도 검토 필요');
    }
    
    // 우선순위 기반
    if (issue.priority === 'critical') {
      level = 'high';
      details.push('긴급 이슈로 인한 빠른 실행 가능성');
    } else if (issue.priority === 'low') {
      level = 'high';
      details.push('낮은 우선순위로 인한 유연한 일정 가능');
    }
    
    // 증거 신호 수
    const signalCount = issue.evidence.signals.length;
    if (signalCount > 20) {
      level = 'low';
      details.push(`다수의 관련 신호 (${signalCount}개)로 인한 복잡도 증가`);
    } else if (signalCount < 3) {
      level = 'high';
      details.push(`적은 관련 신호 (${signalCount}개)로 인한 단순한 해결 가능`);
    }
    
    return { level, details };
  }
  
  private assessTimelineFeasibility(
    issue: Issue,
    context?: Record<string, unknown>
  ): { level: string; estimatedTime?: string } {
    // 컨텍스트에서 일정 정보 가져오기
    const requiredTimeline = context?.requiredTimeline as string;
    const availableTime = context?.availableTime as number;
    
    let level = 'medium';
    let estimatedTime: string | undefined;
    
    // 우선순위 기반 추정
    const priorityTimeline: Record<string, string> = {
      critical: '1-2주',
      high: '2-4주',
      medium: '1-2개월',
      low: '2-3개월',
    };
    
    estimatedTime = priorityTimeline[issue.priority] || '1-2개월';
    
    // 증거 신호 수 기반 조정
    const signalCount = issue.evidence.signals.length;
    if (signalCount > 15) {
      estimatedTime = `추가 시간 필요 (${estimatedTime} + 추가 검토)`;
      level = 'low';
    } else if (signalCount < 5) {
      level = 'high';
    }
    
    if (requiredTimeline && availableTime) {
      // 일정 제약 검사
      const timelineDays = this.parseTimelineToDays(requiredTimeline);
      if (availableTime < timelineDays) {
        level = 'low';
      }
    }
    
    return { level, estimatedTime };
  }
  
  private assessResourceFeasibility(
    issue: Issue,
    context?: Record<string, unknown>
  ): { level: string; requiredResources: string[] } {
    const requiredResources: string[] = [];
    let level = 'medium';
    
    // 카테고리 기반
    const categories = issue.categories || [];
    if (categories.includes('development')) {
      requiredResources.push('개발자 리소스');
      level = 'medium';
    }
    if (categories.includes('infrastructure')) {
      requiredResources.push('인프라 리소스');
      level = 'medium';
    }
    if (categories.includes('governance')) {
      requiredResources.push('거버넌스 리소스');
      level = 'high';
    }
    
    // 우선순위 기반
    if (issue.priority === 'critical') {
      requiredResources.push('긴급 대응 팀');
      level = 'high';
    }
    
    // 증거 신호 수
    const signalCount = issue.evidence.signals.length;
    if (signalCount > 10) {
      requiredResources.push('추가 분석 리소스');
      level = 'low';
    }
    
    return { level, requiredResources };
  }
  
  private parseTimelineToDays(timeline: string): number {
    // 간단한 파싱 (실제로는 더 정교한 로직 필요)
    if (timeline.includes('주')) {
      const weeks = parseInt(timeline) || 1;
      return weeks * 7;
    }
    if (timeline.includes('개월')) {
      const months = parseInt(timeline) || 1;
      return months * 30;
    }
    return 30; // 기본값
  }
  
  private calculateConfidence(
    issue: Issue,
    assessments: FeasibilityAssessments
  ): number {
    let confidence = 0.6; // 기본 신뢰도
    
    // 증거가 많을수록 신뢰도 증가
    const signalCount = issue.evidence.signals.length;
    confidence += Math.min(signalCount / 15, 0.2);
    
    // 실현 가능성 정보가 있으면 신뢰도 증가
    if (assessments.timelineFeasibility.estimatedTime) {
      confidence += 0.1;
    }
    
    // 모든 실현 가능성이 높으면 신뢰도 증가
    const allHigh = Object.values(assessments).every(a => a.level === 'high');
    if (allHigh) {
      confidence += 0.1;
    }
    
    return Math.max(0.4, Math.min(0.9, confidence));
  }
  
  private generateRecommendation(
    issue: Issue,
    assessments: FeasibilityAssessments
  ): string {
    if (assessments.technicalFeasibility.level === 'low') {
      return '기술적 제약이 있어 추가 기술 검토나 대안적 접근 방식을 고려해야 합니다.';
    }
    
    if (assessments.timelineFeasibility.level === 'low') {
      return '일정 제약이 있어 단계적 접근이나 우선순위 조정이 필요할 수 있습니다.';
    }
    
    if (assessments.resourceFeasibility.level === 'low') {
      return '자원 제약이 있어 자원 할당 계획을 수립하거나 외부 자원 활용을 고려해야 합니다.';
    }
    
    return `제품 관점에서 실현 가능하며, 예상 일정: ${assessments.timelineFeasibility.estimatedTime || '1-2개월'}`;
  }
  
  private generateAnalysis(
    issue: Issue,
    assessments: FeasibilityAssessments
  ): string {
    return `제품 실현 가능성 관점 분석:

기술적 실현 가능성: ${assessments.technicalFeasibility.level}
${assessments.technicalFeasibility.details.length > 0 ? assessments.technicalFeasibility.details.map(d => `- ${d}`).join('\n') : ''}

일정 실현 가능성: ${assessments.timelineFeasibility.level}
${assessments.timelineFeasibility.estimatedTime ? `예상 일정: ${assessments.timelineFeasibility.estimatedTime}` : ''}

자원 실현 가능성: ${assessments.resourceFeasibility.level}
필요 자원: ${assessments.resourceFeasibility.requiredResources.join(', ') || '없음'}

우선순위: ${issue.priority}
관련 신호 수: ${issue.evidence.signals.length}개`;
  }
}









