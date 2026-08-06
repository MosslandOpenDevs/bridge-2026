# Where governance state lives

## The decision

**The API's SQLite database is authoritative.** The `OracleGovernance`
contract is a public, append-only record of tallies the API has already
settled — not an independent source of truth, and not a second place where
voting rules are enforced.

Everything that decides an outcome happens off-chain: eligibility, the balance
snapshot a vote is weighted by, duplicate detection, quorum, threshold, the
voting deadline and the execution timelock. A proposal that passes off-chain
has passed; mirroring it on-chain publishes that result, and failing to mirror
it does not change it.

## Why not the other way round

Weighting a vote requires the voter's MOC balance at the proposal's snapshot
block. The governance contract holds no token state and cannot verify that
number, so on-chain votes would have to carry a weight supplied by someone —
which is the same trust assumption as recording the tally off-chain, with more
moving parts and gas.

Making the chain authoritative would mean either deploying an `ERC20Votes`
token with checkpoints (MOC is a plain ERC-20 and cannot be changed), or
submitting a Merkle snapshot per proposal and a proof per vote. Both are real
designs; neither is what exists today, and pretending otherwise while the
contract simply trusts whatever the oracle sends is worse than saying plainly
that the oracle is trusted.

## What the contract enforces

Within its own trust model, the contract is not decorative:

- `castVoteFor` is restricted to `ORACLE_ROLE` and keys duplicate detection on
  the **voter**, not on `msg.sender`.
- `finalizeProposal` refuses to run before `votingEndTime`.
- Passing a proposal sets `executionEta`, and `executeProposal` refuses until
  that timelock elapses. Execution is restricted to `EXECUTOR_ROLE`.
- `recordOutcome` refuses for a proposal that has not executed.
- `pause()` stops proposal creation, voting and execution.

These are covered by `packages/contracts/test/OracleGovernance.test.ts`.

### The bug this replaced

`castVote` previously keyed `hasVoted` on `msg.sender`. Every relayed vote is
sent by the API's single signer, so the first vote recorded blocked every other
holder with `Already voted`. The relay path could never have worked past one
vote, which is why it is now `castVoteFor(proposalId, voter, choice, weight)`.

## What the API does today

The API does **not** mirror votes to the chain. `blockchainService` retains
`castVoteFor`, `createProposal`, `finalizeProposal`, `executeProposal` and
`recordOutcome`, but no request path calls them: a partially-mirrored history
is more misleading than none, and per-vote transactions cost gas for a record
nothing currently reads.

The chain is used read-only, for the one thing it is authoritative about:
**MOC balances**, including the historical balance at a proposal's snapshot
block.

## If you want mirroring

Publish settled results, not live ones, and make it idempotent:

1. After `finalizeProposal` succeeds off-chain, create the proposal on-chain
   with the same decision-packet hash, quorum and threshold.
2. Submit the settled votes with `castVotesFor` in batches, recording the
   returned `onchainId` on the proposal so a retry does not double-submit.
3. Finalize and (after the timelock) execute on-chain.
4. Record the outcome proof once measurements exist.

Reconcile on boot: for any proposal with an `onchainId`, compare the on-chain
tally with the local one and log a divergence rather than silently trusting
either side. Do not make a user-facing request wait on a transaction; a failed
mirror must never fail a vote that has already been accepted.
