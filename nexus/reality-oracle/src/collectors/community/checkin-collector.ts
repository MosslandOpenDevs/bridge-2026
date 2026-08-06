/**
 * Check-in Collector
 * 
 * 커뮤니티 체크인 (Proof-of-Presence)을 수집하는 수집기입니다.
 */

import { BaseCollector } from '../base-collector';
import type { Signal, SignalSource } from '@bridge-2026/shared';
import { v4 as uuidv4 } from 'uuid';

/**
 * 체크인 데이터
 */
export interface CheckInData {
  /** 사용자 지갑 주소 */
  walletAddress: string;
  /** 체크인 타입 (qr, nfc, location) */
  checkInType: 'qr' | 'nfc' | 'location';
  /** 위치 정보 */
  location: {
    name: string;
    latitude?: number;
    longitude?: number;
    address?: string;
  };
  /** 이벤트/매장 ID */
  eventId?: string;
  /** 타임스탬프 */
  timestamp: number;
  /** 서명 (검증용) */
  signature?: string;
}

/**
 * 체크인 수집기 설정
 */
export interface CheckInCollectorConfig {
  /** 체크인 데이터 소스 (API 엔드포인트 등) */
  dataSource?: string;
  /** 수집 간격 (밀리초) */
  interval?: number;
}

/**
 * 체크인 수집기
 */
export class CheckInCollector extends BaseCollector {
  private config: CheckInCollectorConfig;
  private checkInBuffer: CheckInData[] = [];
  
  constructor(config: CheckInCollectorConfig = {}) {
    super('Check-in Collector', 'community' as SignalSource);
    this.config = config;
  }
  
  /**
   * 체크인 데이터를 추가합니다 (API에서 호출).
   */
  addCheckIn(checkIn: CheckInData): void {
    this.checkInBuffer.push(checkIn);
  }
  
  /**
   * 신호를 수집합니다.
   */
  async collect(): Promise<Signal[]> {
    const signals: Signal[] = [];
    const checkIns = [...this.checkInBuffer];
    this.checkInBuffer = []; // 버퍼 비우기
    
    for (const checkIn of checkIns) {
      const signal = this.createSignal(
        {
          checkInType: checkIn.checkInType,
          walletAddress: checkIn.walletAddress,
          location: checkIn.location,
          eventId: checkIn.eventId,
          timestamp: checkIn.timestamp,
        },
        {
          type: 'participation' as any,
          confidence: this.calculateConfidence(checkIn),
          tags: ['checkin', 'proof-of-presence', checkIn.checkInType],
          rawDataRef: checkIn.signature,
        }
      );
      
      signals.push(signal);
    }
    
    return signals;
  }
  
  /**
   * 체크인 신뢰도를 계산합니다.
   */
  private calculateConfidence(checkIn: CheckInData): number {
    let confidence = 0.5; // 기본 신뢰도
    
    // 서명이 있으면 신뢰도 증가
    if (checkIn.signature) {
      confidence += 0.3;
    }
    
    // 위치 정보가 있으면 신뢰도 증가
    if (checkIn.location.latitude && checkIn.location.longitude) {
      confidence += 0.2;
    }
    
    return Math.min(1.0, confidence);
  }
  
  /**
   * 체크인 통계를 분석합니다.
   */
  analyzeCheckIns(signals: Signal[]): {
    totalCheckIns: number;
    uniqueUsers: number;
    locations: Map<string, number>;
    checkInTypes: Map<string, number>;
    timeDistribution: Map<string, number>;
  } {
    const uniqueUsers = new Set<string>();
    const locations = new Map<string, number>();
    const checkInTypes = new Map<string, number>();
    const timeDistribution = new Map<string, number>();
    
    for (const signal of signals) {
      const walletAddress = signal.data.walletAddress as string;
      uniqueUsers.add(walletAddress);
      
      const location = signal.data.location as { name: string };
      locations.set(location.name, (locations.get(location.name) || 0) + 1);
      
      const checkInType = signal.data.checkInType as string;
      checkInTypes.set(checkInType, (checkInTypes.get(checkInType) || 0) + 1);
      
      // 시간대별 분포 (시간만 추출)
      const timestamp = signal.metadata.timestamp;
      const date = new Date(timestamp);
      const hour = `${date.getHours()}:00`;
      timeDistribution.set(hour, (timeDistribution.get(hour) || 0) + 1);
    }
    
    return {
      totalCheckIns: signals.length,
      uniqueUsers: uniqueUsers.size,
      locations,
      checkInTypes,
      timeDistribution,
    };
  }
}









