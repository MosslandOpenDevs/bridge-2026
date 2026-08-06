/**
 * Hash Chain
 *
 * 신호들의 무결성을 보장하기 위한 해시 체인을 관리합니다.
 */

import { signatureService } from './signature-service';
import type { Signal } from '@bridge-2026/shared';

/**
 * 해시 체인 노드
 */
export interface HashChainNode {
  /** 신호 ID */
  signalId: string;
  /** 현재 해시 */
  hash: string;
  /** 이전 해시 */
  previousHash: string;
  /** 타임스탬프 */
  timestamp: number;
  /**
   * 신호 페이로드(`signal.data`)의 해시.
   *
   * `hash`는 페이로드까지 포함해 계산되므로, 노드가 페이로드에 대한 무언가를
   * 남겨두지 않으면 `hash`를 다시 계산할 방법이 없다. 원본 신호를 verify()의
   * 인자로 받는 방법도 있지만 그러면 체인은 신호 저장소가 함께 있어야만
   * 검증되고, 무엇을 넘겨줄지 고르는 쪽이 검증 결과를 정하게 된다. 체인이
   * 혼자서 자신을 검증할 수 있도록 노드에 남기되, 신호 저장소를 통째로
   * 복제하지 않도록 페이로드 전체가 아니라 해시만 남긴다.
   */
  dataHash: string;
}

/** 해시 계산의 입력이 되는 노드 필드들 (해시 자신은 제외). */
type HashChainPayload = Omit<HashChainNode, 'hash'>;

/**
 * 해시 체인 관리자
 */
export class HashChain {
  private chain: HashChainNode[] = [];
  private genesisHash: string;

  constructor(genesisHash?: string) {
    this.genesisHash = genesisHash || this.generateGenesisHash();
  }

  /**
   * 저장된 노드들로 체인을 복원합니다.
   *
   * 복원 시점에는 노드를 신뢰하지 않고 그대로 싣기만 한다. 영속화를 거친
   * 체인이라도 verify() 하나만으로 판정될 수 있어야 하기 때문이다.
   */
  static restore(nodes: HashChainNode[], genesisHash: string): HashChain {
    const chain = new HashChain(genesisHash);
    chain.chain = nodes.map(node => ({ ...node }));
    return chain;
  }

  /**
   * 신호를 체인에 추가합니다.
   */
  addSignal(signal: Signal): HashChainNode {
    const previousHash = this.chain.length > 0
      ? this.chain[this.chain.length - 1].hash
      : this.genesisHash;

    const payload: HashChainPayload = {
      signalId: signal.id,
      previousHash,
      timestamp: signal.createdAt,
      dataHash: HashChain.hashSignalData(signal.data),
    };

    const node: HashChainNode = {
      ...payload,
      hash: signatureService.hash(HashChain.serialize(payload)),
    };

    this.chain.push(node);
    return node;
  }

  /**
   * 체인의 무결성을 검증합니다.
   *
   * 알려진 한계: 꼬리에서 노드를 잘라낸 체인은 그 자체로는 여전히 유효한
   * 접두사라 여기서 걸리지 않는다. 절단까지 잡으려면 마지막 노드의 해시를
   * 체인 밖에 따로 고정해 두고 대조해야 한다.
   */
  verify(): boolean {
    let expectedPreviousHash = this.genesisHash;

    for (const node of this.chain) {
      // 앞 노드와의 연결. 재정렬·삭제·삽입은 모두 여기서 끊어진다.
      if (node.previousHash !== expectedPreviousHash) {
        return false;
      }

      // 첫 노드도 예외 없이 재계산한다. 링크 검사는 앞 노드가 있어야 의미가
      // 있으므로, 첫 노드를 건너뛰면 노드가 하나뿐인 체인은 어떻게 변조해도
      // 통과한다. 체인이 하나짜리인 시점이야말로 검증이 필요한 시점이다.
      if (node.hash !== signatureService.hash(HashChain.serialize(node))) {
        return false;
      }

      expectedPreviousHash = node.hash;
    }

    return true;
  }

