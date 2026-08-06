import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import type { DelegationPolicy } from '@bridge-2026/shared';

/**
 * Maps the `delegation_policies` table in
 * infrastructure/database/schemas/proposals.sql.
 *
 * Field names stay snake_case because the shared `DelegationPolicy` type — the
 * contract this row is serialized into — uses snake_case, and inventing a
 * second spelling here would mean translating in both directions for nothing.
 */
@Entity('delegation_policies')
@Index(['wallet', 'agent_id'])
export class DelegationPolicyEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Stored EIP-55 checksummed so one holder cannot hold two policy sets. */
  @Column({ name: 'wallet', type: 'varchar', length: 255 })
  @Index()
  wallet: string;

  @Column({ name: 'agent_id', type: 'varchar', length: 100 })
  @Index()
  agent_id: string;

  @Column({ name: 'scope', type: 'jsonb', nullable: true })
  scope: DelegationPolicy['scope'] | null;

  @Column({
    name: 'max_budget_per_month',
    type: 'numeric',
    precision: 20,
    scale: 2,
    nullable: true,
  })
  max_budget_per_month: string | number | null;

  @Column({
    name: 'max_budget_per_proposal',
    type: 'numeric',
    precision: 20,
    scale: 2,
    nullable: true,
  })
  max_budget_per_proposal: string | number | null;

  @Column({ name: 'no_vote_on_emergency', type: 'boolean', default: true })
  no_vote_on_emergency: boolean;

  @Column({ name: 'cooldown_window_hours', type: 'integer' })
  cooldown_window_hours: number;

  @Column({ name: 'veto_enabled', type: 'boolean', default: false })
  veto_enabled: boolean;

  @Column({
    name: 'require_human_review_above',
    type: 'numeric',
    precision: 20,
    scale: 2,
    nullable: true,
  })
  require_human_review_above: string | number | null;

  @Column({ name: 'max_votes_per_day', type: 'integer', nullable: true })
  max_votes_per_day: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;

  toDelegationPolicy(): DelegationPolicy & { id: string; createdAt: number } {
    return {
      id: this.id,
      wallet: this.wallet,
      agent_id: this.agent_id,
      scope: this.scope || {},
      max_budget_per_month: toOptionalNumber(this.max_budget_per_month),
      max_budget_per_proposal: toOptionalNumber(this.max_budget_per_proposal),
      no_vote_on_emergency: this.no_vote_on_emergency,
      cooldown_window_hours: this.cooldown_window_hours,
      veto_enabled: this.veto_enabled,
      require_human_review_above: toOptionalNumber(
        this.require_human_review_above,
      ),
      max_votes_per_day: this.max_votes_per_day ?? undefined,
      createdAt: this.createdAt.getTime(),
    };
  }
}

/**
 * NUMERIC arrives from the pg driver as a string. The null check is explicit
 * because a truthiness test would turn a deliberate limit of 0 — "this agent
 * may not spend anything" — into "no limit at all".
 */
function toOptionalNumber(value: string | number | null): number | undefined {
  if (value === null || value === undefined) return undefined;
  return parseFloat(String(value));
}
