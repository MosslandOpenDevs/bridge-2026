import {
  Proposal,
  Vote,
  VoteTally,
  VoteChoice,
  DecisionPacket,
  generateId,
  now,
} from "@oracle/core";

export interface VotingConfig {
  defaultQuorum: number; // Minimum number of votes required
  defaultThreshold: number; // Percentage of decisive votes to pass (1-100)
  votingPeriod: number; // Duration in milliseconds
  minVotingPeriod: number; // Shortest acceptable voting period
  maxVotingPeriod: number; // Longest acceptable voting period
  executionDelay: number; // Timelock between passing and execution
}

export interface ProposalOptions {
  quorum?: number;
  threshold?: number;
  votingPeriod?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Reject anything that would let a proposal pass without real support.
 * A negative quorum makes "votes >= quorum" true with no votes at all, and a
 * negative threshold makes "forPercentage >= threshold" true with none in
 * favour — so these bounds are load-bearing, not cosmetic.
 */
function requirePositiveInt(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return value;
}

export class VotingSystem {
  private proposals: Map<string, Proposal> = new Map();
  private votes: Map<string, Vote[]> = new Map();
  private config: VotingConfig;

  constructor(config: Partial<VotingConfig> = {}) {
    // `??` not `||`: an explicit 0 must fail validation rather than be
    // silently replaced by the default.
    const resolved: VotingConfig = {
      defaultQuorum: config.defaultQuorum ?? 100,
      defaultThreshold: config.defaultThreshold ?? 50,
      votingPeriod: config.votingPeriod ?? 7 * DAY_MS,
      minVotingPeriod: config.minVotingPeriod ?? 60 * 1000,
      maxVotingPeriod: config.maxVotingPeriod ?? 90 * DAY_MS,
      executionDelay: config.executionDelay ?? 2 * DAY_MS,
    };

    requirePositiveInt(resolved.defaultQuorum, "defaultQuorum");
    this.assertThreshold(resolved.defaultThreshold, "defaultThreshold");
    requirePositiveInt(resolved.minVotingPeriod, "minVotingPeriod");
    requirePositiveInt(resolved.maxVotingPeriod, "maxVotingPeriod");
    if (resolved.minVotingPeriod > resolved.maxVotingPeriod) {
      throw new Error("minVotingPeriod must not exceed maxVotingPeriod");
    }
    if (!Number.isInteger(resolved.executionDelay) || resolved.executionDelay < 0) {
      throw new Error("executionDelay must be a non-negative integer");
    }
    this.assertVotingPeriod(resolved.votingPeriod, resolved);

    this.config = resolved;
  }

  private assertThreshold(value: number, field: string): number {
    if (!Number.isFinite(value) || value < 1 || value > 100) {
      throw new Error(`${field} must be between 1 and 100`);
    }
    return value;
  }

  private assertVotingPeriod(value: number, config: VotingConfig): number {
    requirePositiveInt(value, "votingPeriod");
    if (value < config.minVotingPeriod || value > config.maxVotingPeriod) {
      throw new Error(
        `votingPeriod must be between ${config.minVotingPeriod} and ${config.maxVotingPeriod} ms`,
      );
    }
    return value;
  }

  /** Validated settings for a new proposal. Throws on any unusable value. */
  private resolveOptions(options?: ProposalOptions): {
    quorum: number;
    threshold: number;
    votingPeriodMs: number;
  } {
    const quorum = requirePositiveInt(
      options?.quorum ?? this.config.defaultQuorum,
      "quorum",
    );
    const threshold = this.assertThreshold(
      options?.threshold ?? this.config.defaultThreshold,
      "threshold",
    );
    const votingPeriodMs = this.assertVotingPeriod(
      options?.votingPeriod ?? this.config.votingPeriod,
      this.config,
    );
    return { quorum, threshold, votingPeriodMs };
  }

  createProposal(
    decisionPacket: DecisionPacket,
    proposer: string,
    options?: ProposalOptions
  ): Proposal {
    const { quorum, threshold, votingPeriodMs } = this.resolveOptions(options);

    const votingStartsAt = now();
    const votingEndsAt = new Date(votingStartsAt.getTime() + votingPeriodMs);

    const proposal: Proposal = {
      id: generateId(),
      decisionPacket,
      proposer,
      status: "pending",
      votingStartsAt,
      votingEndsAt,
      votingPeriodMs,
      quorum,
      threshold,
      createdAt: now(),
    };

    this.proposals.set(proposal.id, proposal);
    this.votes.set(proposal.id, []);

    return proposal;
  }

  activateProposal(proposalId: string): Proposal {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`Proposal ${proposalId} not found`);
    }

    if (proposal.status !== "pending") {
      throw new Error(`Proposal ${proposalId} is not pending`);
    }

    proposal.status = "active";
    proposal.votingStartsAt = now();
    // Re-derive from this proposal's own period; using the system default here
    // silently discarded whatever votingPeriod the proposal was created with.
    proposal.votingEndsAt = new Date(
      proposal.votingStartsAt.getTime() + proposal.votingPeriodMs
    );

