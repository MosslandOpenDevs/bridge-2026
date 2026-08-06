/**
 * Policy Engine
 * 
 * 위임 정책을 평가하고 적용하는 엔진입니다.
 */

import type { Proposal } from '@bridge-2026/shared';
import {
  DelegationManager,
  delegationManager,
  type DelegationPolicyInternal,
} from './delegation-manager';

/**
 * 정책 엔진
 */
export class PolicyEngine {
  constructor(private delegationManager: DelegationManager) {}
  
  /**
   * 제안에 대해 위임 투표를 수행할 수 있는 정책들을 찾습니다.
   */
  findApplicablePolicies(proposal: Proposal): DelegationPolicyInternal[] {
    const allPolicies = Array.from(this.delegationManager['policies'].values());
    const applicable: DelegationPolicyInternal[] = [];
    
    for (const policy of allPolicies) {
      const canVote = this.delegationManager.canDelegateVote(policy.id, proposal);
      if (canVote.allowed) {
        applicable.push(policy);
      }
    }
    
    return applicable;
  }
  
  /**
   * 정책에 따라 위임 투표를 생성합니다.
   */
  generateDelegatedVote(
    policy: DelegationPolicyInternal,
    proposal: Proposal,
    agentRecommendation: 'yes' | 'no' | 'abstain'
  ): {
    choice: 'yes' | 'no' | 'abstain';
    weight: number; // TODO: 실제 토큰 잔액에서 가져오기
    canVeto: boolean;
    vetoDeadline?: number;
  } {
    const choice = agentRecommendation;
    const weight = 1000; // TODO: 실제 토큰 잔액 조회
    
    const canVeto = policy.veto_enabled;
    const vetoDeadline = canVeto 
      ? Date.now() + (24 * 60 * 60 * 1000) // 24시간
      : undefined;
    
    return {
      choice,
      weight,
      canVeto,
      vetoDeadline,
    };
  }
  
  /**
   * 정책을 검증합니다.
   */
  validatePolicy(policy: Partial<DelegationPolicyInternal>): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];
    
    if (!policy.wallet) {
      errors.push('Wallet address is required');
    }
    
    if (!policy.agent_id) {
      errors.push('Agent ID is required');
    }
    
    if (policy.max_budget_per_proposal !== undefined && policy.max_budget_per_proposal < 0) {
      errors.push('Max budget per proposal must be non-negative');
    }
    
    if (policy.max_budget_per_month !== undefined && policy.max_budget_per_month < 0) {
      errors.push('Max budget per month must be non-negative');
    }
    
    if (policy.cooldown_window_hours !== undefined && policy.cooldown_window_hours < 0) {
      errors.push('Cooldown window must be non-negative');
    }
    
    if (policy.max_votes_per_day !== undefined && policy.max_votes_per_day < 1) {
      errors.push('Max votes per day must be at least 1');
    }
    
    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

/**
 * 싱글톤 인스턴스
 */
export const policyEngine = new PolicyEngine(delegationManager);









