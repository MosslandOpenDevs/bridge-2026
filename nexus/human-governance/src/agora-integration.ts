/**
 * Agora Integration
 * 
 * Agora 거버넌스 플랫폼과의 연동을 담당합니다.
 */

import type { Proposal, DecisionPacket } from '@bridge-2026/shared';
import { governanceService } from './governance-service';

/**
 * Agora 연동 서비스
 */
export class AgoraIntegration {
  private agoraApiUrl?: string;
  
  constructor(agoraApiUrl?: string) {
    this.agoraApiUrl = agoraApiUrl;
  }
  
  /**
   * Decision Packet을 Agora Proposal로 변환합니다.
   */
  async convertToAgoraProposal(
    decisionPacket: DecisionPacket,
    config?: {
      votingDurationDays?: number;
      minParticipationRate?: number;
      passingThreshold?: number;
      createdBy?: string;
    }
  ): Promise<Proposal> {
    // Governance Service를 통해 Proposal 생성
    const proposal = await governanceService.createProposalFromDecisionPacket(
      decisionPacket,
      config
    );
    
    // Agora API에 전송 (실제 구현 시)
    if (this.agoraApiUrl) {
      await this.sendToAgora(proposal);
    }
    
    return proposal;
  }
  
  /**
   * Proposal을 Agora에 전송합니다.
   */
  private async sendToAgora(proposal: Proposal): Promise<void> {
    // TODO: 실제 Agora API 호출
    // 예시:
    // await fetch(`${this.agoraApiUrl}/api/proposals`, {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({
    //     ...proposal,
    //     tags: ['ai-assisted', 'bridge-2026'],
    //   }),
    // });
    
    console.log(`[Agora Integration] Proposal ${proposal.id} would be sent to Agora`);
  }
  
  /**
   * AI Assisted Proposal 태그를 추가합니다.
   */
  addAIAssistedTag(proposal: Proposal): Proposal {
    if (!proposal.metadata) {
      proposal.metadata = {};
    }
    
    proposal.metadata.aiAssisted = true;
    proposal.metadata.bridge2026 = true;
    proposal.metadata.source = 'agentic-consensus';
    
    return proposal;
  }
  
  /**
   * Proposal을 Agora 형식으로 포맷팅합니다.
   */
  formatForAgora(proposal: Proposal, decisionPacket: DecisionPacket): {
    title: string;
    description: string;
    metadata: Record<string, unknown>;
  } {
    return {
      title: proposal.title,
      description: proposal.description,
      metadata: {
        ...proposal.metadata,
        decisionPacket: {
          id: decisionPacket.id,
          recommendation: decisionPacket.recommendation,
          alternatives: decisionPacket.alternatives.map(a => a.title),
          risks: decisionPacket.risks.map(r => ({ title: r.title, severity: r.severity })),
          kpis: decisionPacket.kpis.map(k => k.name),
          overallConfidence: decisionPacket.overallConfidence,
          agentReasoning: decisionPacket.agentReasoning.map(r => ({
            agentType: r.agentType,
            recommendation: r.recommendation,
            confidence: r.confidence,
          })),
        },
      },
    };
  }
}

/**
 * 싱글톤 인스턴스
 */
export const agoraIntegration = new AgoraIntegration();









