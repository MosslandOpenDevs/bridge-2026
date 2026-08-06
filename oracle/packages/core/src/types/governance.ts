import { z } from "zod";
import { DecisionPacketSchema } from "./agent.js";

// Proposal status
export const ProposalStatusSchema = z.enum([
  "pending",
  "active",
  "passed",
  "rejected",
  "executed",
  "cancelled",
]);
export type ProposalStatus = z.infer<typeof ProposalStatusSchema>;

// Vote choice
export const VoteChoiceSchema = z.enum(["for", "against", "abstain"]);
export type VoteChoice = z.infer<typeof VoteChoiceSchema>;

// Proposal for human governance
export const ProposalSchema = z.object({
  id: z.string().uuid(),
  onchainId: z.number().optional(),
  decisionPacket: DecisionPacketSchema,
  proposer: z.string(), // Ethereum address
  status: ProposalStatusSchema,
  votingStartsAt: z.date(),
  votingEndsAt: z.date(),
  /**
   * Voting duration in ms. Kept on the proposal so activation re-derives the
   * end time from the period this proposal was created with, instead of
   * silently substituting the system default.
   */
  votingPeriodMs: z.number().int().positive(),
  quorum: z.number().int().positive(), // Minimum number of votes required
  threshold: z.number().min(1).max(100), // Percentage of decisive votes to pass
  /**
   * Earliest time a passed proposal may be executed. Set when the proposal is
   * finalized as passed; the timelock gives holders a window to react.
   */
  executionEta: z.date().optional(),
  /**
   * Block height whose balances decide voting power for this proposal. Fixed
   * when the proposal is created so moving tokens between wallets during the
   * vote cannot mint extra voting power.
   */
  snapshotBlock: z.number().int().nonnegative().optional(),
  createdAt: z.date(),
  executedAt: z.date().optional(),
});
export type Proposal = z.infer<typeof ProposalSchema>;

// Individual vote
export const VoteSchema = z.object({
  id: z.string().uuid(),
  proposalId: z.string().uuid(),
  voter: z.string(), // Ethereum address
  choice: VoteChoiceSchema,
  weight: z.bigint(),
  reason: z.string().optional(),
  timestamp: z.date(),
  txHash: z.string().optional(),
});
export type Vote = z.infer<typeof VoteSchema>;

// Vote tally
export const VoteTallySchema = z.object({
  proposalId: z.string().uuid(),
  forVotes: z.bigint(),
  againstVotes: z.bigint(),
  abstainVotes: z.bigint(),
  totalVotes: z.bigint(),
  /**
   * Number of ballots cast. Quorum is a count of votes, not a sum of weights,
   * so this is what a quorum indicator must be measured against.
   */
  voteCount: z.number().int().nonnegative(),
  /** Share of `for` among decisive (for + against) weight, 0-100. */
  forPercentage: z.number(),
  participationRate: z.number(),
  quorumReached: z.boolean(),
  passed: z.boolean(),
});
export type VoteTally = z.infer<typeof VoteTallySchema>;

// Delegation policy
export const DelegationPolicySchema = z.object({
  id: z.string().uuid(),
  delegator: z.string(),
  delegate: z.string(),
  conditions: z.array(
    z.object({
      field: z.string(),
      operator: z.enum(["eq", "ne", "gt", "lt", "gte", "lte", "in", "contains"]),
      value: z.unknown(),
    })
  ),
  expiresAt: z.date().optional(),
  active: z.boolean(),
});
export type DelegationPolicy = z.infer<typeof DelegationPolicySchema>;
