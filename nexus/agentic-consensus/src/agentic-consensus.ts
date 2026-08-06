/**
 * Agentic Consensus
 * 
 * 멀티 에이전트 협의 및 Decision Packet 생성을 관리하는 메인 서비스입니다.
 */

import type { Issue, DecisionPacket } from '@bridge-2026/shared';
import { DeliberationEngine, type DeliberationConfig } from './deliberation/deliberation-engine';
import { Moderator, type ModeratorConfig } from './moderator/moderator';
import { PacketBuilder } from './decision-packet/packet-builder';
import {
  RiskSecurityAgent,
  TreasuryAgent,
  CommunityAgent,
  ProductFeasibilityAgent,
  ModeratorAgent,
} from './agents';

/**
 * Agentic Consensus 서비스
 */
export class AgenticConsensus {
  private deliberationEngine: DeliberationEngine;
  private moderator: Moderator;
  private packetBuilder: PacketBuilder;
  
  constructor(config?: {
    deliberation?: DeliberationConfig;
    moderator?: Partial<ModeratorConfig>;
  }) {
    // 협의 엔진 초기화
    this.deliberationEngine = new DeliberationEngine(config?.deliberation);
    
    // 에이전트 등록 (5개 에이전트)
    this.deliberationEngine.registerAgents([
      new RiskSecurityAgent(),
      new TreasuryAgent(),
      new CommunityAgent(),
      new ProductFeasibilityAgent(),
      new ModeratorAgent(),
    ]);
    
    // 모더레이터 초기화
    this.moderator = new Moderator(config?.moderator);
    
    // 패킷 빌더 초기화
    this.packetBuilder = new PacketBuilder({ strictValidation: true });
  }
  
  /**
   * 이슈에 대해 협의를 수행하고 Decision Packet을 생성합니다.
   */
  async processIssue(
    issue: Issue,
    context?: Record<string, unknown>
  ): Promise<DecisionPacket> {
    // 1. 협의 수행
    const deliberationResult = await this.deliberationEngine.deliberate(issue, context);
    
    // 2. Decision Packet 생성
    const decisionPacket = await this.moderator.synthesize(issue, deliberationResult);
    
    // 3. 검증 및 빌드
    const builtPacket = this.packetBuilder.build(decisionPacket);
    
    return builtPacket;
  }
  
  /**
   * 협의 엔진을 가져옵니다.
   */
  getDeliberationEngine(): DeliberationEngine {
    return this.deliberationEngine;
  }
  
  /**
   * 모더레이터를 가져옵니다.
   */
  getModerator(): Moderator {
    return this.moderator;
  }
}

/**
 * 싱글톤 인스턴스
 */
export const agenticConsensus = new AgenticConsensus();

