/**
 * Durable governance state.
 *
 * Proposals, votes, delegations, executions, proofs and trust scores used to
 * live only in process memory: a deploy, a crash or an ordinary restart threw
 * away every active vote, and the proposals table kept rows that nothing could
 * see, which then blocked those issues from ever being proposed again.
 *
 * SQLite is now the source of truth. Each mutation is written here, and
 * hydrate() rebuilds the in-memory structures at boot before the server
 * accepts traffic.
 */

import type { Proposal, Vote, DelegationPolicy } from "@oracle/core";
import type { ExecutionRecord, KPIResult, OutcomeProof, TrustScore } from "@oracle/core";
import type { VotingSystem, DelegationManager } from "@oracle/human-governance";
import type { OutcomeTrackerImpl, TrustManager } from "@oracle/proof-of-outcome";
import { governanceDb, inTransaction, issueExists } from "./db.js";

const iso = (d: Date | string | undefined | null): string | null => {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : String(d);
};

function proposalTitle(proposal: Proposal): string {
  const dp: any = proposal.decisionPacket;
  return (
    dp?.issue?.title ||
    dp?.recommendation?.action ||
    `Proposal ${proposal.id.slice(0, 8)}`
  );
}

function proposalDescription(proposal: Proposal): string {
  const dp: any = proposal.decisionPacket;
  return (
    dp?.recommendation?.rationale ||
    dp?.issue?.description ||
    dp?.recommendation?.action ||
    ""
  );
}

/* ----------------------------- writes ----------------------------- */

/**
 * proposals.issue_id is a foreign key, so it may only be set when the issue is
 * actually stored. A decision packet can reference an issue that was never
 * persisted (an ad-hoc deliberation), and linking to it would fail the whole
 * insert — losing the proposal to protect a reference that adds nothing.
 */
function linkableIssueId(candidate: unknown): string | null {
  if (typeof candidate !== "string" || candidate.length === 0) return null;
  return issueExists.get(candidate) ? candidate : null;
}

export function saveProposal(proposal: Proposal, issueId?: string | null): void {
  governanceDb.upsertProposal.run({
    id: proposal.id,
    title: proposalTitle(proposal),
    description: proposalDescription(proposal),
    proposer: proposal.proposer,
    status: proposal.status,
    votingStarts: iso(proposal.votingStartsAt),
    votingEnds: iso(proposal.votingEndsAt),
    issueId: linkableIssueId(
      issueId ?? (proposal.decisionPacket as any)?.issue?.id ?? null,
    ),
    decisionPacket: JSON.stringify(proposal.decisionPacket),
    votingPeriodMs: proposal.votingPeriodMs,
    quorum: proposal.quorum,
    threshold: proposal.threshold,
    executionEta: iso(proposal.executionEta),
    executedAt: iso(proposal.executedAt),
    snapshotBlock: proposal.snapshotBlock ?? null,
    onchainId: proposal.onchainId ?? null,
  });
}

/**
 * Persist a vote. The UNIQUE (proposal_id, voter_key) constraint means a
 * double vote fails here even if the in-memory check were bypassed.
 */
export function saveVote(vote: Vote, voterKey: string): void {
  governanceDb.insertVote.run({
    id: vote.id,
    proposalId: vote.proposalId,
    voter: vote.voter,
    voterKey,
    choice: vote.choice,
    weight: vote.weight.toString(),
    reason: vote.reason ?? null,
    txHash: vote.txHash ?? null,
    votedAt: iso(vote.timestamp),
  });
}

/** Write the vote and the proposal it belongs to as one unit. */
export function saveVoteWithProposal(
  vote: Vote,
  voterKey: string,
  proposal: Proposal,
): void {
  inTransaction(() => {
    saveProposal(proposal);
    saveVote(vote, voterKey);
  });
}

export function saveDelegation(policy: DelegationPolicy): void {
  governanceDb.upsertDelegation.run({
    id: policy.id,
    delegator: policy.delegator,
    delegatorKey: policy.delegator.toLowerCase(),
    delegate: policy.delegate,
    conditions: JSON.stringify(policy.conditions ?? []),
    expiresAt: iso(policy.expiresAt),
    active: policy.active ? 1 : 0,
  });
}

export function setDelegationActive(policyId: string, active: boolean): void {
  governanceDb.setDelegationActive.run({ id: policyId, active: active ? 1 : 0 });
}

export function saveExecution(
  execution: ExecutionRecord,
  kpiResults?: KPIResult[],
): void {
  governanceDb.upsertExecution.run({
    id: execution.id,
    proposalId: execution.proposalId,
    status: execution.status,
    executedBy: execution.executedBy,
    executedAt: iso(execution.executedAt),
    txHash: execution.txHash ?? null,
    actions: JSON.stringify(execution.actions ?? []),
    kpiResults: kpiResults ? JSON.stringify(kpiResults) : null,
  });
}

