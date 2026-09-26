# Where governance state lives

## Status (2026-09-26)

- **Nothing is mirrored on-chain.** `OracleGovernance` has never been
  deployed, and no request path calls the blockchain write methods.
- **BRIDGE's own voting and delegation are disabled by default** ([#34](https://github.com/MosslandOpenDevs/bridge-2026/pull/34)): with
  `VOTING_ENABLED` unset the write endpoints answer `410` with
  `code: "VOTING_MOVED_TO_AGORA"`. In production the `votes` and `delegations`
  tables have never held a row.
- **Mossland DAO's binding votes happen on [Agora](https://agora.moss.land)**,
  not here: EIP-712-signed, weighted by `getPastVotesOrBalance` at the
  proposal's snapshot. BRIDGE proposals are non-binding.

The rest of this document is the design BRIDGE's voting follows if an operator
turns it back on.

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

Making the chain authoritative would mean either having the contract read
checkpointed voting power from the token itself, or submitting a Merkle
snapshot per proposal and a proof per vote. Neither is what exists here, and
pretending otherwise while the contract simply trusts whatever the oracle sends
is worse than saying plainly that the oracle is trusted.

### MOC is not a plain ERC-20

An earlier version of this document said MOC "is a plain ERC-20 and cannot be
changed", which ruled out the first option. That was wrong. MOC
(`0x8bbfe65e31b348cd823c62e02ad8c19a84dd0dab`) implements `ERC20Votes`:
`getPastVotes`, `getPastTotalSupply`, `delegates` and `numCheckpoints` all
answer `eth_call` on mainnet, while a selector the token does not implement
reverts (checked 2026-09-26). Agora builds on these checkpoints: it weights
each vote by `getPastVotesOrBalance` at the proposal's snapshot.

So checkpointed voting power is available on-chain, and a governance design
that reads it does not need an oracle to supply weights. The reason BRIDGE does
not build one is not a limit of the token: binding voting for Mossland DAO
already exists on Agora, and a second binding vote would compete with it.

One consequence if BRIDGE voting is ever re-enabled: its snapshot weighting
(`getMocBalanceAt` in `apps/api/src/blockchain.ts`) reads `balanceOf` at the
snapshot block. That needs an archive-capable RPC — the free public default
cannot serve it — and it ignores `ERC20Votes` delegation, so its weights would
not match Agora's for a holder who has delegated.

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

BRIDGE voting is disabled by default (see [Status](#status-2026-09-26)).
When it is on, the API still does **not** mirror votes to the chain.
`blockchainService` retains
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
   The contract has no `Expired` status: its `finalizeProposal` sets
   `Rejected` for anything that did not pass, quorum or not. Off-chain, a
   proposal that closed without reaching quorum is `expired`, and one that
   reached quorum but missed the threshold is `rejected`. An off-chain
   `expired` therefore mirrors as on-chain `Rejected`; that is the contract's
   coarser vocabulary, not a divergence to reconcile. Better still, do not
   mirror expired proposals at all — there is no settled vote to publish.
4. Record the outcome proof once measurements exist.

Reconcile on boot: for any proposal with an `onchainId`, compare the on-chain
tally with the local one and log a divergence rather than silently trusting
either side. Do not make a user-facing request wait on a transaction; a failed
mirror must never fail a vote that has already been accepted.
