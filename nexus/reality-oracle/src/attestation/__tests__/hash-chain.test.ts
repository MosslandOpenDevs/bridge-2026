import { HashChain, HashChainNode } from '../hash-chain';
// SignalSource/SignalType은 enum이라 런타임에도 필요하다. shared는 정의 파일을
// 가리키는 서브패스를 내보내지 않으므로(package.json "exports"는 "."과 "./utils"
// 뿐) 패키지 루트로 들여온다.
import { SignalSource, SignalType, type Signal } from '@bridge-2026/shared';

const GENESIS = 'genesis-hash-for-tests';

function makeSignal(id: string, data: Record<string, unknown>): Signal {
  return {
    id,
    metadata: {
      timestamp: 1_700_000_000_000,
      source: SignalSource.COMMUNITY,
      type: SignalType.PARTICIPATION,
      collectorId: 'test-collector',
      confidence: 1,
    },
    data,
    attestation: {
      signature: '',
      signer: 'test-collector',
      signedAt: 1_700_000_000_000,
    },
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  };
}

/** 검증 대상은 저장된 노드들이므로, 변조는 저장본을 고쳐서 재현한다. */
function restoreFrom(nodes: HashChainNode[]): HashChain {
  return HashChain.restore(nodes, GENESIS);
}

describe('HashChain', () => {
  describe('verify', () => {
    it('accepts a chain of two signals it built itself', () => {
      // 추가할 때와 검증할 때의 직렬화가 어긋나면 두 번째 노드부터 깨진다.
      const chain = new HashChain(GENESIS);
      chain.addSignal(makeSignal('signal-1', { value: 1 }));
      chain.addSignal(makeSignal('signal-2', { value: 2 }));

      expect(chain.getChain()).toHaveLength(2);
      expect(chain.verify()).toBe(true);
    });

    it('accepts a chain of one signal it built itself', () => {
      const chain = new HashChain(GENESIS);
      chain.addSignal(makeSignal('signal-1', { value: 1 }));

      expect(chain.verify()).toBe(true);
    });

    it('accepts an empty chain', () => {
      expect(new HashChain(GENESIS).verify()).toBe(true);
    });

    it('rejects a one-node chain whose payload hash was altered', () => {
      // 노드가 하나뿐인 체인은 링크로 검사할 앞 노드가 없다. 첫 노드의 해시를
      // 재계산하지 않으면 여기서 통과해 버린다.
      const source = new HashChain(GENESIS);
      source.addSignal(makeSignal('signal-1', { value: 1 }));

      const [node] = source.getChain();
      const tampered = restoreFrom([{ ...node, dataHash: 'other-payload' }]);

      expect(tampered.verify()).toBe(false);
    });

    it('rejects a one-node chain whose timestamp or signal id was altered', () => {
      const source = new HashChain(GENESIS);
      source.addSignal(makeSignal('signal-1', { value: 1 }));
      const [node] = source.getChain();

      expect(restoreFrom([{ ...node, timestamp: node.timestamp + 1 }]).verify()).toBe(false);
      expect(restoreFrom([{ ...node, signalId: 'signal-x' }]).verify()).toBe(false);
    });

    it('rejects a one-node chain that does not start from the genesis hash', () => {
      const source = new HashChain(GENESIS);
      source.addSignal(makeSignal('signal-1', { value: 1 }));
      const [node] = source.getChain();

      expect(restoreFrom([{ ...node, previousHash: 'not-the-genesis' }]).verify()).toBe(false);
    });

    it('rejects a chain whose middle node was altered', () => {
      const source = new HashChain(GENESIS);
      source.addSignal(makeSignal('signal-1', { value: 1 }));
      source.addSignal(makeSignal('signal-2', { value: 2 }));
      source.addSignal(makeSignal('signal-3', { value: 3 }));

      const nodes = source.getChain();
      nodes[1] = { ...nodes[1], dataHash: 'other-payload' };

      expect(restoreFrom(nodes).verify()).toBe(false);
    });

    it('rejects a reordered chain', () => {
      const source = new HashChain(GENESIS);
      source.addSignal(makeSignal('signal-1', { value: 1 }));
      source.addSignal(makeSignal('signal-2', { value: 2 }));
      source.addSignal(makeSignal('signal-3', { value: 3 }));

      const nodes = source.getChain();
      const reordered = [nodes[0], nodes[2], nodes[1]];

      expect(restoreFrom(reordered).verify()).toBe(false);
    });

    it('rejects a chain with a node removed from the middle', () => {
      const source = new HashChain(GENESIS);
      source.addSignal(makeSignal('signal-1', { value: 1 }));
      source.addSignal(makeSignal('signal-2', { value: 2 }));
      source.addSignal(makeSignal('signal-3', { value: 3 }));

      const nodes = source.getChain();

      expect(restoreFrom([nodes[0], nodes[2]]).verify()).toBe(false);
      expect(restoreFrom([nodes[1], nodes[2]]).verify()).toBe(false);
    });

    it('survives a persistence round trip', () => {
      const source = new HashChain(GENESIS);
      source.addSignal(makeSignal('signal-1', { value: 1 }));
      source.addSignal(makeSignal('signal-2', { value: 2 }));

      const stored: HashChainNode[] = JSON.parse(JSON.stringify(source.getChain()));

      expect(HashChain.restore(stored, source.getGenesisHash()).verify()).toBe(true);
    });
  });

  describe('getChain', () => {
    it('does not hand out references into the chain', () => {
      const chain = new HashChain(GENESIS);
      chain.addSignal(makeSignal('signal-1', { value: 1 }));

      chain.getChain()[0].hash = 'rewritten';

      expect(chain.verify()).toBe(true);
    });
  });

  describe('verifySignal', () => {
    it('accepts the signal that was recorded', () => {
      const chain = new HashChain(GENESIS);
      const signal = makeSignal('signal-1', { value: 1, unit: 'count' });
      chain.addSignal(signal);

      expect(chain.verifySignal(signal)).toBe(true);
    });

    it('ignores key order in the payload', () => {
      // 신호가 저장·전송을 거쳐 다시 조립되면 키 순서가 달라질 수 있다.
      const chain = new HashChain(GENESIS);
      chain.addSignal(makeSignal('signal-1', { value: 1, unit: 'count' }));

      expect(chain.verifySignal(makeSignal('signal-1', { unit: 'count', value: 1 }))).toBe(true);
    });

    it('rejects a signal whose payload changed', () => {
      const chain = new HashChain(GENESIS);
      chain.addSignal(makeSignal('signal-1', { value: 1 }));

      expect(chain.verifySignal(makeSignal('signal-1', { value: 2 }))).toBe(false);
    });

    it('rejects a signal that is not in the chain', () => {
      const chain = new HashChain(GENESIS);
      chain.addSignal(makeSignal('signal-1', { value: 1 }));

      expect(chain.verifySignal(makeSignal('signal-2', { value: 1 }))).toBe(false);
    });
  });
});