export function saveProof(proof: OutcomeProof): void {
  governanceDb.upsertProof.run({
    id: proof.id,
    executionId: proof.executionId,
    proposalId: proof.proposalId,
    kpiResults: JSON.stringify(proof.kpiResults ?? []),
    overallSuccess: proof.overallSuccess ? 1 : 0,
    successRate: proof.successRate,
    proofHash: proof.proofHash,
    attestation: proof.attestation ?? null,
    txHash: proof.txHash ?? null,
    recordedAt: iso(proof.recordedAt),
  });
}

export function saveTrustScore(score: TrustScore, proofId?: string): void {
  inTransaction(() => {
    governanceDb.upsertTrust.run({
      entityId: score.entityId,
      entityType: score.entityType,
      score: score.score,
      totalDecisions: score.totalDecisions,
      successfulDecisions: score.successfulDecisions,
      lastUpdated: iso(score.lastUpdated),
    });
    if (proofId) {
      governanceDb.insertTrustHistory.run({
        entityId: score.entityId,
        proofId,
        recordedAt: iso(score.lastUpdated),
      });
    }
  });
}

/** Record an execution, its proof and the resulting trust scores atomically. */
export function saveExecutionOutcome(params: {
  proposal: Proposal;
  execution: ExecutionRecord;
  kpiResults?: KPIResult[];
  proof?: OutcomeProof;
  trustScores?: TrustScore[];
}): void {
  inTransaction(() => {
    saveProposal(params.proposal);
    saveExecution(params.execution, params.kpiResults);
    if (params.proof) saveProof(params.proof);
    for (const score of params.trustScores ?? []) {
      governanceDb.upsertTrust.run({
        entityId: score.entityId,
        entityType: score.entityType,
        score: score.score,
        totalDecisions: score.totalDecisions,
        successfulDecisions: score.successfulDecisions,
        lastUpdated: iso(score.lastUpdated),
      });
      if (params.proof) {
        governanceDb.insertTrustHistory.run({
          entityId: score.entityId,
          proofId: params.proof.id,
          recordedAt: iso(score.lastUpdated),
        });
      }
    }
  });
}

/* ----------------------------- reads ------------------------------ */

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || raw.length === 0) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export interface HydrationReport {
  proposals: number;
  votes: number;
  delegations: number;
  executions: number;
  proofs: number;
  trustScores: number;
  skipped: string[];
}

/**
 * Rebuild in-memory governance state from storage. Rows that cannot be
 * reconstructed are skipped and reported rather than aborting startup — a
 * single unreadable row must not keep the service down.
 */
