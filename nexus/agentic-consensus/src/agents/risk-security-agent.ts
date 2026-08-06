/**
 * Risk & Security Agent
 * 
 * 위험 및 보안 관점에서 이슈를 분석하는 에이전트입니다.
 */

import { BaseAgent } from './base-agent';
import { AgentType } from '@bridge-2026/shared';
import type { AgentReasoning, Issue } from '@bridge-2026/shared';

/** `analyze` 가 각 평가 메서드의 결과를 묶어 넘기는 구조. */
interface RiskAssessments {
  priorityRisk: { level: string; description: string };
  securityRisk: { level: string; details: string[] };
  operationalRisk: { level: string; details: string[] };
}

export class RiskSecurityAgent extends BaseAgent {
  constructor() {
    super(AgentType.RISK_SECURITY, 'Risk & Security Agent');
  }
  
  async analyze(issue: Issue, context?: Record<string, unknown>): Promise<AgentReasoning> {
    const considerations: string[] = [];
    const uncertainties: string[] = [];
    
    // 위험 분석
    const priorityRisk = this.assessPriorityRisk(issue);
    const securityRisk = this.assessSecurityRisk(issue);
    const operationalRisk = this.assessOperationalRisk(issue);
    
    considerations.push(`우선순위: ${issue.priority} - ${priorityRisk.description}`);
    considerations.push(`보안 위험: ${securityRisk.level}`);
    considerations.push(`운영 위험: ${operationalRisk.level}`);
    
    // 신뢰도 계산
    const confidence = this.calculateConfidence(issue, {
      priorityRisk,
      securityRisk,
      operationalRisk,
    });
    
    // 추천 사항 생성
    const recommendation = this.generateRecommendation(issue, {
      priorityRisk,
      securityRisk,
      operationalRisk,
    });
    
    // 분석 내용 생성
    const analysis = this.generateAnalysis(issue, {
      priorityRisk,
      securityRisk,
      operationalRisk,
    });
    
    if (securityRisk.level === 'high' || operationalRisk.level === 'high') {
      uncertainties.push('높은 위험 수준으로 인해 추가 검토가 필요합니다.');
    }
    
    return this.createReasoning(
      analysis,
      recommendation,
      confidence,
      considerations,
      uncertainties
    );
  }
  
  private assessPriorityRisk(issue: Issue): { level: string; description: string } {
    const priorityMap: Record<string, { level: string; description: string }> = {
      critical: { level: 'high', description: '즉각적인 조치가 필요합니다' },
      high: { level: 'medium', description: '신속한 검토가 필요합니다' },
      medium: { level: 'low', description: '일반적인 검토 프로세스로 충분합니다' },
      low: { level: 'low', description: '낮은 우선순위입니다' },
    };
    
    return priorityMap[issue.priority] || { level: 'medium', description: '검토 필요' };
  }
  
  private assessSecurityRisk(issue: Issue): { level: string; details: string[] } {
    const details: string[] = [];
    let level = 'low';
    
    // 보안 관련 키워드 검사
    const securityKeywords = ['security', 'breach', 'attack', 'vulnerability', 'access', 'permission'];
    const issueText = `${issue.title} ${issue.description}`.toLowerCase();
    
    const foundKeywords = securityKeywords.filter(keyword => issueText.includes(keyword));
    if (foundKeywords.length > 0) {
      level = 'high';
      details.push(`보안 관련 키워드 발견: ${foundKeywords.join(', ')}`);
    }
    
    // 증거 신호 수 검사
    const signalCount = issue.evidence.signals.length;
    if (signalCount > 10) {
      level = 'medium';
      details.push(`다수의 관련 신호 (${signalCount}개)`);
    }
    
    return { level, details };
  }
  
  private assessOperationalRisk(issue: Issue): { level: string; details: string[] } {
    const details: string[] = [];
    let level = 'low';
    
    // 이상 점수 검사
    const anomalyScore = issue.evidence.statisticalEvidence?.anomalyScore || 0;
    if (anomalyScore > 0.7) {
      level = 'high';
      details.push(`높은 이상 점수: ${anomalyScore.toFixed(2)}`);
    } else if (anomalyScore > 0.4) {
      level = 'medium';
      details.push(`중간 이상 점수: ${anomalyScore.toFixed(2)}`);
    }
    
    // 트렌드 방향 검사
    const trendDirection = issue.evidence.statisticalEvidence?.trendDirection;
    if (trendDirection === 'decreasing' && issue.priority === 'high') {
      level = 'high';
      details.push('우선순위가 높은 이슈의 악화 트렌드');
    }
    
    return { level, details };
  }
  
  private calculateConfidence(
    issue: Issue,
    risks: RiskAssessments
  ): number {
    let confidence = 0.7; // 기본 신뢰도
    
    // 증거가 많을수록 신뢰도 증가
    const signalCount = issue.evidence.signals.length;
    confidence += Math.min(signalCount / 20, 0.2);
    
    // 위험 수준에 따라 조정
    if (risks.securityRisk.level === 'high') {
      confidence -= 0.2;
    }
    if (risks.operationalRisk.level === 'high') {
      confidence -= 0.1;
    }
    
    return Math.max(0.3, Math.min(0.95, confidence));
  }
  
  private generateRecommendation(
    issue: Issue,
    risks: RiskAssessments
  ): string {
    if (risks.securityRisk.level === 'high') {
      return '즉각적인 보안 검토 및 대응 조치가 필요합니다. 보안 팀과 긴급 협의를 권장합니다.';
    }
    
    if (risks.operationalRisk.level === 'high') {
      return '운영 위험이 높으므로 신중한 검토와 단계적 접근이 필요합니다. 롤백 계획을 마련해야 합니다.';
    }
    
    if (issue.priority === 'critical') {
      return '긴급 조치가 필요합니다. 최소한의 검토 후 신속한 실행을 권장합니다.';
    }
    
    return '표준 거버넌스 프로세스를 따르되, 위험 요소를 지속적으로 모니터링해야 합니다.';
  }
  
  private generateAnalysis(
    issue: Issue,
    risks: RiskAssessments
  ): string {
    return `위험 및 보안 관점 분석:

우선순위: ${issue.priority}
보안 위험 수준: ${risks.securityRisk.level}
운영 위험 수준: ${risks.operationalRisk.level}

주요 고려사항:
- 관련 신호 수: ${issue.evidence.signals.length}개
- 이상 점수: ${(issue.evidence.statisticalEvidence?.anomalyScore || 0).toFixed(2)}
- 트렌드: ${issue.evidence.statisticalEvidence?.trendDirection || 'N/A'}

${risks.securityRisk.details.length > 0 ? `보안 세부사항:\n${risks.securityRisk.details.map(d => `- ${d}`).join('\n')}\n` : ''}
${risks.operationalRisk.details.length > 0 ? `운영 세부사항:\n${risks.operationalRisk.details.map(d => `- ${d}`).join('\n')}` : ''}`;
  }
}









