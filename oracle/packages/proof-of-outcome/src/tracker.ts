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
  kpiMeasurementDelay?: number; // ms to wait before measuring KPIs
}

export class OutcomeTrackerImpl implements OutcomeTracker {
  private executions: Map<string, ExecutionRecord> = new Map();
  private kpiResults: Map<string, KPIResult[]> = new Map();
  private proofs: Map<string, OutcomeProof> = new Map();
  private decisionPackets: Map<string, DecisionPacket> = new Map();
  private config: OutcomeTrackerConfig;

  constructor(config: OutcomeTrackerConfig = {}) {
    this.config = {
      kpiMeasurementDelay: config.kpiMeasurementDelay || 24 * 60 * 60 * 1000, // 24 hours
    };
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

  async measureKPIs(executionId: string): Promise<KPIResult[]> {
    const execution = this.executions.get(executionId);
    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    // Find the associated decision packet to get KPI definitions
    // In a real implementation, this would query actual metrics
    const results: KPIResult[] = [];

    // Simulated KPI measurement - in production, this would connect to actual data sources
    const sampleKPIs = [
      {
        name: "Resolution Time",
        target: 24,
        actual: this.measureResolutionTime(execution),
        unit: "hours",
      },
      {
        name: "Issue Recurrence",
        target: 0,
        actual: 0, // Would check for similar issues
        unit: "occurrences",
      },
    ];

    for (const kpi of sampleKPIs) {
      const deviation =
        kpi.target !== 0
          ? ((kpi.actual - kpi.target) / kpi.target) * 100
          : kpi.actual === 0
            ? 0
            : 100;

      const result: KPIResult = {
        id: generateId(),
        executionId,
        kpiName: kpi.name,
        targetValue: kpi.target,
        actualValue: kpi.actual,
        unit: kpi.unit,
        measuredAt: now(),
        success: kpi.actual <= kpi.target,
        deviation,
      };

      results.push(result);
    }

    this.kpiResults.set(executionId, results);
    return results;
  }

  async generateProof(executionId: string): Promise<OutcomeProof> {
    const execution = this.executions.get(executionId);
    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    let results = this.kpiResults.get(executionId);
    if (!results) {
      results = await this.measureKPIs(executionId);
    }

    const successfulKPIs = results.filter((r) => r.success).length;
    const successRate = results.length > 0 ? (successfulKPIs / results.length) * 100 : 0;

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

    const proof: OutcomeProof = {
      id: generateId(),
      executionId,
      proposalId: execution.proposalId,
      kpiResults: results,
      overallSuccess: successRate >= 80, // 80% KPIs must pass
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

  private measureResolutionTime(execution: ExecutionRecord): number {
    // Calculate hours from execution start
    // In production, this would compare to proposal creation time
    return Math.round(
      (now().getTime() - execution.executedAt.getTime()) / (1000 * 60 * 60)
    );
  }
}