  /**
   * 신호가 체인에 기록될 때와 같은 페이로드인지 확인합니다.
   *
   * 노드는 페이로드 대신 그 해시만 들고 있으므로, 페이로드 자체의 변조는
   * 원본 신호를 가진 쪽에서만 대조할 수 있다. verify()는 체인 구조의
   * 무결성까지만 본다.
   */
  verifySignal(signal: Signal): boolean {
    const node = this.chain.find(n => n.signalId === signal.id);
    if (!node) {
      return false;
    }
    return node.dataHash === HashChain.hashSignalData(signal.data);
  }

  /**
   * 체인을 가져옵니다.
   *
   * 노드까지 복사해서 넘긴다. 얕은 복사면 호출자가 받아간 노드를 고치는
   * 순간 체인 내부가 함께 바뀌어, 무결성 구조가 스스로를 지키지 못한다.
   */
  getChain(): HashChainNode[] {
    return this.chain.map(node => ({ ...node }));
  }

  /**
   * 제네시스 해시를 가져옵니다.
   *
   * 첫 노드의 previousHash가 무엇이어야 하는지는 체인 안에 기록되어 있지
   * 않으므로, 체인을 저장했다가 restore()로 되살리려면 이 값도 함께
   * 보관해야 한다.
   */
  getGenesisHash(): string {
    return this.genesisHash;
  }

  /**
   * 특정 신호의 해시 체인 참조를 가져옵니다.
   */
  getHashForSignal(signalId: string): string | null {
    const node = this.chain.find(n => n.signalId === signalId);
    return node ? node.hash : null;
  }

  /**
   * 신호 페이로드의 해시를 계산합니다.
   *
   * 내용이 같은 페이로드는 키 순서가 달라도 같은 해시가 나와야 한다. 신호가
   * 저장·전송을 거치며 다시 조립되어도 노드와 대조할 수 있어야 하기 때문이다.
   */
  static hashSignalData(data: Record<string, unknown>): string {
    return signatureService.hash(canonicalize(data));
  }

  /**
   * 해시 대상 직렬화.
   *
   * 추가할 때와 검증할 때가 반드시 같은 바이트열을 만들어야 하므로, 두 경로가
   * 이 함수 하나만 거치게 한다. JSON.stringify는 키를 삽입 순서대로 쓰기
   * 때문에 필드를 여기서 고정된 순서의 리터럴로 다시 쌓는다. 그래야 넘어온
   * 객체가 어떤 순서로 만들어졌든, 또 HashChainNode에 필드가 추가되더라도
   * 해시 입력이 달라지지 않는다.
   */
  private static serialize(payload: HashChainPayload): string {
    return JSON.stringify({
      signalId: payload.signalId,
      previousHash: payload.previousHash,
      timestamp: payload.timestamp,
      dataHash: payload.dataHash,
    });
  }

  /**
   * 제네시스 해시를 생성합니다.
   */
  private generateGenesisHash(): string {
    return signatureService.hash(`genesis-${Date.now()}`);
  }
}

/**
 * 키를 정렬한 JSON 직렬화.
 *
 * JSON.stringify는 객체 키를 삽입 순서대로 쓰므로, 내용이 같아도 만들어진
 * 경로가 다르면 다른 문자열이 된다. 해시가 내용에만 의존하도록 중첩된 객체까지
 * 키를 정렬한다. 배열은 순서 자체가 내용이므로 그대로 둔다. 정렬은 로케일에
 * 따라 결과가 달라지지 않도록 localeCompare가 아니라 코드 단위로 비교한다.
 */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    // undefined는 JSON.stringify가 문자열 대신 undefined를 돌려준다.
    return JSON.stringify(value) ?? 'null';
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalize(entryValue)}`)
    .join(',')}}`;
}

/**
 * 싱글톤 해시 체인 인스턴스
 */
export const hashChain = new HashChain();
