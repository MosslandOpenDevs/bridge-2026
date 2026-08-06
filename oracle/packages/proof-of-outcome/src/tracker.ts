import {
  OutcomeTracker,
  ExecutionRecord,
  KPIResult,
  OutcomeProof,
  DecisionPacket,
  generateId,
  now,
  hashData,
} from "@oracle/core";

export interface OutcomeTrackerConfig {
  /**
   * Observation window: how long after execution KPIs may be measured. A
   * proof produced before this has elapsed describes nothing that happened.
   */
  kpiMeasurementDelay?: number;
}

/** A measured KPI value supplied by whoever observed the real metric. */
export interface KPIMeasurement {
  /** Must match a KPI name declared on the proposal's decision packet. */
  name: string;
  actual: number;
  /** Optional override; defaults to the declared target. */
  target?: number;
  unit?: string;
  /**
   * Whether the measurement met the goal. Defaults to actual <= target, which
   * suits "lower is better" metrics; pass explicitly for anything else.
   */
  success?: boolean;
  source?: string;
}

export interface MeasurementStatus {
  executionId: string;
  /** Earliest time measurements may be accepted. */
  dueAt: Date;
  measured: boolean;
  proofId?: string;
}

export class OutcomeTrackerImpl implements OutcomeTracker {
  /** Fraction of KPIs that must pass for an outcome to count as a success. */
  static readonly SUCCESS_THRESHOLD = 0.8;

  private executions: Map<string, ExecutionRecord> = new Map();
  private kpiResults: Map<string, KPIResult[]> = new Map();
  private proofs: Map<string, OutcomeProof> = new Map();
  private decisionPackets: Map<string, DecisionPacket> = new Map();
  private config: OutcomeTrackerConfig;

  constructor(config: OutcomeTrackerConfig = {}) {
    // `??` not `||`: an explicit 0 (measure immediately, used by tests) must
    // survive rather than being replaced by the 24-hour default.
    const delay = config.kpiMeasurementDelay ?? 24 * 60 * 60 * 1000;
    if (!Number.isInteger(delay) || delay < 0) {
      throw new Error("kpiMeasurementDelay must be a non-negative integer");
    }
    this.config = { kpiMeasurementDelay: delay };
  }

  // Store decision packet for reference
  registerDecision(decisionPacket: DecisionPacket): void {
    this.decisionPackets.set(decisionPacket.id, decisionPacket);
  }

  async recordExecution(
    proposalId: string,
    actions: ExecutionRecord["actions"]
  ): Promise<ExecutionRecord> {
    const allCompleted = actions.every((a) => a.status === "completed");
    const anyFailed = actions.some((a) => a.status === "failed");
    const anyPartial = actions.some((a) => a.status === "partial");

    let status: ExecutionRecord["status"];
    if (allCompleted) {
      status = "completed";
    } else if (anyFailed) {
      status = "failed";
    } else if (anyPartial) {
      status = "partial";
    } else {
      status = "in_progress";
    }

    const record: ExecutionRecord = {
      id: generateId(),
      proposalId,
      status,
      executedBy: "system",
      executedAt: now(),
      actions,
    };

    this.executions.set(record.id, record);
    return record;
  }

