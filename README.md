# BRIDGE 2026

> **Where agents propose, people decide, reality updates.**

<p>
  <img alt="Status" src="https://img.shields.io/badge/status-conceptual%20%2B%20MVP-16a34a" />
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
│   │   ├── web/         # Next.js 14 frontend (i18n, wallet, realtime)
│   │   └── api/         # Express + Socket.IO REST API + SQLite
│   ├── packages/
│   │   ├── core/                # shared types & utilities
│   │   ├── reality-oracle/      # L0: signal-collection adapters
│   │   ├── inference-mining/    # L1: issue detectors
│   │   ├── agentic-consensus/   # L2: AI agents + Moderator
│   │   ├── human-governance/    # L3: voting + delegation
│   │   ├── proof-of-outcome/    # L4: outcome tracking
│   │   └── contracts/           # Solidity (OracleGovernance, OracleToken)
│   ├── ecosystem.config.cjs     # pm2 process definitions
│   └── turbo.json               # Turborepo pipeline
│
└── nexus/               # Reference / research implementation
    ├── frontend/        # Next.js 14 DAO interface
    ├── backend/         # NestJS API (signals, proposals, delegation, outcomes)
    ├── reality-oracle/  · inference-mining/ · agentic-consensus/
    ├── human-governance/ (Solidity BridgeLog) · proof-of-outcome/
    ├── atomic-actuation/ · inference-mining/ · integration/
    └── implementation/  # specs: mvp-spec, delegation-policy, project-structure
```

Each sub-package carries its own `README.md`. The **`oracle/`** tree is the actively deployed system; **`nexus/`** is the broader reference decomposition of every layer.

---

## Quick start

> Requires **Node.js ≥ 18**. `oracle` uses **pnpm + Turborepo**; `nexus` sub-apps use **npm**.

### Oracle (production stack)

```bash
cd oracle
pnpm install

# Run everything with pm2 (recommended)
pm2 start ecosystem.config.cjs
#   Web  → http://localhost:3100
#   API  → http://localhost:3101

# …or run apps individually for development
pnpm --filter @oracle/api dev   # Express API
pnpm --filter @oracle/web dev   # Next.js web (port 3100)
```

Copy `oracle/apps/api/.env.example` → `.env` and fill in the values you need
(LLM keys, RPC URL, `ADMIN_API_KEY`, etc.). See
[Security posture](#security-posture) for the settings that harden a real
deployment. Blockchain wiring is documented in
[`oracle/docs/BLOCKCHAIN_SETUP.md`](oracle/docs/BLOCKCHAIN_SETUP.md).

### Nexus (reference stack)

```bash
# Frontend
cd nexus/frontend && npm install && npm run dev

# Backend (NestJS)
cd nexus/backend && npm install && npm run start:dev
```

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
- **Vote authenticity** — votes can be gated behind **EIP-191 signature
  verification** with nonce + timestamp **replay protection**, and behind
  on-chain **Moss Coin balance** eligibility checks.
- **Admin-gated mutations** — sensitive endpoints (signal collection, issue
  detection, proposal finalize/execute, outcome recording) require
  `ADMIN_API_KEY`.
- **On-chain safety** — `OracleGovernance.sol` uses OpenZeppelin
  `AccessControl`, `ReentrancyGuard`, and `Pausable`, with an
  **execution timelock** between a proposal passing and executing.

> **Demo vs. production.** With no `ADMIN_API_KEY`, no RPC, and signatures set
> to `auto`, the API runs in an open **demo mode** for local exploration — do
> not expose that configuration publicly. For any real deployment set
> `ADMIN_API_KEY`, enable MOC verification (`MAINNET_RPC_URL`), and set
> `REQUIRE_VOTE_SIGNATURE=always`. See
> [`oracle/apps/api/.env.example`](oracle/apps/api/.env.example).

Found a vulnerability? Please email **security@moss.land** rather than opening a
public issue.

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
- Working MVP implementations of the governance loop (mock/demo data)

It does **not** claim the existence of production-grade autonomous
infrastructure. All dashboard figures, events, and KPIs in the UI are mockups
unless wired to live adapters.

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
