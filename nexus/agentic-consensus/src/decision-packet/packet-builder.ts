/**
 * Decision Packet Builder
 * 
 * Decision Packet을 구성하고 검증하는 빌더입니다.
 */

import type { DecisionPacket } from '@bridge-2026/shared';

export interface PacketBuilderConfig {
  /** 필수 필드 검증 여부 */
  strictValidation?: boolean;
}

/**
 * Decision Packet 빌더
 */
export class PacketBuilder {
  private config: PacketBuilderConfig;
  
  constructor(config: PacketBuilderConfig = {}) {
    this.config = {
      strictValidation: config.strictValidation ?? true,
    };
  }
  
  /**
   * Decision Packet을 빌드합니다.
   */
  build(packet: Partial<DecisionPacket>): DecisionPacket {
    if (this.config.strictValidation) {
      this.validate(packet);
    }
    
    // 필수 필드 확인 및 기본값 설정
    const built: DecisionPacket = {
      id: packet.id || `dp-${Date.now()}`,
      issueId: packet.issueId || '',
      recommendation: packet.recommendation || '추가 분석 필요',
      recommendationDetails: packet.recommendationDetails || '',
      alternatives: packet.alternatives || [],
      risks: packet.risks || [],
      kpis: packet.kpis || [],
      dissentingOpinions: packet.dissentingOpinions || [],
      agentReasoning: packet.agentReasoning || [],
      overallConfidence: packet.overallConfidence ?? 0.5,
      createdAt: packet.createdAt || Date.now(),
      moderator: packet.moderator || { version: '1.0.0' },
    };
    
    if (packet.uncertaintySummary !== undefined) {
      built.uncertaintySummary = packet.uncertaintySummary;
    }
    
    if (packet.metadata !== undefined) {
      built.metadata = packet.metadata;
    }
    
    return built;
  }
  
  /**
   * Decision Packet을 검증합니다.
   */
  validate(packet: Partial<DecisionPacket>): void {
    const errors: string[] = [];
    
    if (!packet.issueId) {
      errors.push('issueId is required');
    }
    
    if (!packet.recommendation) {
      errors.push('recommendation is required');
    }
    
    if (!packet.agentReasoning || packet.agentReasoning.length === 0) {
      errors.push('at least one agentReasoning is required');
    }
    
    if (packet.overallConfidence !== undefined) {
      if (packet.overallConfidence < 0 || packet.overallConfidence > 1) {
        errors.push('overallConfidence must be between 0 and 1');
      }
    }
    
    if (errors.length > 0) {
      throw new Error(`Decision Packet validation failed: ${errors.join(', ')}`);
    }
  }
}









