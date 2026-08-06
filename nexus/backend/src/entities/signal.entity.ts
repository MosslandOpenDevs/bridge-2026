import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import type { Signal, SignalMetadata, Attestation } from '@bridge-2026/shared';

/**
 * Maps the `signals` table defined in
 * infrastructure/database/schemas/signals.sql and created by
 * migrations/001_initial_schema.sql. Those files are authoritative:
 * `synchronize` is off outside development, so any column this entity invents
 * is a column the running server queries and never finds.
 *
 * metadata/data/attestation therefore stay whole JSONB documents instead of
 * being flattened into scalars. Postgres reaches inside them through
 * expression indexes — metadata->>'source', metadata->>'type' — which TypeORM
 * has no decorator for, so those indexes live only in the SQL.
 */
@Entity('signals')
export class SignalEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'metadata', type: 'jsonb' })
  metadata: SignalMetadata;

  @Column({ name: 'data', type: 'jsonb' })
  data: Record<string, unknown>;

  @Column({ name: 'attestation', type: 'jsonb' })
  attestation: Attestation;

  @Column({ name: 'audit_log_ref', type: 'text', nullable: true })
  auditLogRef: string | null;

  @Index()
  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;

  toSignal(): Signal {
    return {
      id: this.id,
      metadata: this.metadata,
      data: this.data,
      attestation: this.attestation,
      auditLogRef: this.auditLogRef ?? undefined,
      createdAt: this.createdAt.getTime(),
      updatedAt: this.updatedAt.getTime(),
    };
  }
}
