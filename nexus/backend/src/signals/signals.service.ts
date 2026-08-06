import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Signal } from '@bridge-2026/shared';
import { SignalEntity } from '../entities/signal.entity';
import {
  realityOracle,
  OnChainCollector,
  CheckInCollector,
} from '@bridge-2026/reality-oracle';

@Injectable()
export class SignalsService {
  constructor(
    @InjectRepository(SignalEntity)
    private signalRepository: Repository<SignalEntity>,
  ) {}

  async getSignals(options: {
    sourceType?: string;
    limit: number;
    offset: number;
  }): Promise<{ signals: Signal[]; total: number }> {
    const queryBuilder = this.signalRepository.createQueryBuilder('signal');

    if (options.sourceType) {
      // The source lives inside the metadata document, and the schema carries a
      // matching expression index on (metadata->>'source') so this stays a
      // lookup rather than a scan.
      queryBuilder.where("signal.metadata->>'source' = :sourceType", {
        sourceType: options.sourceType,
      });
    }

    const total = await queryBuilder.getCount();

    const entities = await queryBuilder
      .orderBy('signal.createdAt', 'DESC')
      .skip(options.offset)
      .take(options.limit)
      .getMany();

    const signals = entities.map(e => e.toSignal());

    return { signals, total };
  }

  async collectSignals(): Promise<{ collected: number }> {
    const collectors = realityOracle.getCollectors();
    if (collectors.length === 0) {
      realityOracle.registerCollector(
        new OnChainCollector({
          rpcUrl:
            process.env.RPC_URL ||
            'https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY',
        }),
      );
      realityOracle.registerCollector(new CheckInCollector());
    }

    // Collect and process one collector at a time. Reality Oracle appends every
    // processed signal to a hash chain, so the persisted order has to be the
    // order the chain was built in.
    const processed: Signal[] = [];
    for (const collector of realityOracle.getCollectors()) {
      const collected = await collector.collect();
      for (const signal of collected) {
        // processSignal normalizes, attests and hash-chains; storing the raw
        // signal instead would persist an empty attestation.
        processed.push(await realityOracle.processSignal(signal));
      }
    }

    const entities = processed.map(signal => {
      const entity = new SignalEntity();
      // Keep the collector's id: the attestation and the hash-chain node both
      // reference it, so a database-generated id would orphan the proof.
      entity.id = signal.id;
      entity.metadata = signal.metadata;
      entity.data = signal.data;
      entity.attestation = signal.attestation;
      entity.auditLogRef = signal.auditLogRef ?? null;
      return entity;
    });

    await this.signalRepository.save(entities);

    return { collected: entities.length };
  }
}
