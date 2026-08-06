/**
 * Atomic Actuation
 * 
 * 거버넌스 통과 시 온체인/오프체인 실행을 원자적으로 트리거하는 서비스입니다.
 */

import type { Proposal, ProposalAction } from '@bridge-2026/shared';
import { eventPublisher, EventType } from '@bridge-2026/event-bus';

/**
 * 실행 결과
 */
export interface ExecutionResult {
  /** 실행 ID */
  id: string;
  /** 제안 ID */
  proposalId: string;
  /** 실행 상태 */
  status: 'pending' | 'in_progress' | 'success' | 'partial_success' | 'failure';
  /** 실행된 액션들 */
  executedActions: Array<{
    action: ProposalAction;
    result: 'success' | 'failure';
    error?: string;
    txHash?: string;
  }>;
  /** 실행 시작 시간 */
  startedAt: number;
  /** 실행 완료 시간 */
  completedAt?: number;
  /** 롤백 가능 여부 */
  canRollback: boolean;
}

/**
 * Atomic Actuation 서비스
 */
export class AtomicActuation {
  private executions: Map<string, ExecutionResult> = new Map();
  
  /**
   * 제안이 통과되면 실행을 시작합니다.
   */
  async executeProposal(proposal: Proposal): Promise<ExecutionResult> {
    const executionId = `exec-${proposal.id}-${Date.now()}`;
    const startedAt = Date.now();
    
    const execution: ExecutionResult = {
      id: executionId,
      proposalId: proposal.id,
      status: 'in_progress',
      executedActions: [],
      startedAt,
      canRollback: true,
    };
    
    this.executions.set(executionId, execution);
    
    try {
      // 각 액션을 원자적으로 실행
      for (const action of proposal.actions) {
        const actionResult = await this.executeAction(action, proposal);
        execution.executedActions.push(actionResult);
        
        // 실패 시 롤백 가능 여부 확인
        if (actionResult.result === 'failure' && !execution.canRollback) {
          execution.status = 'failure';
          break;
        }
      }
      
      // 실행 상태 결정
      const successCount = execution.executedActions.filter(a => a.result === 'success').length;
      if (successCount === execution.executedActions.length) {
        execution.status = 'success';
      } else if (successCount > 0) {
        execution.status = 'partial_success';
      } else {
        execution.status = 'failure';
      }
      
      execution.completedAt = Date.now();
      
    } catch (error) {
      execution.status = 'failure';
      execution.completedAt = Date.now();
      throw error;
    }
    
    return execution;
  }
  
  /**
   * 개별 액션을 실행합니다.
   */
  private async executeAction(
    action: ProposalAction,
    proposal: Proposal
  ): Promise<ExecutionResult['executedActions'][0]> {
    try {
      switch (action.type) {
        case 'onchain_treasury_transfer':
          return await this.executeOnChainTreasuryTransfer(action, proposal);
        
        case 'onchain_parameter_change':
          return await this.executeOnChainParameterChange(action, proposal);
        
        case 'github_issue_create':
          return await this.executeGitHubIssueCreate(action, proposal);
        
        case 'campaign_deploy':
          return await this.executeCampaignDeploy(action, proposal);
        
        case 'announcement_create':
          return await this.executeAnnouncementCreate(action, proposal);
        
        default:
          return {
            action,
            result: 'failure',
            error: `Unknown action type: ${action.type}`,
          };
      }
    } catch (error) {
      return {
        action,
        result: 'failure',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  
  /**
   * 온체인 트레저리 전송 실행
   */
  private async executeOnChainTreasuryTransfer(
    action: ProposalAction,
    proposal: Proposal
  ): Promise<ExecutionResult['executedActions'][0]> {
    // TODO: 실제 스마트 컨트랙트 호출
    // 예시:
    // const txHash = await treasuryContract.transfer(
    //   action.parameters.to,
    //   action.parameters.amount,
    //   { from: multisigAddress }
    // );
    
    const txHash = `0x${Math.random().toString(16).substring(2, 66)}`; // 임시
    
    return {
      action,
      result: 'success',
      txHash,
    };
  }
  
  /**
   * 온체인 파라미터 변경 실행
   */
  private async executeOnChainParameterChange(
    action: ProposalAction,
    proposal: Proposal
  ): Promise<ExecutionResult['executedActions'][0]> {
    // TODO: 실제 스마트 컨트랙트 호출
    
    const txHash = `0x${Math.random().toString(16).substring(2, 66)}`; // 임시
    
    return {
      action,
      result: 'success',
      txHash,
    };
  }
  
  /**
   * GitHub 이슈 생성 실행
   */
  private async executeGitHubIssueCreate(
    action: ProposalAction,
    proposal: Proposal
  ): Promise<ExecutionResult['executedActions'][0]> {
    // TODO: 실제 GitHub API 호출
    // 예시:
    // const issue = await octokit.rest.issues.create({
    //   owner: action.parameters.owner,
    //   repo: action.parameters.repo,
    //   title: action.parameters.title,
    //   body: action.parameters.body,
    // });
    
    return {
      action,
      result: 'success',
    };
  }
  
  /**
   * 캠페인 배포 실행
   */
  private async executeCampaignDeploy(
    action: ProposalAction,
    proposal: Proposal
  ): Promise<ExecutionResult['executedActions'][0]> {
    // TODO: 실제 캠페인 시스템 API 호출
    
    return {
      action,
      result: 'success',
    };
  }
  
  /**
   * 공지 생성 실행
   */
  private async executeAnnouncementCreate(
    action: ProposalAction,
    proposal: Proposal
  ): Promise<ExecutionResult['executedActions'][0]> {
    // TODO: 실제 공지 시스템 API 호출
    
    return {
      action,
      result: 'success',
    };
  }
  
  /**
   * 실행 결과를 가져옵니다.
   */
  getExecution(executionId: string): ExecutionResult | undefined {
    return this.executions.get(executionId);
  }
  
  /**
   * 제안의 실행 결과를 가져옵니다.
   */
  getExecutionByProposal(proposalId: string): ExecutionResult | undefined {
    return Array.from(this.executions.values()).find(e => e.proposalId === proposalId);
  }
  
  /**
   * 롤백을 수행합니다.
   */
  async rollback(executionId: string): Promise<void> {
    const execution = this.executions.get(executionId);
    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }
    
    if (!execution.canRollback) {
      throw new Error(`Execution ${executionId} cannot be rolled back`);
    }
    
    // TODO: 롤백 로직 구현
    // 각 액션의 역작업 수행
    
    execution.status = 'failure';
    execution.completedAt = Date.now();
  }
}

/**
 * 싱글톤 인스턴스
 */
export const atomicActuation = new AtomicActuation();









