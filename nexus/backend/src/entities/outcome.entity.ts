import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import type {
  Outcome,
  OutcomeEvaluation,
  OutcomeStatus,
  KPIMeasurement,
} from '@bridge-2026/shared';

/**
 * Maps the `outcomes` table in
 * infrastructure/database/schemas/outcomes.sql.
 *
 * KPI results are a list of KPIMeasurement documents in one JSONB column, not
 * a before/after pair of scalars: a measurement carries its own target, method,
 * source and instant, and Proof of Outcome records several per outcome.
 */
@Entity('outcomes')
@Index(['proposalId', 'status'])
export class OutcomeEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'proposal_id', type: 'uuid' })
  @Index()
  proposalId: string;

  @Column({ name: 'decision_packet_id', type: 'uuid' })
  @Index()
  decisionPacketId: string;

  @Column({ name: 'status', type: 'varchar', length: 50 })
  @Index()
  status: OutcomeStatus;

  @Column({ name: 'kpi_measurements', type: 'jsonb' })
  kpiMeasurements: KPIMeasurement[];

  @Column({ name: 'evaluation', type: 'jsonb', nullable: true })
  evaluation: OutcomeEvaluation | null;

  @Column({ name: 'execution_start_time', type: 'timestamp with time zone' })
  executionStartTime: Date;

  @Column({
    name: 'execution_end_time',
    type: 'timestamp with time zone',
    nullable: true,
  })
  executionEndTime: Date | null;

  @Column({ name: 'on_chain_proof_hash', type: 'text', nullable: true })
  onChainProofHash: string | null;

  @Column({ name: 'ipfs_ref', type: 'text', nullable: true })
  ipfsRef: string | null;

  @Column({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;

  toOutcome(): Outcome {
    return {
      id: this.id,
      proposalId: this.proposalId,
      decisionPacketId: this.decisionPacketId,
      status: this.status,
      kpiMeasurements: this.kpiMeasurements ?? [],
      evaluation: this.evaluation ?? undefined,
      executionStartTime: this.executionStartTime.getTime(),
      executionEndTime: this.executionEndTime?.getTime(),
      onChainProofHash: this.onChainProofHash ?? undefined,
      ipfsRef: this.ipfsRef ?? undefined,
      createdAt: this.createdAt.getTime(),
      updatedAt: this.updatedAt.getTime(),
      metadata: this.metadata ?? undefined,
    };
  }
}
