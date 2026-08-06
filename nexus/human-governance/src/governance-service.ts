/**
 * Governance Service
 * 
 * Human Governance의 메인 서비스입니다.
 * Decision Packet을 Proposal로 변환하고, 투표를 관리합니다.
 */

import type { DecisionPacket, Proposal, Vote, ProposalResult } from '@bridge-2026/shared';
import { ProposalStatus, ProposalType } from '@bridge-2026/shared';
import { EventType, eventPublisher } from '@bridge-2026/event-bus';
import { v4 as uuidv4 } from 'uuid';

/**
 * 거버넌스 서비스
 */
export class GovernanceService {
  private proposals: Map<string, Proposal> = new Map();
  private votes: Map<string, Vote[]> = new Map();
  
  /**
   * Decision Packet으로부터 Proposal을 생성합니다.
   */
  async createProposalFromDecisionPacket(
    decisionPacket: DecisionPacket,
    config?: {
      votingDurationDays?: number;
      minParticipationRate?: number;
      passingThreshold?: number;
      createdBy?: string;
    }
  ): Promise<Proposal> {
    const now = Date.now();
    const votingDuration = (config?.votingDurationDays || 7) * 24 * 60 * 60 * 1000;
    
    const proposal: Proposal = {
      id: uuidv4(),
      title: `[AI Assisted] ${decisionPacket.recommendation.substring(0, 100)}`,
      description: this.generateProposalDescription(decisionPacket),
      type: this.inferProposalType(decisionPacket),
      status: ProposalStatus.PENDING,
      decisionPacketId: decisionPacket.id,
      issueId: decisionPacket.issueId,
      actions: this.extractActions(decisionPacket),
      votingStartTime: now,
      votingEndTime: now + votingDuration,
      minParticipationRate: config?.minParticipationRate || 0.1, // 10%
      passingThreshold: config?.passingThreshold || 0.5, // 50%
      createdBy: config?.createdBy,
      createdAt: now,
      updatedAt: now,
      metadata: {
        aiAssisted: true,
        decisionPacket: decisionPacket.id,
        agentConfidence: decisionPacket.overallConfidence,
      },
    };
    
    this.proposals.set(proposal.id, proposal);
    
    // 이벤트 발행
    await eventPublisher.publish({
      type: EventType.PROPOSAL_CREATED,
      id: `event-${Date.now()}-${Math.random()}`,
      timestamp: now,
      source: 'human-governance',
      data: proposal,
    });
    
    return proposal;
  }
  
