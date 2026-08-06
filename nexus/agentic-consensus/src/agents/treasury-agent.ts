/**
 * Treasury & Resource Agent
 * 
 * 재무 및 자원 할당 관점에서 이슈를 분석하는 에이전트입니다.
 */

import { BaseAgent } from './base-agent';
import { AgentType } from '@bridge-2026/shared';
import type { AgentReasoning, Issue } from '@bridge-2026/shared';

/** `analyze` 가 각 평가 메서드의 결과를 묶어 넘기는 구조. */
interface TreasuryAssessments {
  financialImpact: { level: string; estimated: string };
  resourceRequirement: { level: string; details: string[] };
  budgetFeasibility: boolean;
}

export class TreasuryAgent extends BaseAgent {
  constructor() {
    super(AgentType.TREASURY, 'Treasury & Resource Agent');
  }
  
  async analyze(issue: Issue, context?: Record<string, unknown>): Promise<AgentReasoning> {
    const considerations: string[] = [];
    const uncertainties: string[] = [];
    
    // 재무 영향 분석
    const financialImpact = this.assessFinancialImpact(issue);
    const resourceRequirement = this.assessResourceRequirement(issue);
    const budgetFeasibility = this.assessBudgetFeasibility(issue, context);
    
    considerations.push(`재무 영향: ${financialImpact.level}`);
    considerations.push(`필요 자원: ${resourceRequirement.level}`);
    considerations.push(`예산 실현 가능성: ${budgetFeasibility ? '가능' : '검토 필요'}`);
    
    // 신뢰도 계산
    const confidence = this.calculateConfidence(issue, {
      financialImpact,
      resourceRequirement,
      budgetFeasibility,
    });
    
    // 추천 사항 생성
    const recommendation = this.generateRecommendation(issue, {
      financialImpact,
      resourceRequirement,
      budgetFeasibility,
    });
    
    // 분석 내용 생성
    const analysis = this.generateAnalysis(issue, {
      financialImpact,
      resourceRequirement,
      budgetFeasibility,
    });
    
    if (!budgetFeasibility) {
      uncertainties.push('예산 제약으로 인한 실행 가능성에 대한 추가 검토가 필요합니다.');
    }
    
    if (resourceRequirement.level === 'high') {
      uncertainties.push('높은 자원 요구사항으로 인해 우선순위 재검토가 필요할 수 있습니다.');
    }
    
    return this.createReasoning(
      analysis,
      recommendation,
      confidence,
      considerations,
      uncertainties
    );
  }
  
  private assessFinancialImpact(issue: Issue): { level: string; estimated: string } {
    // 이슈의 우선순위와 카테고리를 기반으로 재무 영향 추정
    const priorityWeight: Record<string, number> = {
      critical: 1.0,
      high: 0.7,
      medium: 0.4,
      low: 0.2,
    };
    
    const weight = priorityWeight[issue.priority] || 0.5;
    const signalCount = issue.evidence.signals.length;
    
    const impactScore = weight * (1 + Math.min(signalCount / 10, 0.5));
    
    let level: string;
    let estimated: string;
    
    if (impactScore > 0.8) {
      level = 'high';
      estimated = '상당한 재무 영향 예상';
    } else if (impactScore > 0.5) {
      level = 'medium';
      estimated = '중간 수준의 재무 영향 예상';
    } else {
      level = 'low';
      estimated = '낮은 재무 영향 예상';
    }
    
    return { level, estimated };
  }
  
  private assessResourceRequirement(issue: Issue): { level: string; details: string[] } {
    const details: string[] = [];
    let level = 'low';
    
    // 우선순위 기반
    if (issue.priority === 'critical' || issue.priority === 'high') {
      level = 'high';
      details.push(`높은 우선순위로 인한 자원 집중 필요`);
    }
    
    // 카테고리 기반
    const categories = issue.categories || [];
    if (categories.includes('infrastructure') || categories.includes('development')) {
      level = 'high';
      details.push('인프라/개발 관련 이슈로 인한 기술 자원 필요');
    }
    
    // 증거 신호 수
    const signalCount = issue.evidence.signals.length;
    if (signalCount > 15) {
      level = 'high';
      details.push(`다수의 관련 신호 (${signalCount}개)로 인한 광범위한 조사 필요`);
    } else if (signalCount > 5) {
      level = 'medium';
      details.push(`여러 관련 신호 (${signalCount}개)`);
    }
    
    return { level, details };
  }
  
  private assessBudgetFeasibility(
    issue: Issue,
    context?: Record<string, unknown>
  ): boolean {
    // 컨텍스트에서 예산 정보 가져오기
    const availableBudget = context?.availableBudget as number || 1000000; // 기본값
    const estimatedCost = context?.estimatedCost as number;
    
    if (estimatedCost) {
      return estimatedCost <= availableBudget;
    }
    
    // 추정 비용 계산
    const priorityWeight: Record<string, number> = {
      critical: 0.8,
      high: 0.5,
      medium: 0.3,
      low: 0.1,
    };
    
    const weight = priorityWeight[issue.priority] || 0.3;
    const estimatedCost2 = availableBudget * weight;
    
    return estimatedCost2 <= availableBudget * 0.5; // 예산의 50% 이하
  }
  
  private calculateConfidence(
    issue: Issue,
    assessments: TreasuryAssessments
  ): number {
    let confidence = 0.6; // 기본 신뢰도
    
    // 증거가 많을수록 신뢰도 증가
    const signalCount = issue.evidence.signals.length;
    confidence += Math.min(signalCount / 15, 0.2);
    
    // 재무 정보가 있으면 신뢰도 증가
    if (assessments.budgetFeasibility !== undefined) {
      confidence += 0.1;
    }
    
    return Math.max(0.4, Math.min(0.9, confidence));
  }
  
  private generateRecommendation(
    issue: Issue,
    assessments: TreasuryAssessments
  ): string {
    if (!assessments.budgetFeasibility) {
      return '예산 제약이 있어 단계적 접근이나 대안적 자금 조달 방안을 검토해야 합니다.';
    }
    
    if (assessments.resourceRequirement.level === 'high') {
      return '높은 자원 요구사항으로 인해 자원 할당 계획을 수립하고 우선순위를 명확히 해야 합니다.';
    }
    
    if (assessments.financialImpact.level === 'high') {
      return '상당한 재무 영향이 예상되므로 신중한 검토와 단계적 실행을 권장합니다.';
    }
    
    return '재무 관점에서 실행 가능하며, 표준 예산 프로세스를 따르면 됩니다.';
  }
  
  private generateAnalysis(
    issue: Issue,
    assessments: TreasuryAssessments
  ): string {
    return `재무 및 자원 할당 관점 분석:

재무 영향 수준: ${assessments.financialImpact.level}
${assessments.financialImpact.estimated}

자원 요구사항: ${assessments.resourceRequirement.level}
${assessments.resourceRequirement.details.length > 0 ? assessments.resourceRequirement.details.map((d: string) => `- ${d}`).join('\n') : ''}

예산 실현 가능성: ${assessments.budgetFeasibility ? '가능' : '제약 있음'}

우선순위: ${issue.priority}
관련 신호 수: ${issue.evidence.signals.length}개`;
  }
}

