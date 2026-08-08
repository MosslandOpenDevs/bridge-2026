# BRIDGE 2026

> **Where agents propose, people decide, reality updates.**

### 🟢 Live: [bridge.moss.land](https://bridge.moss.land)

<p>
  <img alt="Status" src="https://img.shields.io/badge/status-live%20MVP%20%2B%20spec-16a34a" />
  <img alt="License" src="https://img.shields.io/badge/license-BUSL--1.1-052e16" />
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-14-black" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178c6" />
  <a href="https://bridge.moss.land"><img alt="Live" src="https://img.shields.io/badge/live-bridge.moss.land-22c55e" /></a>
</p>

**BRIDGE 2026** is a **Physical AI governance OS** where **reality signals become proposals**, **agents reach consensus**, **humans decide**, **execution happens atomically**, and **outcomes are proven on-chain**.

This repository holds both the **vision / conceptual specification** for Mossland's next-generation governance framework **and** working MVP implementations of the governance loop.

**Core Vision**: "Mossland becomes a self-evolving ecosystem where reality is covered with data like moss (Reality Oracle), agents define problems on that data (Inference Mining), communities reach consensus (Agentic Consensus), reality/products are updated (Atomic Actuation), and results are proven (Proof of Outcome)."

**Live Media Layer**: [Alpha](https://alpha.moss.land?utm_source=github&utm_medium=referral&utm_campaign=bridge-readme) (alpha.moss.land) — Mossland's crypto × AI media that consumes upstream signals and surfaces them as channel-stance distributions, AI-synthesized briefs, and a 12-tool MCP server for Claude / Cursor. The kind of user-facing surface BRIDGE 2026's outputs feed into ([alpha repo](https://github.com/MosslandOpenDevs/alpha)).

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
- [Roadmap](#roadmap-high-level)
- [Status](#status)
- [Contributing](#contributing)
- [License](#license)

---

## What BRIDGE 2026 is

Traditional DAOs begin with people:
- Humans propose → humans discuss → humans vote

BRIDGE 2026 begins with **reality** (or reality-equivalent signals):

**Signals → Issues → Agentic Deliberation → Human Decision → Execution → Outcome Proof**

The goal is to design a governance system where:
- Reality continuously generates agenda,
- AI agents assist structured reasoning,
- Humans retain final authority,
- Outcomes are measurable, verifiable, and fed back into governance.

---

## Core governance loop

**Reality Oracle → Inference Mining → Agentic Consensus → Human Governance → Atomic Actuation → Proof of Outcome**

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

This loop is an **operational model** for Mossland's 2026 project, building on Agora (governance) and MAIT (AI decision-making) to create a reality-driven governance system.

---

## Repository structure

This is a monorepo with two complementary implementations of the BRIDGE governance loop, plus this top-level specification.

```
bridge-2026/
├── README.md            # ← this file: vision + specification
├── LICENSE              # Business Source License 1.1
│
├── oracle/              # Production implementation — deployed to bridge.moss.land
│   ├── apps/
│   │   ├── web/         # Next.js 14 frontend (i18n, RainbowKit wallet, realtime)
│   │   └── api/         # Express + Socket.IO REST API + SQLite
│   ├── packages/
│   │   ├── core/                # shared types & utilities
│   │   ├── reality-oracle/      # L0: signal-collection adapters
│   │   ├── inference-mining/    # L1: issue detectors
│   │   ├── agentic-consensus/   # L2: AI agents + Moderator
│   │   ├── human-governance/    # L3: voting + delegation
│   │   ├── proof-of-outcome/    # L4: outcome tracking
│   │   └── contracts/           # Solidity (OracleGovernance, OracleToken)
│   ├── scripts/deploy.sh        # pull-based auto-deploy (pm2 cron one-shot)
│   ├── deploy/README.md         # deployment architecture & operations
│   ├── ecosystem.config.cjs     # pm2 process definitions (incl. bridge-deploy)
│   └── turbo.json               # Turborepo pipeline
│
└── nexus/               # Reference / research implementation
    ├── frontend/        # Next.js 14 DAO interface
    ├── backend/         # NestJS API (signals, proposals, delegation, outcomes)
    ├── reality-oracle/  · inference-mining/ · agentic-consensus/
    ├── human-governance/ (Solidity BridgeLog) · proof-of-outcome/
    ├── atomic-actuation/ · infrastructure/ · integration/ · shared/
    └── implementation/  # specs: mvp-spec, delegation-policy, project-structure
```

Each sub-package carries its own `README.md`. The **`oracle/`** tree is the actively deployed system; **`nexus/`** is the broader reference decomposition of every layer.

---

## Quick start

> Requires **Node.js ≥ 22** (CI builds on 22; 24 and 26 also work). Both trees
> use **pnpm**: `oracle` with Turborepo, `nexus` as a plain pnpm workspace. npm
> cannot install `nexus` — its packages depend on each other with
> `workspace:*`, which npm rejects outright.

### Oracle (production stack)

```bash
cd oracle
pnpm install
pnpm --filter "@oracle/web..." build   # web needs a production build for pm2

# Run the web + API with pm2 (recommended)
pm2 start ecosystem.config.cjs --only oracle-api,oracle-web
#   Web  → http://localhost:3100
#   API  → http://localhost:3101
#   (bridge-deploy in the same file is the server-side auto-deployer — do not start it locally)

# …or run apps individually for development
PORT=3101 pnpm --filter @oracle/api dev   # Express API (defaults to 4000 without PORT)
pnpm --filter @oracle/web dev             # Next.js web (port 3100)
```

Copy `oracle/apps/api/.env.example` → `oracle/apps/api/.env` and fill in the values you need
(LLM keys, RPC URL, `ADMIN_API_KEY`, etc.). **Adding an LLM key starts an
autonomous loop that spends money** — the server deliberates on newly detected
issues by itself, five LLM calls each, every `ISSUE_DETECT_INTERVAL` seconds,
and promotes the confident ones to live proposals. Without a key it all falls
back to a rule-based path and costs nothing. Set `AUTO_DELIBERATE_ENABLED=0` to
keep detection without the spend, and check `GET /api/llm/usage` for what it
has actually used. **MOC verification is on by
default** — the API falls back to a public Ethereum RPC for read-only Moss
Coin balance checks, so votes require a wallet signature and a nonzero MOC
balance out of the box. Set `MAINNET_RPC_URL=off` for an open demo mode. See
[Security posture](#security-posture) for the settings that harden a real
deployment. Blockchain wiring is documented in
[`oracle/docs/BLOCKCHAIN_SETUP.md`](oracle/docs/BLOCKCHAIN_SETUP.md).

### Nexus (reference stack)

One install at the workspace root wires every package together and builds the
shared types the others compile against.

```bash
cd nexus
pnpm install

# Frontend (Next.js)
pnpm --filter @bridge-2026/frontend dev

# Backend (NestJS)
pnpm --filter @bridge-2026/backend start:dev
```

Nexus is a reference decomposition of every governance layer, not the deployed
system — `oracle/` is what runs in production, and the deploy script treats
`nexus/**` as documentation. Its per-layer packages do not all compile yet; see
[`nexus/README.md`](nexus/README.md) for what is buildable today.

---

## Tech stack

| Area        | Technology                                                        |
|-------------|-------------------------------------------------------------------|
| Frontend    | Next.js 14 (App Router), React 18, TailwindCSS, next-intl         |
| Wallet / chain | wagmi, viem, RainbowKit, Ethereum, ERC-20 (Moss Coin)          |
| Backend     | Node.js, Express + Socket.IO (oracle), NestJS (nexus), SQLite     |
| AI          | Claude API / OpenAI / Ollama (pluggable LLM providers)            |
| Contracts   | Solidity ^0.8.24, OpenZeppelin (AccessControl, ReentrancyGuard)   |
| Tooling     | TypeScript 5, Turborepo, pnpm, pm2, nginx                         |

**Moss Coin (MOC)** — Ethereum mainnet ERC-20, `0x8bbfe65e31b348cd823c62e02ad8c19a84dd0dab`.

---

## Conceptual layers

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

Governance authority is **never fully automated**.

### 5) Proof of Outcome
Governance decisions are evaluated after execution.

- Outcomes are measured against predefined KPIs
- Results are recorded in an auditable manner
- Historical outcomes inform future trust, reputation, and delegation

Governance is treated as a **learning system**, not a static process.

---

## Security posture

BRIDGE is a governance system that touches votes and (eventually) value, so the
implementations ship with defense-in-depth and honest boundaries:

- **API hardening** — `helmet`, a strict CORS allowlist, tiered
  `express-rate-limit` (global / LLM / vote), a 100 KB body cap, and
  production error sanitization (no stack-trace leakage).
- **Vote authenticity (on by default)** — votes are gated behind **EIP-191
  signature verification** with nonce + timestamp **replay protection**, and
  behind on-chain **Moss Coin balance** eligibility checks (balance = voting
  weight). The web app connects real wallets via RainbowKit/wagmi and signs
  each vote.
- **Admin-gated mutations** — sensitive endpoints (signal collection, issue
  detection, proposal finalize/execute, outcome recording) require
  `ADMIN_API_KEY`.
- **On-chain safety** — `OracleGovernance.sol` uses OpenZeppelin
  `AccessControl`, `ReentrancyGuard`, and `Pausable`, with an
  **execution timelock** between a proposal passing and executing.

> **Default vs. demo.** MOC verification defaults **on** via a public
> Ethereum RPC, which also turns vote signatures on (`REQUIRE_VOTE_SIGNATURE`
> defaults to `auto`). Set `MAINNET_RPC_URL=off` to run an open **demo mode**
> for local exploration — do not expose that configuration publicly. For a
> hardened deployment additionally set `ADMIN_API_KEY`, and prefer a dedicated
> RPC (Alchemy/Infura) over the public fallback for reliability. See
> [`oracle/apps/api/.env.example`](oracle/apps/api/.env.example).

Found a vulnerability? Please email **security@moss.land** rather than opening a
public issue.

---

## Deployment

[bridge.moss.land](https://bridge.moss.land) runs the `oracle/` stack behind an
nginx front (SSL, `/api` + `/socket.io` proxied to the API, everything else to
the web app). The API exposes `GET /api/health` for uptime monitoring.

Deploys are **pull-based**: a one-shot script
([`oracle/scripts/deploy.sh`](oracle/scripts/deploy.sh)) runs on the app server
every 5 minutes as the pm2 app `bridge-deploy`. When `origin/main` moves it
classifies the diff, snapshots the SQLite DB, rebuilds only what changed,
restarts the affected pm2 apps, health checks, and **rolls back automatically**
on failure. Merging code to `main` is deploying; **docs-only merges only sync
the server checkout** (logged as `SYNCED`, not `DEPLOYED`) — nothing is built
or restarted. Operations detail:
[`oracle/deploy/README.md`](oracle/deploy/README.md).

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

## Roadmap (high-level)

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

This repository currently represents:
- Vision and research direction
- Conceptual and specification-level design
- A working MVP of the governance loop, **live at
  [bridge.moss.land](https://bridge.moss.land)**

What is real on the live deployment today:
- **Signal collection** — live adapters (MOC price/market, on-chain activity,
  Mossland disclosure, Medium, GitHub, …) have accumulated 600k+ signals
- **Token-gated voting** — wallet connect, EIP-191-signed votes, voting weight
  read from on-chain MOC balance
- **Auto-deploy** — merges to `main` roll out automatically with health checks
  and rollback

What is not yet enabled:
- **On-chain recording** — proposals/votes are not yet anchored to the
  `OracleGovernance` contract (requires contract deployment and a funded
  signer); outcome KPIs shown in the UI remain illustrative

It does **not** claim the existence of production-grade autonomous
infrastructure.

---

## Contributing

Issues and pull requests are welcome. For substantial changes, open an issue
first to discuss direction. Please keep the design principles above in mind —
in particular **human sovereignty** and **auditability**. Security reports go
to **security@moss.land** (see [Security posture](#security-posture)).

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
