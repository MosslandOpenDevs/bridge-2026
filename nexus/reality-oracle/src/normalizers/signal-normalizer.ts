/**
 * Signal Normalizer
 * 
 * 다양한 형식의 신호를 표준 형식으로 정규화합니다.
 */

import type { Signal, NormalizedSignal } from '@bridge-2026/shared';

/**
 * 정규화 규칙 인터페이스
 */
export interface NormalizationRule {
  /** 규칙 이름 */
  name: string;
  /** 적용할 신호 소스 */
  source: string;
  /** 정규화 함수 */
  normalize: (signal: Signal) => NormalizedSignal;
}

/**
 * 신호 정규화기
 */
export class SignalNormalizer {
  private rules: Map<string, NormalizationRule> = new Map();
  private version: string = '1.0.0';
  
  /**
   * 정규화 규칙을 등록합니다.
   */
  registerRule(rule: NormalizationRule): void {
    this.rules.set(rule.source, rule);
  }
  
  /**
   * 신호를 정규화합니다.
   */
  normalize(signal: Signal): NormalizedSignal {
    const rule = this.rules.get(signal.metadata.source);
    
    if (rule) {
      return rule.normalize(signal);
    }
    
    // 기본 정규화
    return this.defaultNormalize(signal);
  }
  
  /**
   * 여러 신호를 정규화합니다.
   */
  normalizeBatch(signals: Signal[]): NormalizedSignal[] {
    return signals.map(signal => this.normalize(signal));
  }
  
  /**
   * 기본 정규화 함수
   */
  private defaultNormalize(signal: Signal): NormalizedSignal {
    return {
      ...signal,
      version: this.version,
      schemaRef: `schema://signal/${this.version}`,
    };
  }
}

/**
 * 싱글톤 정규화기 인스턴스
 */
export const signalNormalizer = new SignalNormalizer();









