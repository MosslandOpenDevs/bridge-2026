/**
 * Delegation Manager
 * 
 * 정책 기반 위임을 관리하는 서비스입니다.
 */

import type { DelegationPolicy } from '@bridge-2026/shared';
import { v4 as uuidv4 } from 'uuid';

/**
 * 위임 정책 인터페이스
 *
 * 정책 필드는 공유 계약(DelegationPolicy)에서 상속받고, 저장소가 부여하는
 * 식별자와 타임스탬프만 여기에 더합니다. 필드를 복제해 두면 공유 계약이
 * 바뀔 때 조용히 어긋나므로 상속으로 묶어 둡니다.
 */
export interface DelegationPolicyInternal extends DelegationPolicy {
  id: string;
  created_at: number;
  updated_at: number;
}

/**
 * 위임 투표 기록
 */
export interface DelegatedVote {
  policyId: string;
  proposalId: string;
  agentId: string;
  choice: 'yes' | 'no' | 'abstain';
  weight: number;
  votedAt: number;
  canVeto: boolean;
  vetoDeadline?: number;
}

/**
 * 위임 관리자
 */
export class DelegationManager {
  private policies: Map<string, DelegationPolicyInternal> = new Map();
  private delegatedVotes: Map<string, DelegatedVote[]> = new Map(); // policyId -> votes
  private dailyVoteCounts: Map<string, Map<string, number>> = new Map(); // policyId -> date -> count
  
  /**
   * 위임 정책을 생성합니다.
   */
  createPolicy(policy: Omit<DelegationPolicyInternal, 'id' | 'created_at' | 'updated_at'>): DelegationPolicyInternal {
    const now = Date.now();
    const fullPolicy: DelegationPolicyInternal = {
      ...policy,
      id: uuidv4(),
      created_at: now,
      updated_at: now,
    };
    
    this.policies.set(fullPolicy.id, fullPolicy);
    return fullPolicy;
  }
  
  /**
   * 위임 정책을 업데이트합니다.
   */
  updatePolicy(policyId: string, updates: Partial<DelegationPolicyInternal>): DelegationPolicyInternal {
    const policy = this.policies.get(policyId);
    if (!policy) {
      throw new Error(`Policy ${policyId} not found`);
    }
    
    const updated = {
      ...policy,
      ...updates,
      id: policyId, // ID는 변경 불가
      updated_at: Date.now(),
    };
    
    this.policies.set(policyId, updated);
    return updated;
  }
  
  /**
   * 위임 정책을 삭제합니다.
   */
  deletePolicy(policyId: string): void {
    this.policies.delete(policyId);
    this.delegatedVotes.delete(policyId);
    this.dailyVoteCounts.delete(policyId);
  }
  
  /**
   * 위임 정책을 가져옵니다.
   */
  getPolicy(policyId: string): DelegationPolicyInternal | undefined {
    return this.policies.get(policyId);
  }
  
  /**
   * 지갑 주소로 위임 정책을 가져옵니다.
   */
  getPoliciesByWallet(wallet: string): DelegationPolicyInternal[] {
    return Array.from(this.policies.values()).filter(p => p.wallet === wallet);
  }
  
  /**
   * 제안에 대해 위임 투표가 가능한지 확인합니다.
   */
  canDelegateVote(
    policyId: string,
    proposal: {
      id: string;
      type: string;
      status: string;
      metadata?: Record<string, unknown>;
      actions?: Array<{ type: string; parameters: Record<string, unknown> }>;
    }
  ): { allowed: boolean; reason?: string } {
    const policy = this.policies.get(policyId);
    if (!policy) {
      return { allowed: false, reason: 'Policy not found' };
    }
    
    // 1. 긴급안건 제외
    if (policy.no_vote_on_emergency) {
      const isEmergency = proposal.metadata?.emergency === true || 
                         proposal.status === 'emergency';
      if (isEmergency) {
        return { allowed: false, reason: 'Emergency proposals are excluded' };
      }
    }
    
    // 2. 카테고리 제한
    if (policy.scope.categories && policy.scope.categories.length > 0) {
      if (!policy.scope.categories.includes(proposal.type)) {
        return { allowed: false, reason: `Category ${proposal.type} not in scope` };
      }
    }
    
    // 3. 제외 카테고리
    if (policy.scope.exclude_categories && policy.scope.exclude_categories.includes(proposal.type)) {
      return { allowed: false, reason: `Category ${proposal.type} is excluded` };
    }
    
    // 4. 예산 제한 (액션에서 예산 추출 필요)
    if (policy.max_budget_per_proposal) {
      const budget = this.extractBudget(proposal.actions || []);
      if (budget > policy.max_budget_per_proposal) {
        return { allowed: false, reason: `Budget ${budget} exceeds limit ${policy.max_budget_per_proposal}` };
      }
    }
    
    // 5. 일일 투표 제한
    if (policy.max_votes_per_day) {
      const today = new Date().toISOString().split('T')[0];
      const voteCount = this.getDailyVoteCount(policyId, today);
      if (voteCount >= policy.max_votes_per_day) {
        return { allowed: false, reason: `Daily vote limit ${policy.max_votes_per_day} reached` };
      }
    }
    
    // 6. 대기 시간 확인
    const lastVote = this.getLastVote(policyId);
    if (lastVote && policy.cooldown_window_hours > 0) {
      const hoursSinceLastVote = (Date.now() - lastVote.votedAt) / (1000 * 60 * 60);
      if (hoursSinceLastVote < policy.cooldown_window_hours) {
        return { 
          allowed: false, 
          reason: `Cooldown period: ${(policy.cooldown_window_hours - hoursSinceLastVote).toFixed(1)} hours remaining`
        };
      }
    }
    
    return { allowed: true };
  }
  
  /**
   * 위임 투표를 기록합니다.
   */
  recordDelegatedVote(vote: DelegatedVote): void {
    const votes = this.delegatedVotes.get(vote.policyId) || [];
    votes.push(vote);
    this.delegatedVotes.set(vote.policyId, votes);
    
    // 일일 투표 수 업데이트
    const today = new Date().toISOString().split('T')[0];
    const counts = this.dailyVoteCounts.get(vote.policyId) || new Map();
    counts.set(today, (counts.get(today) || 0) + 1);
    this.dailyVoteCounts.set(vote.policyId, counts);
  }
  
  /**
   * 위임 투표를 가져옵니다.
   */
  getDelegatedVotes(policyId: string): DelegatedVote[] {
    return this.delegatedVotes.get(policyId) || [];
  }
  
  /**
   * 예산을 추출합니다.
   */
  private extractBudget(actions: Array<{ type: string; parameters: Record<string, unknown> }>): number {
    // 액션에서 예산 정보 추출 (실제 구현 시 더 정교하게)
    for (const action of actions) {
      if (action.parameters.budget) {
        return Number(action.parameters.budget) || 0;
      }
      if (action.parameters.amount) {
        return Number(action.parameters.amount) || 0;
      }
    }
    return 0;
  }
  
  /**
   * 일일 투표 수를 가져옵니다.
   */
  private getDailyVoteCount(policyId: string, date: string): number {
    const counts = this.dailyVoteCounts.get(policyId);
    return counts?.get(date) || 0;
  }
  
  /**
   * 마지막 투표를 가져옵니다.
   */
  private getLastVote(policyId: string): DelegatedVote | undefined {
    const votes = this.delegatedVotes.get(policyId) || [];
    if (votes.length === 0) {
      return undefined;
    }
    return votes[votes.length - 1];
  }
}

/**
 * 싱글톤 인스턴스
 */
export const delegationManager = new DelegationManager();

