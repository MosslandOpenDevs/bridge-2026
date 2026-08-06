/**
 * Base Collector
 * 
 * 모든 신호 수집기의 기본 클래스입니다.
 */

import type { Signal, SignalMetadata, SignalSource } from '@bridge-2026/shared';
import { v4 as uuidv4 } from 'uuid';

/**
 * 수집기 인터페이스
 */
export interface ICollector {
  /** 수집기 ID */
  readonly id: string;
  /** 수집기 이름 */
  readonly name: string;
  /** 신호 소스 */
  readonly source: SignalSource;
  
  /**
   * 신호를 수집합니다.
   */
  collect(): Promise<Signal[]>;
  
  /**
   * 수집기를 시작합니다.
   * @param intervalMs 수집 간격 (밀리초). 생략하면 구현이 정한 기본값을 쓴다.
   *
   * 인자를 받는 것은 RealityOracle.startCollectors(intervalMs)가 간격을
   * 수집기마다 그대로 넘겨주기 때문이다. 여기서 0-인자로 선언하면 인터페이스
   * 타입으로 다루는 호출부는 간격을 전달할 방법이 없다.
   */
  start(intervalMs?: number): Promise<void>;
  
  /**
   * 수집기를 중지합니다.
   */
  stop(): Promise<void>;
  
  /**
   * 수집기가 실행 중인지 확인합니다.
   */
  isRunning(): boolean;
}

/**
 * 기본 수집기 구현
 */
export abstract class BaseCollector implements ICollector {
  readonly id: string;
  readonly name: string;
  readonly source: SignalSource;
  
  private running: boolean = false;
  private intervalId?: NodeJS.Timeout;
  
  constructor(name: string, source: SignalSource) {
    this.id = uuidv4();
    this.name = name;
    this.source = source;
  }
  
  /**
   * 신호를 수집합니다. (구현 필요)
   */
  abstract collect(): Promise<Signal[]>;
  
  /**
   * 신호를 생성합니다.
   */
  protected createSignal(
    data: Record<string, unknown>,
    metadata: Partial<SignalMetadata>
  ): Signal {
    const now = Date.now();
    
    return {
      id: uuidv4(),
      metadata: {
        timestamp: now,
        source: this.source,
        type: metadata.type || 'event' as any,
        collectorId: this.id,
        confidence: metadata.confidence || 1.0,
        tags: metadata.tags,
        rawDataRef: metadata.rawDataRef,
      },
      data,
      attestation: {
        signature: '', // 실제 구현에서는 암호화 서명 생성
        signer: this.id,
        signedAt: now,
      },
      createdAt: now,
      updatedAt: now,
    };
  }
  
  /**
   * 수집기를 시작합니다.
   * @param intervalMs 수집 간격 (밀리초)
   */
  async start(intervalMs: number = 60000): Promise<void> {
    if (this.running) {
      throw new Error(`Collector ${this.name} is already running`);
    }
    
    this.running = true;
    
    // 즉시 한 번 수집
    await this.collect();
    
    // 주기적으로 수집
    this.intervalId = setInterval(async () => {
      try {
        await this.collect();
      } catch (error) {
        console.error(`Error collecting signals in ${this.name}:`, error);
      }
    }, intervalMs);
  }
  
  /**
   * 수집기를 중지합니다.
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }
    
    this.running = false;
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }
  
  /**
   * 수집기가 실행 중인지 확인합니다.
   */
  isRunning(): boolean {
    return this.running;
  }
}









