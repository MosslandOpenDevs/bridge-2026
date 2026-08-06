import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  Index,
  Unique,
  JoinColumn,
} from 'typeorm';
import type { Vote } from '@bridge-2026/shared';
import { ProposalEntity } from './proposal.entity';

/**
 * Maps the `votes` table in infrastructure/database/schemas/proposals.sql.
 *
 * The (proposal_id, voter_address) uniqueness is declared in the database as
 * well: the service's "already voted" lookup is not atomic, so two concurrent
 * requests can both pass it and only the constraint stops the second insert.
 * Voter addresses are stored EIP-55 checksummed, so the constraint only holds
 * if every write path canonicalizes first (see src/security.ts).
 */
@Entity('votes')
@Unique('votes_proposal_id_voter_address_key', ['proposalId', 'voterAddress'])
export class VoteEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'proposal_id', type: 'uuid' })
  @Index()
  proposalId: string;

  @ManyToOne(() => ProposalEntity, proposal => proposal.votes)
  @JoinColumn({ name: 'proposal_id' })
  proposal: ProposalEntity;

  @Column({ name: 'voter_address', type: 'text' })
  @Index()
  voterAddress: string;

  @Column({ name: 'choice', type: 'varchar', length: 10 })
  choice: Vote['choice'];

  /**
   * NUMERIC has no lossless JavaScript counterpart, so the pg driver hands it
   * back as a string; toVote() is the single place that converts.
   */
  @Column({ name: 'weight', type: 'numeric' })
  weight: string | number;

  @Column({ name: 'tx_hash', type: 'text', nullable: true })
  txHash: string | null;

  @CreateDateColumn({ name: 'voted_at', type: 'timestamp with time zone' })
  votedAt: Date;

  toVote(): Vote {
    return {
      id: this.id,
      proposalId: this.proposalId,
      voterAddress: this.voterAddress,
      choice: this.choice,
      weight: parseFloat(String(this.weight)),
      votedAt: this.votedAt.getTime(),
      txHash: this.txHash ?? undefined,
    };
  }
}