  /** When measurements for this execution become acceptable. */
  measurementDueAt(executionId: string): Date {
    const execution = this.executions.get(executionId);
    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }
    return new Date(
      execution.executedAt.getTime() + this.config.kpiMeasurementDelay!,
    );
  }

  measurementStatus(executionId: string): MeasurementStatus {
    const results = this.kpiResults.get(executionId);
    const proof = this.getProofByExecution(executionId);
    return {
      executionId,
      dueAt: this.measurementDueAt(executionId),
      measured: Boolean(results && results.length > 0),
      proofId: proof?.id,
    };
  }

  /**
   * Record observed KPI values against the KPIs the proposal committed to.
   *
   * Measurements are only accepted once the observation window has elapsed:
   * a value read at the instant of execution says nothing about the outcome.
   */
  submitMeasurements(
    executionId: string,
    declaredKpis: Array<{ name: string; target: number; unit: string }>,
    measurements: KPIMeasurement[],
    options: { at?: Date } = {},
  ): KPIResult[] {
    const execution = this.executions.get(executionId);
    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    const at = options.at ?? now();
    const dueAt = this.measurementDueAt(executionId);
    if (at < dueAt) {
      const remainingMs = dueAt.getTime() - at.getTime();
      throw new Error(
        `KPIs for execution ${executionId} cannot be measured before ` +
          `${dueAt.toISOString()} (${Math.ceil(remainingMs / 1000)}s remaining)`,
      );
    }

    if (measurements.length === 0) {
      throw new Error("At least one measurement is required");
    }

    const declaredByName = new Map(declaredKpis.map((k) => [k.name, k]));
    const results: KPIResult[] = [];

    for (const measurement of measurements) {
      const declared = declaredByName.get(measurement.name);
      const target = measurement.target ?? declared?.target;
      if (target === undefined) {
        throw new Error(
          `KPI "${measurement.name}" is not declared on this proposal and no ` +
            "target was supplied",
        );
      }
      if (!Number.isFinite(measurement.actual)) {
        throw new Error(`KPI "${measurement.name}" needs a numeric actual value`);
      }

      const deviation =
        target !== 0
          ? ((measurement.actual - target) / target) * 100
          : measurement.actual === 0
            ? 0
            : 100;

      results.push({
        id: generateId(),
        executionId,
        kpiName: measurement.name,
        targetValue: target,
        actualValue: measurement.actual,
        unit: measurement.unit ?? declared?.unit ?? "",
        measuredAt: at,
        success: measurement.success ?? measurement.actual <= target,
        deviation,
      });
    }

    this.kpiResults.set(executionId, results);
    return results;
  }

  /**
   * Previously fabricated two KPIs — a resolution time computed as the
   * milliseconds since execution (always ~0 hours, so always "on target")
   * and a recurrence count hardcoded to 0 — which is how every execution
   * produced a 100% proof milliseconds after it was recorded. Measurements
   * must now be supplied by whoever observed the real metric.
   */
  async measureKPIs(executionId: string): Promise<KPIResult[]> {
    const results = this.kpiResults.get(executionId);
    if (!results || results.length === 0) {
      throw new Error(
        `No KPI measurements recorded for execution ${executionId}. Submit ` +
          "observed values once the measurement window has elapsed.",
      );
    }
    return results;
  }

  /**
   * Build the outcome proof. Requires real measurements; successRate is a
   * fraction in [0,1], the same unit used everywhere else.
   */
  async generateProof(executionId: string): Promise<OutcomeProof> {
    const execution = this.executions.get(executionId);
    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    const results = await this.measureKPIs(executionId);

    const successfulKPIs = results.filter((r) => r.success).length;
    const successRate = results.length > 0 ? successfulKPIs / results.length : 0;

    const proofData = {
      executionId,
      proposalId: execution.proposalId,
      kpiResults: results.map((r) => ({
        name: r.kpiName,
        target: r.targetValue,
        actual: r.actualValue,
        success: r.success,
      })),
      timestamp: now().toISOString(),
    };

    const existing = this.getProofByExecution(executionId);
    const proof: OutcomeProof = {
      id: existing?.id ?? generateId(),
      executionId,
      proposalId: execution.proposalId,
      kpiResults: results,
      overallSuccess: successRate >= OutcomeTrackerImpl.SUCCESS_THRESHOLD,
      successRate,
      proofHash: hashData(proofData),
      recordedAt: now(),
    };

    this.proofs.set(proof.id, proof);
    return proof;
  }

  /** Load persisted execution/KPI/proof state at boot. */
  restoreExecution(record: ExecutionRecord, kpiResults?: KPIResult[]): void {
    this.executions.set(record.id, record);
    if (kpiResults && kpiResults.length > 0) {
      this.kpiResults.set(record.id, kpiResults);
    }
  }

  restoreProof(proof: OutcomeProof): void {
    this.proofs.set(proof.id, proof);
    if (proof.kpiResults.length > 0 && !this.kpiResults.has(proof.executionId)) {
      this.kpiResults.set(proof.executionId, proof.kpiResults);
    }
  }

  getExecution(executionId: string): ExecutionRecord | undefined {
    return this.executions.get(executionId);
  }

  getProof(proofId: string): OutcomeProof | undefined {
    return this.proofs.get(proofId);
  }

  getProofByExecution(executionId: string): OutcomeProof | undefined {
    return Array.from(this.proofs.values()).find(
      (p) => p.executionId === executionId
    );
  }

  listProofs(): OutcomeProof[] {
    return Array.from(this.proofs.values());
  }

  listExecutions(): ExecutionRecord[] {
    return Array.from(this.executions.values());
  }

}
