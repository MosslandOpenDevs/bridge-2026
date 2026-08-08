import { z } from "zod";

// Signal source types
export const SignalSourceSchema = z.enum([
  "onchain",
  "api",
  "telemetry",
  "manual",
]);
export type SignalSource = z.infer<typeof SignalSourceSchema>;

// Raw signal from adapters
export const RawSignalSchema = z.object({
  id: z.string().uuid(),
  source: SignalSourceSchema,
  sourceId: z.string(),
  timestamp: z.date(),
  data: z.record(z.unknown()),
  metadata: z
    .object({
      chainId: z.number().optional(),
      blockNumber: z.number().optional(),
      txHash: z.string().optional(),
      apiEndpoint: z.string().optional(),
    })
    .optional(),
});
export type RawSignal = z.infer<typeof RawSignalSchema>;

// Normalized signal after processing
export const NormalizedSignalSchema = z.object({
  id: z.string().uuid(),
  originalId: z.string().uuid(),
  source: SignalSourceSchema,
  timestamp: z.date(),
  category: z.string(),
  severity: z.enum(["low", "medium", "high", "critical"]),
  value: z.number(),
  unit: z.string(),
  description: z.string(),
  attestation: z.string().optional(), // Merkle proof or signature
  // True when the value was generated rather than observed. Demo adapters set
  // this so downstream consumers — detectors, agents, the public API — can tell
  // synthetic data from reality instead of having to infer it from the source.
  synthetic: z.boolean().optional(),
});
export type NormalizedSignal = z.infer<typeof NormalizedSignalSchema>;

// Signal adapter interface
export interface SignalAdapter {
  readonly name: string;
  readonly source: SignalSource;
  fetch(): Promise<RawSignal[]>;
  validate(signal: RawSignal): boolean;
  normalize(signal: RawSignal): NormalizedSignal;
}
