/**
 * Signature Service
 * 
 * 신호에 대한 암호화 서명을 생성하고 검증합니다.
 */

import type { Signal, Attestation } from '@bridge-2026/shared';
import crypto from 'crypto';

/**
 * 서명 서비스 인터페이스
 */
export interface ISignatureService {
  /**
   * 신호에 서명을 생성합니다.
   */
  sign(signal: Signal, privateKey: string): Attestation;
  
  /**
   * 서명을 검증합니다.
   */
  verify(signal: Signal, publicKey: string): boolean;
  
  /**
   * 해시를 생성합니다.
   */
  hash(data: string): string;
}

/**
 * 서명 서비스 구현
 */
export class SignatureService implements ISignatureService {
  private algorithm: string = 'sha256';
  private signatureAlgorithm: string = 'RSA-SHA256';
  
  /**
   * 신호에 서명을 생성합니다.
   */
  sign(signal: Signal, privateKey: string): Attestation {
    const dataToSign = this.createSignableData(signal);
    const sign = crypto.createSign(this.signatureAlgorithm);
    sign.update(dataToSign);
    sign.end();
    
    const signature = sign.sign(privateKey, 'base64');
    
    return {
      signature,
      signer: signal.metadata.collectorId,
      signedAt: Date.now(),
    };
  }
  
  /**
   * 서명을 검증합니다.
   */
  verify(signal: Signal, publicKey: string): boolean {
    try {
      const dataToSign = this.createSignableData(signal);
      const verify = crypto.createVerify(this.signatureAlgorithm);
      verify.update(dataToSign);
      verify.end();
      
      return verify.verify(publicKey, signal.attestation.signature, 'base64');
    } catch (error) {
      console.error('Signature verification error:', error);
      return false;
    }
  }
  
  /**
   * 해시를 생성합니다.
   */
  hash(data: string): string {
    return crypto.createHash(this.algorithm).update(data).digest('hex');
  }
  
  /**
   * 서명 가능한 데이터를 생성합니다.
   */
  private createSignableData(signal: Signal): string {
    return JSON.stringify({
      id: signal.id,
      metadata: signal.metadata,
      data: signal.data,
      createdAt: signal.createdAt,
    });
  }
}

/**
 * 싱글톤 서명 서비스 인스턴스
 */
export const signatureService = new SignatureService();









