import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';
import type { ProposalResult } from '@bridge-2026/shared';

/**
 * Maps the `proposal_results` table in
 * infrastructure/database/schemas/proposals.sql.
 *
 * The tally is derived state: `votes` remains the record of who voted with what
 * weight, and this row is the last computed summary of it. It is keyed by
 * proposal id rather than a surrogate id so recomputing a tally overwrites the
 * previous one instead of accumulating stale copies.
 */
@Entity('proposal_results')
export class ProposalResultEntity {
  @PrimaryColumn({ name: 'proposal_id', type: 'uuid' })
  proposalId: string;

  @Column({ name: 'total_votes', type: 'integer', default: 0 })
  totalVotes: number;

  @Column({ name: 'yes_votes', type: 'integer', default: 0 })
  yesVotes: number;

  @Column({ name: 'no_votes', type: 'integer', default: 0 })
  noVotes: number;

  @Column({ name: 'abstain_votes', type: 'integer', default: 0 })
  abstainVotes: number;

  /** NUMERIC columns arrive from the pg driver as strings; see toResult(). */
  @Column({ name: 'total_weight', type: 'numeric', default: 0 })
  totalWeight: string | number;

  @Column({ name: 'yes_weight', type: 'numeric', default: 0 })
  yesWeight: string | number;

  @Column({ name: 'no_weight', type: 'numeric', default: 0 })
  noWeight: string | number;

  @Column({ name: 'abstain_weight', type: 'numeric', default: 0 })
  abstainWeight: string | number;

  @Column({ name: 'passed', type: 'boolean' })
  passed: boolean;

  @Column({ name: 'participation_rate', type: 'double precision' })
  participationRate: number;

  /**
   * Refreshed on every save, not only on insert: the column records when this
   * summary was last computed, and a re-tally replaces the row in place.
   */
  @UpdateDateColumn({ name: 'calculated_at', type: 'timestamp with time zone' })
  calculatedAt: Date;

  toResult(): ProposalResult {
    return {
      proposalId: this.proposalId,
      totalVotes: this.totalVotes,
      yesVotes: this.yesVotes,
      noVotes: this.noVotes,
      abstainVotes: this.abstainVotes,
      totalWeight: parseFloat(String(this.totalWeight)),
      yesWeight: parseFloat(String(this.yesWeight)),
      noWeight: parseFloat(String(this.noWeight)),
      abstainWeight: parseFloat(String(this.abstainWeight)),
      passed: this.passed,
      participationRate: this.participationRate,
      calculatedAt: this.calculatedAt.getTime(),
    };
  }
}