  /**
   * Proposal을 활성화합니다 (투표 시작).
   */
  async activateProposal(proposalId: string): Promise<void> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`Proposal ${proposalId} not found`);
    }
    
    const oldStatus = proposal.status;
    proposal.status = ProposalStatus.ACTIVE;
    proposal.updatedAt = Date.now();
    
    await eventPublisher.publish({
      type: EventType.PROPOSAL_STATUS_CHANGED,
      id: `event-${Date.now()}-${Math.random()}`,
      timestamp: Date.now(),
      source: 'human-governance',
      data: {
        proposalId,
        oldStatus,
        newStatus: proposal.status,
      },
    });
  }
  
  /**
   * 투표를 기록합니다.
   */
  async castVote(
    proposalId: string,
    voterAddress: string,
    choice: 'yes' | 'no' | 'abstain',
    weight: number,
    txHash?: string
  ): Promise<Vote> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`Proposal ${proposalId} not found`);
    }
    
    if (proposal.status !== 'active') {
      throw new Error(`Proposal ${proposalId} is not active`);
    }
    
    // 기존 투표 확인
    const existingVotes = this.votes.get(proposalId) || [];
    const existingVote = existingVotes.find(v => v.voterAddress === voterAddress);
    if (existingVote) {
      throw new Error(`Vote already cast by ${voterAddress}`);
    }
    
    const vote: Vote = {
      id: uuidv4(),
      proposalId,
      voterAddress,
      choice,
      weight,
      votedAt: Date.now(),
      txHash,
    };
    
    existingVotes.push(vote);
    this.votes.set(proposalId, existingVotes);
    
    // 이벤트 발행
    await eventPublisher.publish({
      type: EventType.VOTE_CAST,
      id: `event-${Date.now()}-${Math.random()}`,
      timestamp: Date.now(),
      source: 'human-governance',
      data: {
        proposalId,
        voterAddress,
        choice,
        weight,
      },
    });
    
    return vote;
  }
  
  /**
   * 투표 결과를 계산합니다.
   */
  async calculateProposalResult(proposalId: string): Promise<ProposalResult> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`Proposal ${proposalId} not found`);
    }
    
    const votes = this.votes.get(proposalId) || [];
    
    const yesVotes = votes.filter(v => v.choice === 'yes').length;
    const noVotes = votes.filter(v => v.choice === 'no').length;
    const abstainVotes = votes.filter(v => v.choice === 'abstain').length;
    
    const yesWeight = votes.filter(v => v.choice === 'yes').reduce((sum, v) => sum + v.weight, 0);
    const noWeight = votes.filter(v => v.choice === 'no').reduce((sum, v) => sum + v.weight, 0);
    const abstainWeight = votes.filter(v => v.choice === 'abstain').reduce((sum, v) => sum + v.weight, 0);
    
    const totalWeight = yesWeight + noWeight + abstainWeight;
    
    // TODO: 실제 토큰 총량을 가져와서 참여율 계산
    const participationRate = 0.5; // 임시값
    
    const passed = 
      participationRate >= (proposal.minParticipationRate || 0.1) &&
      yesWeight / totalWeight >= (proposal.passingThreshold || 0.5);
    
    const result: ProposalResult = {
      proposalId,
      totalVotes: votes.length,
      yesVotes,
      noVotes,
      abstainVotes,
      totalWeight,
      yesWeight,
      noWeight,
      abstainWeight,
      passed,
      participationRate,
      calculatedAt: Date.now(),
    };
    
    // Proposal 상태 업데이트
    const oldStatus = proposal.status;
    proposal.status = passed ? ProposalStatus.PASSED : ProposalStatus.REJECTED;
    proposal.updatedAt = Date.now();
    
    // 이벤트 발행
    await eventPublisher.publish({
      type: EventType.PROPOSAL_RESULT_CALCULATED,
      id: `event-${Date.now()}-${Math.random()}`,
      timestamp: Date.now(),
      source: 'human-governance',
      data: {
        proposalId,
        passed,
        totalVotes: votes.length,
        yesVotes,
        noVotes,
      },
    });
    
    await eventPublisher.publish({
      type: EventType.PROPOSAL_STATUS_CHANGED,
      id: `event-${Date.now()}-${Math.random()}`,
      timestamp: Date.now(),
      source: 'human-governance',
      data: {
        proposalId,
        oldStatus,
        newStatus: proposal.status,
      },
    });
    
    return result;
  }
  
  /**
   * Proposal을 가져옵니다.
   */
  getProposal(proposalId: string): Proposal | undefined {
    return this.proposals.get(proposalId);
  }
  
  /**
   * 모든 Proposal을 가져옵니다.
   */
  getAllProposals(): Proposal[] {
    return Array.from(this.proposals.values());
  }
  
  /**
   * Proposal의 투표를 가져옵니다.
   */
  getVotes(proposalId: string): Vote[] {
    return this.votes.get(proposalId) || [];
  }
  
  /**
   * Proposal 설명을 생성합니다.
   */
  private generateProposalDescription(decisionPacket: DecisionPacket): string {
    return `이 제안은 AI 에이전트들의 협의를 통해 생성되었습니다.

주요 추천: ${decisionPacket.recommendation}

상세 설명:
${decisionPacket.recommendationDetails}

위험 평가:
${decisionPacket.risks.map(r => `- ${r.title}: ${r.severity}`).join('\n')}

대안:
${decisionPacket.alternatives.map(a => `- ${a.title}`).join('\n')}

에이전트 신뢰도: ${(decisionPacket.overallConfidence * 100).toFixed(1)}%`;
  }
  
  /**
   * Proposal 타입을 추론합니다.
   */
  private inferProposalType(decisionPacket: DecisionPacket): ProposalType {
    // Decision Packet의 내용을 기반으로 타입 추론
    const recommendation = decisionPacket.recommendation.toLowerCase();

    if (recommendation.includes('budget') || recommendation.includes('treasury') || recommendation.includes('fund')) {
      return ProposalType.TREASURY;
    }
    if (recommendation.includes('code') || recommendation.includes('development') || recommendation.includes('technical')) {
      return ProposalType.TECHNICAL;
    }
    if (recommendation.includes('policy') || recommendation.includes('rule') || recommendation.includes('regulation')) {
      return ProposalType.POLICY;
    }

    return ProposalType.GOVERNANCE;
  }
  
  /**
   * Decision Packet에서 액션을 추출합니다.
   */
  private extractActions(decisionPacket: DecisionPacket): Array<{
    type: string;
    parameters: Record<string, unknown>;
  }> {
    const actions: Array<{ type: string; parameters: Record<string, unknown> }> = [];
    
    // 추천 사항을 기반으로 액션 생성
    actions.push({
      type: 'execute_recommendation',
      parameters: {
        recommendation: decisionPacket.recommendation,
        kpis: decisionPacket.kpis,
      },
    });
    
    return actions;
  }
}

/**
 * 싱글톤 인스턴스
 */
export const governanceService = new GovernanceService();









