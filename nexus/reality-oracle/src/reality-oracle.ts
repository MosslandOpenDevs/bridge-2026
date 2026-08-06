/**
 * Reality Oracle
 * 
 * Reality Oracle는 실세계 신호를 수집, 정규화, 증명하는 메인 서비스입니다.
 */

import type { Signal, NormalizedSignal } from '@bridge-2026/shared';
import { ICollector } from './collectors/base-collector';
import { signalNormalizer } from './normalizers/signal-normalizer';
import { signatureService } from './attestation/signature-service';
import { hashChain } from './attestation/hash-chain';
import { eventPublisher, EventType } from '@bridge-2026/event-bus';

/**
 * Reality Oracle 서비스
 */
export class RealityOracle {
  private collectors: Map<string, ICollector> = new Map();
  private privateKey?: string;
  private publicKey?: string;
  
  /**
   * 수집기를 등록합니다.
   */
  registerCollector(collector: ICollector): void {
    this.collectors.set(collector.id, collector);
  }
  
  /**
   * 수집기를 제거합니다.
   */
  unregisterCollector(collectorId: string): void {
    this.collectors.delete(collectorId);
  }
  
  /**
   * 등록된 수집기 목록을 가져옵니다.
   */
  getCollectors(): ICollector[] {
    return Array.from(this.collectors.values());
  }
  
  /**
   * 모든 수집기를 시작합니다.
   */
  async startCollectors(intervalMs: number = 60000): Promise<void> {
    const promises = Array.from(this.collectors.values()).map(collector =>
      collector.start(intervalMs)
    );
    await Promise.all(promises);
  }
  
  /**
   * 모든 수집기를 중지합니다.
   */
  async stopCollectors(): Promise<void> {
    const promises = Array.from(this.collectors.values()).map(collector =>
      collector.stop()
    );
    await Promise.all(promises);
  }
  
  /**
   * 신호를 처리합니다 (수집 → 정규화 → 증명).
   */
  async processSignal(signal: Signal): Promise<NormalizedSignal> {
    // 1. 정규화
    const normalized = signalNormalizer.normalize(signal);
    
    // 2. 서명 생성
    if (this.privateKey) {
      normalized.attestation = signatureService.sign(normalized, this.privateKey);
    }
    
    // 3. 해시 체인에 추가
    const hashNode = hashChain.addSignal(normalized);
    normalized.attestation.hashChainRef = hashNode.hash;
    
    // 4. 이벤트 발행
    await eventPublisher.publish({
      type: EventType.SIGNAL_COLLECTED,
      id: `event-${Date.now()}-${Math.random()}`,
      timestamp: Date.now(),
      source: 'reality-oracle',
      data: normalized,
    });
    
    await eventPublisher.publish({
      type: EventType.SIGNAL_NORMALIZED,
      id: `event-${Date.now()}-${Math.random()}`,
      timestamp: Date.now(),
      source: 'reality-oracle',
      data: normalized,
    });
    
    await eventPublisher.publish({
      type: EventType.SIGNAL_ATTESTED,
      id: `event-${Date.now()}-${Math.random()}`,
      timestamp: Date.now(),
      source: 'reality-oracle',
      data: normalized,
    });
    
    return normalized;
  }
  
  /**
   * 키 쌍을 설정합니다.
   */
  setKeys(privateKey: string, publicKey: string): void {
    this.privateKey = privateKey;
    this.publicKey = publicKey;
  }
  
  /**
   * 서명을 검증합니다.
   */
  verifySignature(signal: Signal): boolean {
    if (!this.publicKey) {
      return false;
    }
    return signatureService.verify(signal, this.publicKey);
  }
  
  /**
   * 해시 체인 무결성을 검증합니다.
   */
  verifyHashChain(): boolean {
    return hashChain.verify();
  }
}

/**
 * 싱글톤 Reality Oracle 인스턴스
 */
export const realityOracle = new RealityOracle();

