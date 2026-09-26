# BRIDGE 2026

<!-- opendevs-badges:start -->
[![Lifecycle: Lab](https://img.shields.io/badge/Lifecycle-Lab-eab308?style=flat)](https://links.moss.land/ecosystem-registry.json)
[![CI](https://github.com/MosslandOpenDevs/bridge-2026/actions/workflows/ci.yml/badge.svg)](https://github.com/MosslandOpenDevs/bridge-2026/actions/workflows/ci.yml)
[![Website: bridge.moss.land](https://img.shields.io/badge/Website-bridge.moss.land-2563eb?style=flat)](https://bridge.moss.land/)
[![License: BUSL-1.1](https://img.shields.io/badge/License-BUSL--1.1-64748b?style=flat)](https://github.com/MosslandOpenDevs/bridge-2026/blob/main/LICENSE)
<!-- opendevs-badges:end -->

> **Status of this repository:** **`Lifecycle: Lab`** (실험, best-effort) — per [MIP-1](https://agora.moss.land/proposals/6a85129f8be190cf5d2ebcc1), ratified 2026-09-02, and the [links.moss.land registry](https://links.moss.land/ecosystem-registry.json) entry `bridge`. May change or stop without notice.

> **Reality-signal governance lab.**

### Live: [bridge.moss.land](https://bridge.moss.land)

**What runs today.** BRIDGE collects Mossland's public signals every minute —
MOC price and market data, on-chain activity, Mossland disclosures and roadmap,
GitHub commits, Medium posts — and runs rule-based detectors over them every
five minutes to flag anomalies and trends as issues. AI agents deliberate on an
issue only when an admin asks for it. BRIDGE's own voting and delegation are
off: Mossland DAO's binding decisions are made on
[Agora](https://agora.moss.land), and BRIDGE proposals are non-binding. Nothing
is executed or recorded on-chain. Demo data is labelled wherever it appears
and hidden from the proposals list by default, and `/api/health` reports
whether collection is actually keeping up. The
numbers are in [Status](#status).

<a id="direction-under-review"></a>**Direction under review.** Whether BRIDGE continues, and as what, is open. The
option on the table is a trial as a read-only tracker of dated commitments —
from Agora decisions and the Mossland disclosures
[`TRACKING.md`](https://github.com/mossland/Disclosure-and-Materials/blob/main/disclosures/TRACKING.md) —
with three gates: **2026-10-20** (the owner's answer), **2026-11-20** (evidence
that anyone outside the project uses it) and **2026-12-21** (keep it, move it to
a GitHub Action, or archive it). This is a review, not a commitment. MIP-1 lists
BRIDGE as a Lab service; the registry names no maintainer yet.

**Long-term vision (not what runs today).** The design this repository started
from is a governance loop where reality signals become proposals, agents
deliberate, humans decide, execution follows, and outcomes are measured and
fed back: "reality is covered with data like moss (Reality Oracle), agents
define problems on that data (Inference Mining), communities reach consensus
(Agentic Consensus), reality/products are updated (Atomic Actuation), and
results are proven (Proof of Outcome)". The sections marked *design concept*
below describe that vision. Only the first two stages run in production.

Related: [Alpha](https://alpha.moss.land?utm_source=github&utm_medium=referral&utm_campaign=bridge-readme)
(alpha.moss.land), Mossland's crypto × AI media, is a separate project
([alpha repo](https://github.com/MosslandOpenDevs/alpha)).

---

## Table of contents

- [What BRIDGE 2026 is](#what-bridge-2026-is)
- [Core governance loop](#core-governance-loop)
- [Repository structure](#repository-structure)
- [Quick start](#quick-start)
- [Tech stack](#tech-stack)
- [Conceptual layers](#conceptual-layers)
- [Security posture](#security-posture)
- [Deployment](#deployment)
- [2026 scope (design intent)](#2026-scope-design-intent)
- [Design principles](#design-principles)
- [Roadmap](#roadmap-original-design)
- [Status](#status)
- [Contributing](#contributing)
- [License](#license)

---

## What BRIDGE 2026 is

*Design concept.* Traditional DAOs begin with people:
- Humans propose → humans discuss → humans vote

BRIDGE 2026 was designed to begin with **reality** (or reality-equivalent
signals):

**Signals → Issues → Agentic Deliberation → Human Decision → Execution → Outcome Proof**

The goal is a governance system where:
- Reality continuously generates agenda,
- AI agents assist structured reasoning,
- Humans retain final authority,
- Outcomes are measurable, verifiable, and fed back into governance.

In production today only the first step runs on its own: signals become
issues automatically. Deliberation happens when an admin asks for it, the human
decision happens on Agora rather than here, and execution and outcome proof do
not happen.

---

## Core governance loop

*Design concept.* **Reality Oracle → Inference Mining → Agentic Consensus →
Human Governance → Atomic Actuation → Proof of Outcome**

```
   Reality        Inference       Agentic         Human
   Oracle   ──▶   Mining    ──▶   Consensus  ──▶  Governance
  (signals)      (issues)        (agent debate)  (MOC vote)
      │                                               │
      │                                               ▼
      │                                        Atomic Actuation
      │                                          (execution)
      │                                               │
      └──────────────  Proof of Outcome  ◀────────────┘
                       (KPI proof / reputation)
```

What each stage does in production is in [Status](#status). In short: the
first two run automatically, Agentic Consensus runs when an admin asks, and the
last three are off or have never been used.

---

## Repository structure

```
bridge-2026/
├── README.md            # ← this file
├── CONTRIBUTING.md      # commit and PR conventions
├── LICENSE              # Business Source License 1.1
│
└── oracle/              # The deployed stack — bridge.moss.land
    ├── apps/
    │   ├── web/         # Next.js 14 frontend (i18n, realtime; wallet UI off by default)
    │   └── api/         # Express + Socket.IO REST API + SQLite
    ├── packages/
    │   ├── core/                # shared types & utilities
    │   ├── reality-oracle/      # L0: signal-collection adapters
    │   ├── inference-mining/    # L1: issue detectors
    │   ├── agentic-consensus/   # L2: AI agents + Moderator
    │   ├── human-governance/    # L3: voting + delegation (disabled in the API by default)
    │   ├── proof-of-outcome/    # L4: outcome tracking
    │   └── contracts/           # Solidity (OracleGovernance, OracleToken) — never deployed
    ├── docs/                    # on-chain state, blockchain setup, upgrade runbook
    ├── scripts/deploy.sh        # pull-based auto-deploy (pm2 cron one-shot)
    ├── deploy/README.md         # deployment architecture & operations
    ├── ecosystem.config.cjs     # pm2 process definitions (incl. bridge-deploy)
    └── turbo.json               # Turborepo pipeline
```

`nexus/`, a reference decomposition of every layer that was never deployed, is
removed from `main` by [#33](https://github.com/MosslandOpenDevs/bridge-2026/pull/33) and preserved at the tag
[`archive/nexus-2026-09`](https://github.com/MosslandOpenDevs/bridge-2026/tree/archive/nexus-2026-09).
To look at it: `git fetch --tags && git checkout archive/nexus-2026-09`.

---

## Quick start

> Requires **Node.js ≥ 22** (CI builds on 22; 24 and 26 also work) and
> **pnpm 9**. npm cannot install `oracle` — its packages depend on each other
> with `workspace:*`, which npm rejects.

```bash
cd oracle
pnpm install --frozen-lockfile
pnpm --filter "@oracle/web..." build   # web needs a production build for pm2
pnpm --filter "@oracle/api..." build   # pm2 runs the API from apps/api/dist

# Run the web + API with pm2 (recommended)
pm2 start ecosystem.config.cjs --only oracle-api,oracle-web
#   Web  → http://localhost:3100
#   API  → http://localhost:3101
#   (bridge-deploy in the same file is the server-side auto-deployer — do not start it locally)

# …or run apps individually for development
PORT=3101 pnpm --filter @oracle/api dev   # Express API (defaults to 4000 without PORT)
pnpm --filter @oracle/web dev             # Next.js web (port 3100)
```

Copy `oracle/apps/api/.env.example` → `oracle/apps/api/.env` and fill in the
values you need (`ADMIN_API_KEY`, LLM keys, etc.). **Adding an LLM key does not
start the autonomous loop** — automatic deliberation, auto-promotion to
proposals and outcome scoring are all off by default. A key only makes the
deliberations and debates you request (`POST /api/deliberate`,
`POST /api/debate`) use the LLM; signal collection and issue detection run
either way. `AUTO_DELIBERATE_ENABLED=1` opts in to deliberating every newly
detected high-priority issue — five LLM calls each, every
`ISSUE_DETECT_INTERVAL` seconds — and `AUTO_PROPOSAL_ENABLED=1` additionally
opens the confident ones as live proposals; read the "Autonomous loop" section
of `.env.example` first. Check `GET /api/llm/usage` for what has actually been
spent.

**Voting and delegation are off by default** ([#34](https://github.com/MosslandOpenDevs/bridge-2026/pull/34)). The vote and delegation
write endpoints answer `410 Gone` with `code: "VOTING_MOVED_TO_AGORA"`, and the
web build hides the wallet button and the vote UI and turns `/delegation` into
an Agora notice. To
experiment with them locally, set `VOTING_ENABLED=1` for the API and
`NEXT_PUBLIC_VOTING_ENABLED=1` for the web build; the steps are in
`.env.example`. Once on, votes are checked against MOC balances through a
public Ethereum RPC by default, and the default snapshot weighting needs an
archive-capable `MAINNET_RPC_URL`. Blockchain wiring is documented in
[`oracle/docs/BLOCKCHAIN_SETUP.md`](oracle/docs/BLOCKCHAIN_SETUP.md); that
contract path is not deployed.

---

## Tech stack

| Area        | Technology                                                        |
|-------------|-------------------------------------------------------------------|
| Frontend    | Next.js 14 (App Router), React 18, TailwindCSS, next-intl         |
| Wallet / chain | viem (read-only MOC balances); wagmi + RainbowKit, behind `NEXT_PUBLIC_VOTING_ENABLED` |
| Backend     | Node.js, Express + Socket.IO, SQLite (better-sqlite3)             |
| AI          | Claude API / OpenAI / Ollama (pluggable LLM providers)            |
| Contracts   | Solidity ^0.8.24, OpenZeppelin (AccessControl, ReentrancyGuard) — not deployed |
| Tooling     | TypeScript 5, Turborepo, pnpm, pm2, nginx                         |

**Moss Coin (MOC)** — Ethereum mainnet ERC-20 with `ERC20Votes` checkpoints,
`0x8bbfe65e31b348cd823c62e02ad8c19a84dd0dab`. See
[`oracle/docs/on-chain-state.md`](oracle/docs/on-chain-state.md).

---

## Conceptual layers

*Design concept.* These describe what each layer was designed to do. For what
each one does in production, see [Status](#status).

### 1) Reality Oracle
Transforms real-world or system-level signals into **verifiable governance inputs**.

Examples of signals:
- On-chain governance activity
- Community presence or participation proofs
- Public datasets (e.g. city, environment, usage metrics)
- Product or development telemetry

Key idea: signals are **normalized, attested, and auditable**.

### 2) Inference Mining
Extracts **issues** from raw signals.

- Identifies anomalies, trends, or governance-relevant changes
- Groups evidence into structured problem statements
- Produces machine-assisted proposal drafts

This layer defines *what should be discussed*.

### 3) Agentic Consensus
Multiple AI agents deliberate over identified issues. Each agent represents a distinct perspective — Risk & security, Treasury & resource allocation, Community impact, Product feasibility — and a moderator role synthesizes deliberation into a single **Decision Packet** (recommendation, alternatives, risks, KPIs, dissenting opinions).

Agents assist reasoning; they do not replace human authority.

### 4) Human Governance
Humans remain the final decision-makers.

- Explicit approval or rejection by token holders
- Optional **policy-based delegation**, not unrestricted automation
- Clear visibility into agent reasoning and uncertainty

Governance authority is **never fully automated**. For Mossland DAO that
authority sits on [Agora](https://agora.moss.land), not in BRIDGE.

### 5) Proof of Outcome
Governance decisions are evaluated after execution.

- Outcomes are measured against predefined KPIs
- Results are recorded in an auditable manner
- Historical outcomes inform future trust, reputation, and delegation

Governance is treated as a **learning system**, not a static process.

---

## Security posture

The API is public and holds the only copy of BRIDGE's state, so it ships with
defense-in-depth and honest boundaries:

- **API hardening** — `helmet`, a strict CORS allowlist, tiered
  `express-rate-limit` (global / LLM / vote), a 100 KB body cap, and
  production error sanitization (no stack-trace leakage).
- **Voting is disabled by default** — with `VOTING_ENABLED` unset, the vote
  and delegation write endpoints refuse every request with `410`. When an
  operator turns voting on, votes are gated behind **EIP-191 signature
  verification** with nonce + timestamp **replay protection**, and behind
  on-chain **Moss Coin balance** eligibility checks (balance at the proposal's
  snapshot block = voting weight); delegations always require a wallet
  signature in production.
- **Admin-gated mutations** — sensitive endpoints (signal collection, issue
  detection, deliberation and debate, proposal creation/finalize/execute,
  outcome recording) require `ADMIN_API_KEY`, and the API refuses to start in
  production without one.
- **No on-chain writes** — `OracleGovernance.sol` (OpenZeppelin
  `AccessControl`, `ReentrancyGuard`, `Pausable`, execution timelock) has never
  been deployed, and no request path calls the blockchain write methods. The
  chain is read only for MOC balances.

> **Default vs. demo.** MOC verification defaults **on** via a public Ethereum
> RPC, which also turns vote signatures on (`REQUIRE_VOTE_SIGNATURE` defaults
> to `auto`); both matter only once voting is enabled. `MAINNET_RPC_URL=off`
> runs an open **demo mode** for local exploration — do not expose that
> configuration publicly. See
> [`oracle/apps/api/.env.example`](oracle/apps/api/.env.example).

Found a vulnerability? Please email **security@moss.land** rather than opening a
public issue.

---

## Deployment

[bridge.moss.land](https://bridge.moss.land) runs the `oracle/` stack behind an
nginx front (SSL, `/api` + `/socket.io` proxied to the API, everything else to
the web app). The API exposes `GET /api/health` for uptime monitoring: it
answers 200 while the process is up, with a derived `status` and a `reason`
in the body: `down` when the database cannot be read, `degraded` when
collection is on but no observed signal has landed within `staleAfterSeconds`
(180 s by default), `ok` otherwise. Monitors that read only the HTTP code
should poll `GET /api/health?strict=1`, which answers 503 only for `down`.

Deploys are **pull-based**: a one-shot script
([`oracle/scripts/deploy.sh`](oracle/scripts/deploy.sh)) runs on the app server
every 5 minutes as the pm2 app `bridge-deploy`. When `origin/main` moves it
classifies the diff, snapshots the SQLite DB, rebuilds only what changed,
restarts the affected pm2 apps, health checks, and **rolls back automatically**
on failure. Merging code to `main` is deploying; **docs-only merges only sync
the server checkout** (logged as `SYNCED`, not `DEPLOYED`) — nothing is built
or restarted. Operations detail:
[`oracle/deploy/README.md`](oracle/deploy/README.md).

Backups: the pre-deploy snapshots are the only copies taken automatically. A
daily verified backup (`bridge-db-backup`, [#35](https://github.com/MosslandOpenDevs/bridge-2026/pull/35)) is available but does nothing
until an operator starts it, and nothing is copied off the host yet.

---

## 2026 scope (design intent)

### Included
- Conceptual definition of reality-driven governance
- Specification-level data models
- Policy-based delegation principles
- Safety boundaries for automation
- Roadmap alignment with Physical AI and Digital Twin expansion

### Explicitly excluded
- Fully autonomous treasury control
- Agent-only governance
- Direct control of physical infrastructure or robotics
- Claims of production readiness

---

## Design principles

- **Human sovereignty**: AI assists; humans decide
- **Auditability first**: every step must be inspectable
- **Gradual automation**: delegation before autonomy
- **Reality grounding**: governance starts from measurable signals
- **Reversibility**: rollback and dissent are first-class concepts

---

## Roadmap (original design)

This is the roadmap the project was designed around. It is not a plan of
record: the [direction review](#direction-under-review) and its gates decide what
happens next.

### 2026
- Reality-driven agenda generation
- Agent-assisted deliberation
- Policy-based delegation
- Outcome measurement as governance feedback

### 2027+
- Digital Twin signal adapters
- More granular outcome proofs
- Expanded actuation domains under strict safety policies

### 2028+
- Physical AI integration (robots, embodied systems)
- Safety-governed real-world actuation
- Cross-domain governance automation

---

## Status

As of 2026-09-26, from `GET https://bridge.moss.land/api/stats` and the
production database. Stage by stage, with more detail in
[`oracle/PROGRESS.md`](oracle/PROGRESS.md):

| Stage | In production | Evidence |
|---|---|---|
| Signal collection | **Automatic**, every 60 s | 885k observed rows from three adapters (Mossland, GitHub, Medium), about 9.5k a day |
| Issue detection | **Automatic**, every 300 s | 754 observed issue rows, which are 12 distinct conditions |
| AI deliberation | **Admin request only** | `AUTO_DELIBERATE_ENABLED` defaults off ([#29](https://github.com/MosslandOpenDevs/bridge-2026/pull/29)) |
| Proposals | **Admin only** | `AUTO_PROPOSAL_ENABLED` defaults off ([#29](https://github.com/MosslandOpenDevs/bridge-2026/pull/29)); 21 real proposals, 1 active and 20 expired |
| Voting / delegation | **Off** ([#34](https://github.com/MosslandOpenDevs/bridge-2026/pull/34)) — binding votes happen on [Agora](https://agora.moss.land) | 0 votes and 0 delegations, ever |
| Execution | **Never used** | 0 executions |
| Outcome proof | **Off** | `OUTCOME_EVAL_ENABLED` defaults off ([#29](https://github.com/MosslandOpenDevs/bridge-2026/pull/29)); 0 outcome proofs |
| On-chain recording | **None** | `OracleGovernance` never deployed; no caller of the write paths |

What that means in practice:

- **Signals are live, and mostly repeats.** About 99% of observed rows repeat
  the previous minute's reading. After [#39](https://github.com/MosslandOpenDevs/bridge-2026/pull/39) an observed signal is stored only
  when it changes (about 340 rows a day instead of about 9.5k). [#37](https://github.com/MosslandOpenDevs/bridge-2026/pull/37) fixes two
  collector artefacts: the per-document "new disclosure" event shared a
  category with the disclosure total, which is where 18 of the 21 real
  proposals came from, and the MOC price alert re-fired every minute and lost
  its sign. [#40](https://github.com/MosslandOpenDevs/bridge-2026/pull/40) adds an operator-run compaction script for the rows already
  stored; running it is a separate decision.
- **Issue counts overstate conditions.** The 754 issue rows are 12 distinct
  conditions; [#41](https://github.com/MosslandOpenDevs/bridge-2026/pull/41) adds `issues.conditions` to `/api/stats` and shows that
  number on the home page.
- **Demo data is labelled.** 223,074 synthetic signals (none newer than
  2026-08-08), 3,057 synthetic issues and 143 synthetic proposals are counted
  apart from observed data in `/api/stats`, carry a "synthetic" label on the
  signals and issues pages, and are hidden from the proposals page by default (`?synthetic=exclude|only|include`, [#31](https://github.com/MosslandOpenDevs/bridge-2026/pull/31)). The site carries a
  persistent AI-content notice ([#32](https://github.com/MosslandOpenDevs/bridge-2026/pull/32)).
- **Proposals are non-binding.** A proposal whose voting period ends without
  quorum is `expired` ([#29](https://github.com/MosslandOpenDevs/bridge-2026/pull/29)); every closed proposal so far has expired, 163 of
  the 164 including demo ones.
- **Health is derived.** `/api/health` reports `ok`, `degraded` or `down`
  from whether the database reads and how old the newest observed signal is
  ([#30](https://github.com/MosslandOpenDevs/bridge-2026/pull/30)); the deploy gate uses `?strict=1`.
- **Auto-deploy** — merges to `main` roll out automatically with health checks
  and rollback.

It does **not** claim the existence of production-grade autonomous
infrastructure.

---

## Contributing

Issues and pull requests are welcome; read [`CONTRIBUTING.md`](CONTRIBUTING.md)
first. For substantial changes, open an issue first to discuss direction,
especially while the [direction review](#direction-under-review) is open. Please
keep the design principles above in mind — in particular **human sovereignty**
and **auditability**. Security reports go to **security@moss.land** (see
[Security posture](#security-posture)).

---

## License

This project is licensed under the **Business Source License 1.1 (BUSL-1.1)**.

- Source code and specifications are publicly available for research,
  community, and non-commercial use.
- Commercial use or deployment of competing governance or protocol services is
  restricted until the Change Date.
- On the Change Date, the project converts to the **Apache License 2.0**.

See the [`LICENSE`](LICENSE) file for full terms.

---

© 2025, 2026 MOSSLAND
