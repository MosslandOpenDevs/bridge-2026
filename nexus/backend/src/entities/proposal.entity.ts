import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import type {
  Proposal,
  ProposalAction,
  ProposalStatus,
  ProposalType,
} from '@bridge-2026/shared';
import { VoteEntity } from './vote.entity';

/**
 * Maps the `proposals` table in
 * infrastructure/database/schemas/proposals.sql.
 *
 * The table keeps instants as `timestamp with time zone` while the shared
 * `Proposal` type carries epoch milliseconds, so the conversion is done here
 * and the API never exposes two time representations for the same field.
 *
 * There is no `result` column: a tally is derived from `votes` and is stored
 * in its own `proposal_results` row (see ProposalResultEntity).
 */
@Entity('proposals')
@Index(['status', 'createdAt'])
export class ProposalEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'title', type: 'text' })
  title: string;

  @Column({ name: 'description', type: 'text' })
  description: string;

  @Column({ name: 'type', type: 'varchar', length: 50 })
  @Index()
  type: ProposalType;

  @Column({ name: 'status', type: 'varchar', length: 50 })
  @Index()
  status: ProposalStatus;

  @Column({ name: 'decision_packet_id', type: 'uuid' })
  @Index()
  decisionPacketId: string;

  @Column({ name: 'issue_id', type: 'uuid' })
  @Index()
  issueId: string;

  @Column({ name: 'actions', type: 'jsonb' })
  actions: ProposalAction[];

  @Column({
    name: 'voting_start_time',
    type: 'timestamp with time zone',
    nullable: true,
  })
  votingStartTime: Date | null;

  @Column({
    name: 'voting_end_time',
    type: 'timestamp with time zone',
    nullable: true,
  })
  votingEndTime: Date | null;

  @Column({
    name: 'min_participation_rate',
    type: 'double precision',
    nullable: true,
  })
  minParticipationRate: number | null;

  @Column({
    name: 'passing_threshold',
    type: 'double precision',
    nullable: true,
  })
  passingThreshold: number | null;

  @Column({ name: 'created_by', type: 'text', nullable: true })
  createdBy: string | null;

  @Column({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @OneToMany(() => VoteEntity, vote => vote.proposal)
  votes: VoteEntity[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;

  toProposal(): Proposal {
    return {
      id: this.id,
      title: this.title,
      description: this.description,
      type: this.type,
      status: this.status,
      decisionPacketId: this.decisionPacketId,
      issueId: this.issueId,
      actions: this.actions ?? [],
      votingStartTime: this.votingStartTime?.getTime(),
      votingEndTime: this.votingEndTime?.getTime(),
      minParticipationRate: this.minParticipationRate ?? undefined,
      passingThreshold: this.passingThreshold ?? undefined,
      createdBy: this.createdBy ?? undefined,
      createdAt: this.createdAt.getTime(),
      updatedAt: this.updatedAt.getTime(),
      metadata: this.metadata ?? undefined,
    };
  }
}
