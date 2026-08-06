/**
 * Conversation Manager
 * 
 * 에이전트 간 대화를 관리합니다.
 */

import type { AgentReasoning, AgentType } from '@bridge-2026/shared';

export interface ConversationMessage {
  /** 발신자 에이전트 타입 */
  from: AgentType;
  /** 수신자 에이전트 타입 (null이면 전체) */
  to: AgentType | null;
  /** 메시지 내용 */
  content: string;
  /** 관련 추론 */
  reasoning?: AgentReasoning;
  /** 타임스탬프 */
  timestamp: number;
}

export interface Conversation {
  /** 대화 ID */
  id: string;
  /** 메시지들 */
  messages: ConversationMessage[];
  /** 시작 시간 */
  startedAt: number;
  /** 종료 시간 */
  endedAt?: number;
}

/**
 * 대화 관리자
 */
export class ConversationManager {
  private conversations: Map<string, Conversation> = new Map();
  
  /**
   * 새 대화를 시작합니다.
   */
  startConversation(issueId: string): Conversation {
    const conversation: Conversation = {
      id: `conv-${issueId}-${Date.now()}`,
      messages: [],
      startedAt: Date.now(),
    };
    
    this.conversations.set(conversation.id, conversation);
    return conversation;
  }
  
  /**
   * 메시지를 추가합니다.
   */
  addMessage(
    conversationId: string,
    message: Omit<ConversationMessage, 'timestamp'>
  ): void {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }
    
    conversation.messages.push({
      ...message,
      timestamp: Date.now(),
    });
  }
  
  /**
   * 대화를 종료합니다.
   */
  endConversation(conversationId: string): void {
    const conversation = this.conversations.get(conversationId);
    if (conversation) {
      conversation.endedAt = Date.now();
    }
  }
  
  /**
   * 대화를 가져옵니다.
   */
  getConversation(conversationId: string): Conversation | undefined {
    return this.conversations.get(conversationId);
  }
  
  /**
   * 대화 히스토리를 가져옵니다.
   */
  getConversationHistory(conversationId: string): ConversationMessage[] {
    const conversation = this.conversations.get(conversationId);
    return conversation ? conversation.messages : [];
  }
  
  /**
   * 모든 대화를 가져옵니다.
   */
  getAllConversations(): Conversation[] {
    return Array.from(this.conversations.values());
  }
}