    return proposal;
  }

  castVote(
    proposalId: string,
    voter: string,
    choice: VoteChoice,
    weight: bigint,
    reason?: string
  ): Vote {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`Proposal ${proposalId} not found`);
    }

    if (proposal.status !== "active") {
      throw new Error(`Proposal ${proposalId} is not active for voting`);
    }

    const currentTime = now();
    if (currentTime > proposal.votingEndsAt) {
      throw new Error(`Voting period for proposal ${proposalId} has ended`);
    }

    // Check for duplicate vote
    const existingVotes = this.votes.get(proposalId) || [];
    const existingVote = existingVotes.find((v) => v.voter === voter);
    if (existingVote) {
      throw new Error(`Voter ${voter} has already voted on this proposal`);
    }

    const vote: Vote = {
      id: generateId(),
      proposalId,
      voter,
      choice,
      weight,
      reason,
      timestamp: currentTime,
    };

    existingVotes.push(vote);
    this.votes.set(proposalId, existingVotes);

    return vote;
  }

  tallyVotes(proposalId: string): VoteTally {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`Proposal ${proposalId} not found`);
    }

    const votes = this.votes.get(proposalId) || [];

    let forVotes = 0n;
    let againstVotes = 0n;
    let abstainVotes = 0n;

    for (const vote of votes) {
      switch (vote.choice) {
        case "for":
          forVotes += vote.weight;
          break;
        case "against":
          againstVotes += vote.weight;
          break;
        case "abstain":
          abstainVotes += vote.weight;
          break;
      }
    }

    const totalVotes = forVotes + againstVotes + abstainVotes;
    const quorumReached = votes.length >= proposal.quorum;

    // Calculate pass/fail (abstains don't count toward threshold)
    const decisiveVotes = forVotes + againstVotes;
    const forPercentage =
      decisiveVotes > 0n
        ? Number((forVotes * 100n) / decisiveVotes)
        : 0;
    const passed = quorumReached && forPercentage >= proposal.threshold;

    return {
      proposalId,
      forVotes,
      againstVotes,
      abstainVotes,
      totalVotes,
      participationRate: votes.length / proposal.quorum,
      quorumReached,
      passed,
    };
  }

  /**
   * Close voting and record the outcome. Only callable once the voting period
   * has actually elapsed — otherwise a proposal could be created, voted on and
   * declared passed within a single burst of requests, making the voting
   * period decorative.
   */
  finalizeProposal(proposalId: string): Proposal {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`Proposal ${proposalId} not found`);
    }

    if (proposal.status !== "active") {
      throw new Error(`Proposal ${proposalId} is not active`);
    }

    const currentTime = now();
    if (currentTime < proposal.votingEndsAt) {
      const remainingMs = proposal.votingEndsAt.getTime() - currentTime.getTime();
      throw new Error(
        `Voting for proposal ${proposalId} ends at ${proposal.votingEndsAt.toISOString()} ` +
          `(${Math.ceil(remainingMs / 1000)}s remaining)`,
      );
    }

    const tally = this.tallyVotes(proposalId);

    proposal.status = tally.passed ? "passed" : "rejected";
    if (tally.passed) {
      // Timelock: mirrors the contract's executionDelay so a proposal that
      // slipped through can still be reacted to before it takes effect.
      proposal.executionEta = new Date(
        currentTime.getTime() + this.config.executionDelay,
      );
    }

    return proposal;
  }

  /** True once a passed proposal is past its timelock. */
  isExecutable(proposal: Proposal, at: Date = now()): boolean {
    if (proposal.status !== "passed") return false;
    if (!proposal.executionEta) return false;
    return at >= proposal.executionEta;
  }

  executeProposal(proposalId: string): Proposal {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`Proposal ${proposalId} not found`);
    }

    if (proposal.status !== "passed") {
      throw new Error(`Proposal ${proposalId} has not passed (status: ${proposal.status})`);
    }

    const currentTime = now();
    if (!proposal.executionEta) {
      throw new Error(
        `Proposal ${proposalId} has no execution ETA; finalize it before executing`,
      );
    }
    if (currentTime < proposal.executionEta) {
      const remainingMs = proposal.executionEta.getTime() - currentTime.getTime();
      throw new Error(
        `Timelock has not elapsed for proposal ${proposalId}: executable at ` +
          `${proposal.executionEta.toISOString()} (${Math.ceil(remainingMs / 1000)}s remaining)`,
      );
    }

    proposal.status = "executed";
    proposal.executedAt = now();

    return proposal;
  }

  getProposal(proposalId: string): Proposal | undefined {
    return this.proposals.get(proposalId);
  }

  getVotes(proposalId: string): Vote[] {
    return this.votes.get(proposalId) || [];
  }

  listProposals(status?: Proposal["status"]): Proposal[] {
    const proposals = Array.from(this.proposals.values());
    if (status) {
      return proposals.filter((p) => p.status === status);
    }
    return proposals;
  }
}
