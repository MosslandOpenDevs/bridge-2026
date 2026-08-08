# Contributing

The conventions below were already being followed; they had just never been
written down, which is why commits before August 2026 look different from the
ones after.

## Licensing

This project is under the **Business Source License 1.1** — source-available,
not open source. It converts to Apache 2.0 on the Change Date (2029-07-05).
Read `LICENSE` before contributing: by opening a pull request you agree your
contribution is licensed on those terms. If you expected OSS because the
repository is public, this is the part to check first.

## Setup

Requires **Node.js ≥ 22** and **pnpm 9**. npm cannot install `nexus` — its
packages reference each other with `workspace:*`, which npm rejects.

```bash
cd oracle && pnpm install --frozen-lockfile && pnpm build && pnpm test
```

**Before you add an LLM key**, read the "Autonomous loop" section of
`oracle/apps/api/.env.example`. With a key set, the API deliberates on detected
issues by itself — five LLM calls each, every `ISSUE_DETECT_INTERVAL` seconds —
and promotes confident results to live proposals. Without one, everything falls
back to a rule-based path and costs nothing. `GET /api/llm/usage` reports what
has actually been spent.

The test suite blanks the LLM keys in the server it spawns, so `pnpm test` will
not bill you even with a populated `.env`. Keep it that way.

## Commits

Conventional commits with a scope: `type(scope): subject`.

Types in use: `fix`, `feat`, `docs`, `test`, `build`, and `ops` for deploy and
operational tooling. `ops` is not a standard conventional-commits type; it is
ours, and it is fine.

Write the subject in the imperative and lower case, describing the effect
rather than the edit — `make the ecosystem bar read right in screen readers`,
not `update Footer.tsx`.

**The body is where the value is.** Lead with *why*: what was wrong, what it
caused, and why this fix rather than another. Include the evidence that it
works — a measurement, a before/after, a test result. The best commits in this
history read like short incident reports, and that is the bar.

Every commit should be one concern. If the body needs the word "also", it is
probably two commits.

### AI co-authorship

Assistant-written commits carry a `Co-Authored-By` trailer. Use **one** stable
string. The history currently holds seven spellings of the same tool, so
`git shortlog` reports it as seven different contributors — if you are
configuring an assistant, pin the trailer rather than letting it name whichever
model happened to run.

### Your email is public

Commit metadata on a public repository is permanent. Set a noreply address
before your first commit:

```bash
git config --global user.email <id>+<username>@users.noreply.github.com
```

GitHub → Settings → Emails → "Keep my email address private" and "Block
command line pushes that expose my email".

## Pull requests

Branch from `main`, open a PR, keep it reviewable. Most PRs here touch ten
files or fewer; one merged at 177 files and 51k changed lines, which nobody
could review as a unit and nobody could revert in part. If a change is large,
split it — the individual commits inside that PR were fine, it was the envelope
that was wrong.

Say what you verified and how. "Tests pass" is weaker than "16/16 e2e green,
and the noise-escalation rate went from 19.4% to 0 over 3,000 trials".

CI runs three jobs: `oracle`, `nexus`, `deploy-script`. **Their names are
load-bearing** — the deploy poller matches `DEPLOY_REQUIRED_CHECKS` against
them, so renaming one means updating the server's configuration in the same
change.

`main` deploys. A merge is a production release.
