import { z } from "zod";
import { NormalizedSignalSchema } from "./signal.js";

// Issue priority levels
export const IssuePrioritySchema = z.enum(["low", "medium", "high", "urgent"]);
export type IssuePriority = z.infer<typeof IssuePrioritySchema>;

// Issue status
export const IssueStatusSchema = z.enum([
  "detected",
  "analyzing",
  "deliberating",
  "voting",
  "executed",
  "closed",
]);
export type IssueStatus = z.infer<typeof IssueStatusSchema>;

// Trend direction
export const TrendDirectionSchema = z.enum(["increasing", "decreasing", "stable"]);
export type TrendDirection = z.infer<typeof TrendDirectionSchema>;

// Issue kind: issue requires action, insight is for learning/monitoring
export const IssueKindSchema = z.enum(["issue", "insight"]);
export type IssueKind = z.infer<typeof IssueKindSchema>;

// Detected issue from inference mining
export const DetectedIssueSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string(),
  category: z.string(),
  priority: IssuePrioritySchema,
  status: IssueStatusSchema,
  kind: IssueKindSchema.default("issue"),
  direction: TrendDirectionSchema.optional(),
  detectedAt: z.date(),
  signals: z.array(NormalizedSignalSchema),
  evidence: z.array(
    z.object({
      type: z.string(),
      description: z.string(),
      data: z.record(z.unknown()),
    })
  ),
  suggestedActions: z.array(z.string()).optional(),
  // True when any signal behind this issue was generated rather than observed.
  // Denormalised from `signals` because an issue read back from storage does
  // not carry its signal rows, and the callers that must not act on invented
  // data — automatic deliberation above all — decide before rejoining them.
  synthetic: z.boolean().optional(),
  // Identity of the condition rather than of this observation of it, so a
  // situation that simply persists is recognised as the same issue instead of
  // being re-detected — and re-deliberated — on every pass.
  fingerprint: z.string().optional(),
});
export type DetectedIssue = z.infer<typeof DetectedIssueSchema>;

// Issue detector interface
export interface IssueDetector {
  readonly name: string;
  analyze(signals: z.infer<typeof NormalizedSignalSchema>[]): DetectedIssue[];
}
