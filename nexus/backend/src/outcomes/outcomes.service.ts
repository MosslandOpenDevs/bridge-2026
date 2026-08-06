import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { proofOfOutcome } from '@bridge-2026/proof-of-outcome';
import type { Outcome } from '@bridge-2026/shared';
import { OutcomeEntity } from '../entities/outcome.entity';

@Injectable()
export class OutcomesService {
  constructor(
    @InjectRepository(OutcomeEntity)
    private outcomeRepository: Repository<OutcomeEntity>,
  ) {}

  async getOutcomes(options: {
    status?: string;
    limit: number;
    offset: number;
  }): Promise<{ outcomes: Outcome[]; total: number }> {
    const queryBuilder = this.outcomeRepository.createQueryBuilder('outcome');

    if (options.status) {
      queryBuilder.where('outcome.status = :status', { status: options.status });
    }

    const total = await queryBuilder.getCount();

    const entities = await queryBuilder
      .orderBy('outcome.executionStartTime', 'DESC')
      .skip(options.offset)
      .take(options.limit)
      .getMany();

    const outcomes = entities.map(e => e.toOutcome());

    return { outcomes, total };
  }

  async getOutcome(id: string): Promise<Outcome | null> {
    const entity = await this.outcomeRepository.findOne({
      where: { id },
    });

    if (entity) {
      return entity.toOutcome();
    }

    // Proof of Outcome holds outcomes in process until they are written back,
    // so an evaluation still in flight is only findable there.
    return proofOfOutcome.getOutcome(id) || null;
  }
}

