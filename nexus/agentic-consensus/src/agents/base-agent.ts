/**
 * Base Agent
 * 
 * 모든 에이전트의 기본 클래스입니다.
 */

import type { AgentType, AgentReasoning, Issue } from '@bridge-2026/shared';

/**
 * 에이전트 인터페이스
 */
export interface IAgent {
  /** 에이전트 타입 */
  readonly type: AgentType;
  /** 에이전트 이름 */
  readonly name: string;
  
  /**
   * 이슈를 분석하고 추론을 생성합니다.
   * @param issue 분석할 이슈
   * @param context 추가 컨텍스트
   */
  analyze(issue: Issue, context?: Record<string, unknown>): Promise<AgentReasoning>;
  
  /**
   * 다른 에이전트의 추론에 대해 반응합니다.
   * @param issue 이슈
   * @param otherReasoning 다른 에이전트의 추론
   * @param myReasoning 자신의 추론
   */
  respond(
    issue: Issue,
    otherReasoning: AgentReasoning,
    myReasoning: AgentReasoning
  ): Promise<AgentReasoning>;
}

/**
 * 기본 에이전트 구현
 */
export abstract class BaseAgent implements IAgent {
  readonly type: AgentType;
  readonly name: string;
  
  protected confidence: number = 0.5;
  protected llmClient?: any; // LLM 클라이언트 (나중에 구현)
  
  constructor(type: AgentType, name: string) {
    this.type = type;
    this.name = name;
  }
  
  /**
   * 이슈를 분석합니다. (구현 필요)
   */
  abstract analyze(issue: Issue, context?: Record<string, unknown>): Promise<AgentReasoning>;
  
  /**
   * 다른 에이전트의 추론에 대해 반응합니다.
   */
  async respond(
    issue: Issue,
    otherReasoning: AgentReasoning,
    myReasoning: AgentReasoning
  ): Promise<AgentReasoning> {
    // 기본 구현: 자신의 추론을 약간 수정하여 반환
    return {
      ...myReasoning,
      analysis: `${myReasoning.analysis}\n\n다른 관점(${otherReasoning.agentType})을 고려했습니다.`,
      confidence: Math.max(0.1, myReasoning.confidence - 0.1),
    };
  }
  
  /**
   * LLM을 사용하여 분석을 수행합니다.
   */
  protected async analyzeWithLLM(
    prompt: string,
    context: Record<string, unknown> = {}
  ): Promise<string> {
    // TODO: 실제 LLM 통합
    // 현재는 플레이스홀더
    return `[LLM 분석 결과 - ${this.name}]\n${prompt}`;
  }
  
  /**
   * 추론을 생성합니다.
   */
  protected createReasoning(
    analysis: string,
    recommendation: string,
    confidence: number,
    considerations: string[],
    uncertainties?: string[]
  ): AgentReasoning {
    return {
      agentType: this.type,
      analysis,
      recommendation,
      confidence: Math.max(0, Math.min(1, confidence)),
      considerations,
      uncertainties,
    };
  }
}