export function hydrate(deps: {
  votingSystem: VotingSystem;
  delegationManager: DelegationManager;
  outcomeTracker: OutcomeTrackerImpl;
  trustManager: TrustManager;
}): HydrationReport {
  const report: HydrationReport = {
    proposals: 0,
    votes: 0,
    delegations: 0,
    executions: 0,
    proofs: 0,
    trustScores: 0,
    skipped: [],
  };

  // Proposals ------------------------------------------------------
  const proposalRows = governanceDb.allProposals.all() as any[];
  const knownProposals = new Set<string>();
  for (const row of proposalRows) {
    try {
      const decisionPacket = parseJson<any>(row.decision_packet, null);
      if (!decisionPacket) {
        report.skipped.push(`proposal ${row.id}: no decision packet`);
        continue;
      }
      if (!row.voting_starts || !row.voting_ends) {
        report.skipped.push(`proposal ${row.id}: missing voting window`);
        continue;
      }
      const votingStartsAt = new Date(row.voting_starts);
      const votingEndsAt = new Date(row.voting_ends);
      const proposal: Proposal = {
        id: row.id,
        decisionPacket: reviveDecisionPacket(decisionPacket),
        proposer: row.proposer,
        status: row.status,
        votingStartsAt,
        votingEndsAt,
        votingPeriodMs:
          row.voting_period_ms ??
          Math.max(1, votingEndsAt.getTime() - votingStartsAt.getTime()),
        quorum: row.quorum ?? 100,
        threshold: row.threshold ?? 50,
        createdAt: row.created_at ? new Date(row.created_at) : votingStartsAt,
        ...(row.execution_eta ? { executionEta: new Date(row.execution_eta) } : {}),
        ...(row.executed_at ? { executedAt: new Date(row.executed_at) } : {}),
        ...(row.snapshot_block !== null && row.snapshot_block !== undefined
          ? { snapshotBlock: row.snapshot_block }
          : {}),
        ...(row.onchain_id !== null && row.onchain_id !== undefined
          ? { onchainId: row.onchain_id }
          : {}),
      };
      deps.votingSystem.restoreProposal(proposal);
      knownProposals.add(proposal.id);
      report.proposals++;
    } catch (error) {
      report.skipped.push(`proposal ${row?.id}: ${(error as Error).message}`);
    }
  }

  // Votes ----------------------------------------------------------
  for (const row of governanceDb.allVotes.all() as any[]) {
    try {
      if (!knownProposals.has(row.proposal_id)) {
        report.skipped.push(`vote ${row.id}: proposal ${row.proposal_id} missing`);
        continue;
      }
      deps.votingSystem.restoreVote({
        id: row.id,
        proposalId: row.proposal_id,
        voter: row.voter,
        choice: row.choice,
        weight: BigInt(row.weight),
        reason: row.reason ?? undefined,
        timestamp: new Date(row.voted_at),
        ...(row.tx_hash ? { txHash: row.tx_hash } : {}),
      });
      report.votes++;
    } catch (error) {
      report.skipped.push(`vote ${row?.id}: ${(error as Error).message}`);
    }
  }

  // Delegations ----------------------------------------------------
  for (const row of governanceDb.allDelegations.all() as any[]) {
    try {
      deps.delegationManager.restorePolicy({
        id: row.id,
        delegator: row.delegator,
        delegate: row.delegate,
        conditions: parseJson<any[]>(row.conditions, []),
        active: row.active === 1,
        ...(row.expires_at ? { expiresAt: new Date(row.expires_at) } : {}),
      });
      report.delegations++;
    } catch (error) {
      report.skipped.push(`delegation ${row?.id}: ${(error as Error).message}`);
    }
  }

  // Executions -----------------------------------------------------
  for (const row of governanceDb.allExecutions.all() as any[]) {
    try {
      const kpiResults = parseJson<any[]>(row.kpi_results, []).map(reviveKpi);
      deps.outcomeTracker.restoreExecution(
        {
          id: row.id,
          proposalId: row.proposal_id,
          status: row.status,
          executedBy: row.executed_by,
          executedAt: new Date(row.executed_at),
          actions: parseJson<any[]>(row.actions, []),
          ...(row.tx_hash ? { txHash: row.tx_hash } : {}),
        },
        kpiResults,
      );
      report.executions++;
    } catch (error) {
      report.skipped.push(`execution ${row?.id}: ${(error as Error).message}`);
    }
  }

  // Proofs ---------------------------------------------------------
  const proofsById = new Map<string, OutcomeProof>();
  for (const row of governanceDb.allProofs.all() as any[]) {
    try {
      const proof: OutcomeProof = {
        id: row.id,
        executionId: row.execution_id,
        proposalId: row.proposal_id,
        kpiResults: parseJson<any[]>(row.kpi_results, []).map(reviveKpi),
        overallSuccess: row.overall_success === 1,
        successRate: row.success_rate,
        proofHash: row.proof_hash,
        recordedAt: new Date(row.recorded_at),
        ...(row.attestation ? { attestation: row.attestation } : {}),
        ...(row.tx_hash ? { txHash: row.tx_hash } : {}),
      };
      deps.outcomeTracker.restoreProof(proof);
      proofsById.set(proof.id, proof);
      report.proofs++;
    } catch (error) {
      report.skipped.push(`proof ${row?.id}: ${(error as Error).message}`);
    }
  }

  // Trust scores ---------------------------------------------------
  const historyByEntity = new Map<string, OutcomeProof[]>();
  for (const row of governanceDb.allTrustHistory.all() as any[]) {
    const proof = proofsById.get(row.proof_id);
    if (!proof) continue;
    const list = historyByEntity.get(row.entity_id) ?? [];
    list.push(proof);
    historyByEntity.set(row.entity_id, list);
  }
  for (const row of governanceDb.allTrust.all() as any[]) {
    try {
      deps.trustManager.restoreScore(
        {
          entityId: row.entity_id,
          entityType: row.entity_type,
          score: row.score,
          totalDecisions: row.total_decisions,
          successfulDecisions: row.successful_decisions,
          lastUpdated: new Date(row.last_updated),
        },
        historyByEntity.get(row.entity_id) ?? [],
      );
      report.trustScores++;
    } catch (error) {
      report.skipped.push(`trust ${row?.entity_id}: ${(error as Error).message}`);
    }
  }

  return report;
}

/** JSON round-trips turn Dates into strings; put them back. */
function reviveDecisionPacket(packet: any): any {
  if (!packet || typeof packet !== "object") return packet;
  const revived = { ...packet };
  if (typeof revived.createdAt === "string") revived.createdAt = new Date(revived.createdAt);
  if (revived.issue && typeof revived.issue === "object") {
    revived.issue = { ...revived.issue };
    if (typeof revived.issue.detectedAt === "string") {
      revived.issue.detectedAt = new Date(revived.issue.detectedAt);
    }
  }
  if (Array.isArray(revived.agentOpinions)) {
    revived.agentOpinions = revived.agentOpinions.map((op: any) =>
      op && typeof op.timestamp === "string"
        ? { ...op, timestamp: new Date(op.timestamp) }
        : op,
    );
  }
  return revived;
}

function reviveKpi(kpi: any): KPIResult {
  return {
    ...kpi,
    measuredAt:
      typeof kpi?.measuredAt === "string" ? new Date(kpi.measuredAt) : kpi?.measuredAt,
  };
}
