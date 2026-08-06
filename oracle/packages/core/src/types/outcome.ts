import { z } from "zod";

// Execution status
export const ExecutionStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "failed",
  "partial",
]);
export type ExecutionStatus = z.infer<typeof ExecutionStatusSchema>;

// Execution record
export const ExecutionRecordSchema = z.object({
  id: z.string().uuid(),
  proposalId: z.string().uuid(),
  status: ExecutionStatusSchema,
  executedBy: z.string(), // Ethereum address or system
  executedAt: z.date(),
  txHash: z.string().optional(),
  actions: z.array(
    z.object({
      type: z.string(),
      target: z.string(),
      data: z.record(z.unknown()),
      status: ExecutionStatusSchema,
      error: z.string().optional(),
    })
  ),
});
export type ExecutionRecord = z.infer<typeof ExecutionRecordSchema>;

// KPI measurement result
export const KPIResultSchema = z.object({
  id: z.string().uuid(),
  executionId: z.string().uuid(),
  kpiName: z.string(),
  targetValue: z.number(),
  actualValue: z.number(),
  unit: z.string(),
  measuredAt: z.date(),
  success: z.boolean(),
  deviation: z.number(), // Percentage deviation from target
});
export type KPIResult = z.infer<typeof KPIResultSchema>;

// Outcome proof for on-chain recording
export const OutcomeProofSchema = z.object({
  id: z.string().uuid(),
  executionId: z.string().uuid(),
  proposalId: z.string().uuid(),
  kpiResults: z.array(KPIResultSchema),
  overallSuccess: z.boolean(),
  successRate: z.number(), // Fraction of KPIs met, in [0,1]
  proofHash: z.string(), // Hash of the proof data
  attestation: z.string().optional(), // Signature or merkle proof
  recordedAt: z.date(),
  txHash: z.string().optional(),
});
export type OutcomeProof = z.infer<typeof OutcomeProofSchema>;

// Outcome tracker interface
export interface OutcomeTracker {
  recordExecution(
    proposalId: string,
    actions: ExecutionRecord["actions"]
  ): Promise<ExecutionRecord>;
  measureKPIs(executionId: string): Promise<KPIResult[]>;
  generateProof(executionId: string): Promise<OutcomeProof>;
}

// Trust score for agents/proposals based on historical outcomes
export const TrustScoreSchema = z.object({
  entityId: z.string(),
  entityType: z.enum(["agent", "proposer", "delegate"]),
  score: z.number().min(0).max(100),
  totalDecisions: z.number(),
  successfulDecisions: z.number(),
  lastUpdated: z.date(),
});
export type TrustScore = z.infer<typeof TrustScoreSchema>;
