/**
 * ORACLE API end-to-end suite.
 *
 * Self-contained: it builds nothing, starts its own API process on a free port
 * against a throwaway SQLite file, and shuts it down afterwards. Run with
 * `pnpm test` from apps/api — no server needs to be running first.
 *
 * The previous version required an externally started server (so it scored
 * 0/16 on a clean checkout), sent malformed addresses in loops without
 * checking the responses, and declared a "full workflow" pass while every vote
 * in it had been rejected. Every request here is asserted on.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_ROOT = join(__dirname, "..");
const ADMIN_KEY = "e2e-admin-key-0123456789";

let baseUrl = "";
let server: ChildProcess | undefined;
let dataDir = "";
const serverLog: string[] = [];

/* ------------------------------ harness ------------------------------ */

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}
const results: TestResult[] = [];

async function runTest(name: string, testFn: () => Promise<void>) {
  const start = Date.now();
  try {
    await testFn();
    results.push({ name, passed: true, duration: Date.now() - start });
    console.log(`✅ ${name}`);
  } catch (error: any) {
    results.push({
      name,
      passed: false,
      error: error?.message ?? String(error),
      duration: Date.now() - start,
    });
    console.log(`❌ ${name}: ${error?.message ?? error}`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertStatus(response: Response, expected: number, context: string) {
  assert(
    response.status === expected,
    `${context}: expected HTTP ${expected}, got ${response.status}`,
  );
}

async function request(
  path: string,
  options: RequestInit & { admin?: boolean } = {},
): Promise<{ response: Response; data: any }> {
  const { admin, ...init } = options;
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(admin ? { "x-admin-api-key": ADMIN_KEY } : {}),
      ...init.headers,
    },
  });
  const text = await response.text();
  let data: any = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { response, data };
}

const get = (path: string, admin = false) => request(path, { admin });
const post = (path: string, body?: unknown, admin = true) =>
  request(path, {
    method: "POST",
    admin,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const del = (path: string, body?: unknown, admin = true) =>
  request(path, {
    method: "DELETE",
    admin,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, () => {
      const address = srv.address();
      const port = typeof address === "object" && address ? address.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Boot an API process. Reused for the restart test, which needs a second
 * process over the same database file, so the port and data directory are only
 * allocated on the first call.
 */
async function startServer(overrides: Record<string, string> = {}): Promise<void> {
  if (!dataDir) dataDir = mkdtempSync(join(tmpdir(), "oracle-e2e-"));
  if (!baseUrl) {
    const port = await freePort();
    baseUrl = `http://127.0.0.1:${port}`;
  }
  const port = new URL(baseUrl).port;

  server = spawn(process.execPath, [join(API_ROOT, "dist", "index.js")], {
    cwd: API_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: join(dataDir, "e2e.db"),
      ADMIN_API_KEY: ADMIN_KEY,
      NODE_ENV: "test",
      // The signal assertions need something to collect, and the real adapters
      // reach the network and swallow their own failures. Stated outright so
      // the suite does not quietly start depending on live Mossland/Medium
      // responses if NODE_ENV here ever changes.
      ENABLE_MOCK_SIGNALS: "1",
      // Background jobs off so the suite observes only what it triggers.
      SIGNAL_COLLECT_INTERVAL: "0",
      ISSUE_DETECT_INTERVAL: "0",
      OUTCOME_EVAL_ENABLED: "0",
      AUTO_FINALIZE_INTERVAL: "0",
      // No chain access: demo weights, no signature requirement.
      MAINNET_RPC_URL: "off",
      REQUIRE_VOTE_SIGNATURE: "never",
      REQUIRE_DELEGATION_SIGNATURE: "never",
      // Real lifecycle timings, compressed so the suite can exercise them.
      MIN_VOTING_PERIOD_MS: "500",
      EXECUTION_DELAY_MS: "0",
      KPI_MEASUREMENT_DELAY_MS: "0",
      // Rate limits out of the way of a fast test run.
      RATE_LIMIT_GLOBAL: "100000",
      RATE_LIMIT_VOTE: "100000",
      RATE_LIMIT_LLM: "100000",
      ...overrides,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  server.stdout?.on("data", (chunk) => serverLog.push(String(chunk)));
  server.stderr?.on("data", (chunk) => serverLog.push(String(chunk)));

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(
        `API exited with code ${server.exitCode}:\n${serverLog.join("")}`,
      );
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await sleep(250);
  }
  throw new Error(`API did not become healthy:\n${serverLog.join("")}`);
}

function stopServer(keepData = false) {
  server?.kill("SIGTERM");
  server = undefined;
  if (dataDir && !keepData) {
    rmSync(dataDir, { recursive: true, force: true });
    dataDir = "";
  }
}

/* ------------------------------ fixtures ----------------------------- */

let issueCounter = 0;
function decisionPacket(overrides: Record<string, any> = {}) {
  issueCounter++;
  const issueId = `00000000-0000-4000-8000-${String(issueCounter).padStart(12, "0")}`;
  return {
    id: `10000000-0000-4000-8000-${String(issueCounter).padStart(12, "0")}`,
    issueId,
    issue: {
      id: issueId,
      title: `E2E issue ${issueCounter}`,
      description: "Created by the end-to-end suite",
      category: "governance",
      priority: "high",
      status: "detected",
      detectedAt: new Date().toISOString(),
      signals: [],
      evidence: [],
    },
    consensusScore: 0.9,
    recommendedProposalType: "action",
    recommendation: {
      action: "Take the recommended action",
      rationale: "Because the agents agreed",
      expectedOutcome: "The issue is resolved",
    },
    alternatives: [],
    risks: [],
    kpis: [
      { name: "Resolution time", target: 24, unit: "hours", measurementMethod: "manual" },
      { name: "Recurrence", target: 0, unit: "occurrences", measurementMethod: "manual" },
    ],
    agentOpinions: [],
    dissent: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Distinct, well-formed 20-byte addresses.
 *
 * The tail is padded with `a` so every address contains alphabetic hex digits;
 * a purely numeric address is byte-identical under toUpperCase(), which would
 * make a "same address, different casing" test pass without exercising any
 * canonicalization at all.
 */
function voterAddress(index: number): string {
  const suffix = index.toString(16).padStart(8, "0");
  return `0x${"a".repeat(32)}${suffix}`;
}

async function createProposal(options: Record<string, unknown> = {}) {
  const { response, data } = await post("/api/proposals", {
    decisionPacket: decisionPacket(),
    proposer: voterAddress(0xbeef),
    options: { quorum: 1, threshold: 50, votingPeriod: 800, ...options },
  });
  assertStatus(response, 201, "create proposal");
  assert(data.proposal?.id, "create proposal: no proposal id in response");
  return data.proposal;
}

/* -------------------------------- tests ------------------------------- */

async function testHealthCheck() {
  const { response, data } = await get("/health");
  assertStatus(response, 200, "health");
  assert(data.status === "ok", "health: status should be ok");
  assert(typeof data.version === "string", "health: version should be a string");
}

async function testAdminAuthRequired() {
  const anonymous = await post("/api/signals/collect", undefined, false);
  assertStatus(anonymous.response, 401, "anonymous admin call");

  const wrongKey = await request("/api/signals/collect", {
    method: "POST",
    headers: { "x-admin-api-key": "wrong" },
  });
  assertStatus(wrongKey.response, 401, "admin call with the wrong key");

  const authorized = await post("/api/signals/collect");
  assertStatus(authorized.response, 200, "authorized admin call");
}

async function testSignalsAndIssues() {
  const collected = await post("/api/signals/collect");
  assertStatus(collected.response, 200, "collect signals");
  assert(Array.isArray(collected.data.signals), "collect: signals should be an array");

  const signals = await get("/api/signals");
  assertStatus(signals.response, 200, "list signals");
  assert(Array.isArray(signals.data.signals), "list signals: should be an array");
  assert(
    signals.data.signals.length > 0,
    "list signals: collection should have stored something",
  );

  const detected = await post("/api/issues/detect");
  assertStatus(detected.response, 200, "detect issues");
  assert(typeof detected.data.detected === "number", "detect: count should be a number");

  const issues = await get("/api/issues");
  assertStatus(issues.response, 200, "list issues");
  assert(Array.isArray(issues.data.issues), "list issues: should be an array");
}

async function testProposalValidation() {
  const packet = decisionPacket();
  const proposer = voterAddress(0xbeef);

  for (const [label, options] of [
    ["negative quorum", { quorum: -1 }],
    ["negative threshold", { threshold: -1 }],
    ["zero quorum", { quorum: 0 }],
    ["threshold above 100", { threshold: 101 }],
    ["voting period below the floor", { votingPeriod: 1 }],
    ["unknown option", { nonsense: true }],
  ] as const) {
    const { response } = await post("/api/proposals", {
      decisionPacket: packet,
      proposer,
      options,
    });
    assertStatus(response, 400, `proposal with ${label} should be rejected`);
  }
}

async function testVotingIntegrity() {
  const proposal = await createProposal({ votingPeriod: 60_000 });

  const first = await post(
    `/api/proposals/${proposal.id}/vote`,
    { voter: voterAddress(1), choice: "for", weight: "100" },
    false,
  );
  assertStatus(first.response, 201, "first vote");
  assert(first.data.vote.choice === "for", "vote: choice should be stored canonically");

  // Same address, different casing: one holder, one vote.
  const checksummed = voterAddress(1).toUpperCase().replace("0X", "0x");
  assert(
    checksummed !== voterAddress(1),
    "fixture error: the two spellings must actually differ, or this proves nothing",
  );
  const duplicate = await post(
    `/api/proposals/${proposal.id}/vote`,
    { voter: checksummed, choice: "against", weight: "100" },
    false,
  );
  assertStatus(duplicate.response, 400, "duplicate vote in a different casing");

  // Upper-case choice must be normalized, not silently uncounted.
  const upper = await post(
    `/api/proposals/${proposal.id}/vote`,
    { voter: voterAddress(2), choice: "FOR", weight: "50" },
    false,
  );
  assertStatus(upper.response, 201, "upper-case choice");
  assert(
    upper.data.vote.choice === "for",
    `vote: "FOR" should be stored as "for", got ${upper.data.vote.choice}`,
  );

  for (const [label, body] of [
    ["a malformed address", { voter: "0xNOT_AN_ADDRESS", choice: "for", weight: "1" }],
    ["an unknown choice", { voter: voterAddress(3), choice: "maybe", weight: "1" }],
    ["zero weight", { voter: voterAddress(4), choice: "for", weight: "0" }],
    ["negative weight", { voter: voterAddress(5), choice: "for", weight: "-5" }],
  ] as const) {
    const { response } = await post(`/api/proposals/${proposal.id}/vote`, body, false);
    assertStatus(response, 400, `vote with ${label} should be rejected`);
  }

  const tally = await post(`/api/proposals/${proposal.id}/tally`);
  assertStatus(tally.response, 200, "tally");
  assert(
    tally.data.tally.forVotes === "150",
    `tally: expected 150 for-votes, got ${tally.data.tally.forVotes}`,
  );
  assert(tally.data.tally.voteCount === 2, "tally: expected 2 ballots");
}

async function testProposalListIncludesTally() {
  const proposal = await createProposal({ votingPeriod: 60_000 });
  await post(
    `/api/proposals/${proposal.id}/vote`,
    { voter: voterAddress(11), choice: "for", weight: "7" },
    false,
  );

  const { response, data } = await get(`/api/proposals/${proposal.id}`);
  assertStatus(response, 200, "get proposal");
  assert(data.proposal.tally, "proposal detail should carry a tally");
  assert(
    data.proposal.tally.forVotes === "7",
    `proposal detail tally: expected 7, got ${data.proposal.tally.forVotes}`,
  );

  const list = await get("/api/proposals");
  assertStatus(list.response, 200, "list proposals");
  const listed = list.data.proposals.find((p: any) => p.id === proposal.id);
  assert(listed?.tally?.forVotes === "7", "listed proposal should carry the same tally");
  assert(typeof listed.title === "string" && listed.title.length > 0, "listed proposal needs a title");
}

async function testVotingTimeline() {
  const proposal = await createProposal({ votingPeriod: 800 });
  await post(
    `/api/proposals/${proposal.id}/vote`,
    { voter: voterAddress(21), choice: "for", weight: "10" },
    false,
  );

  const early = await post(`/api/proposals/${proposal.id}/finalize`);
  assertStatus(early.response, 400, "finalizing before voting ends");

  await sleep(1000);

  const finalized = await post(`/api/proposals/${proposal.id}/finalize`);
  assertStatus(finalized.response, 200, "finalize after voting ends");
  assert(
    finalized.data.proposal.status === "passed",
    `finalize: expected passed, got ${finalized.data.proposal.status}`,
  );

  const late = await post(
    `/api/proposals/${proposal.id}/vote`,
    { voter: voterAddress(22), choice: "for", weight: "10" },
    false,
  );
  assertStatus(late.response, 400, "voting after finalization");
}

async function testExecutionAndMeasuredOutcome() {
  const proposal = await createProposal({ votingPeriod: 800 });
  await post(
    `/api/proposals/${proposal.id}/vote`,
    { voter: voterAddress(31), choice: "for", weight: "10" },
    false,
  );
  await sleep(1000);
  await post(`/api/proposals/${proposal.id}/finalize`);

  const executed = await post(`/api/proposals/${proposal.id}/execute`);
  assertStatus(executed.response, 200, "execute");
  assert(
    executed.data.proof === undefined,
    "execution must not mint an outcome proof before anything is measured",
  );
  assert(
    executed.data.measurement?.status === "pending_measurement",
    "execution should report a pending measurement",
  );
  const executionId = executed.data.execution.id;

  const pending = await get("/api/outcomes");
  const pendingRow = pending.data.outcomes.find((o: any) => o.executionId === executionId);
  assert(pendingRow, "outcomes should list the pending execution");
  assert(
    pendingRow.status === "pending_measurement" && pendingRow.successRate === null,
    "a pending outcome must not claim a success rate",
  );

  const undeclared = await post(`/api/outcomes/${executionId}/measurements`, {
    measurements: [{ name: "Invented metric", actual: 1 }],
  });
  assertStatus(undeclared.response, 400, "measurement for an undeclared KPI");

  const measured = await post(`/api/outcomes/${executionId}/measurements`, {
    measurements: [
      { name: "Resolution time", actual: 12 },
      { name: "Recurrence", actual: 3 },
    ],
  });
  assertStatus(measured.response, 201, "submit measurements");
  assert(
    measured.data.proof.successRate === 0.5,
    `success rate should be the 0-1 fraction 0.5, got ${measured.data.proof.successRate}`,
  );
  assert(
    measured.data.proof.overallSuccess === false,
    "half the KPIs met is not an overall success",
  );

  const outcomes = await get("/api/outcomes");
  const row = outcomes.data.outcomes.find((o: any) => o.executionId === executionId);
  assert(row?.status === "measured", "outcome should now be measured");
  assert(row.successRate === 0.5, "listed outcome keeps the fraction");
}

/**
 * The failing case above is satisfied by any threshold above 0.5 — including a
 * regression of SUCCESS_THRESHOLD to its old percentage value of 80. Only an
 * outcome that actually passes pins the constant to the [0,1] fraction, and
 * `overallSuccess === true` is asserted nowhere else in the suite.
 *
 * A fresh execution is required rather than re-measuring the one above: a
 * repeat submission is refused with 409 ALREADY_MEASURED.
 */
async function testFullySuccessfulOutcome() {
  const proposal = await createProposal({ votingPeriod: 800 });
  await post(
    `/api/proposals/${proposal.id}/vote`,
    { voter: voterAddress(51), choice: "for", weight: "10" },
    false,
  );
  await sleep(1000);
  await post(`/api/proposals/${proposal.id}/finalize`);

  const executed = await post(`/api/proposals/${proposal.id}/execute`);
  assertStatus(executed.response, 200, "execute for the success case");

  // Both declared KPIs are `at_most`: Resolution time ≤ 24, Recurrence ≤ 0.
  const measured = await post(
    `/api/outcomes/${executed.data.execution.id}/measurements`,
    {
      measurements: [
        { name: "Resolution time", actual: 12 },
        { name: "Recurrence", actual: 0 },
      ],
    },
  );
  assertStatus(measured.response, 201, "submit passing measurements");
  assert(
    measured.data.proof.successRate === 1,
    `every KPI met should be the fraction 1, got ${measured.data.proof.successRate}`,
  );
  assert(
    measured.data.proof.overallSuccess === true,
    "every KPI met is an overall success (fails if SUCCESS_THRESHOLD regressed to 80)",
  );
}

async function testDeliberationContract() {
  const missing = await post("/api/deliberate", {});
  assertStatus(missing.response, 400, "deliberate without an issue");

  const unknown = await post("/api/deliberate", { issueId: "no-such-issue" });
  assertStatus(unknown.response, 404, "deliberate on an unknown issue id");

  // An inline issue is stored first, so recording the decision cannot fail on
  // a foreign key.
  const inline = await post("/api/deliberate", {
    issue: {
      id: "40000000-0000-4000-8000-000000000001",
      title: "Inline issue",
      description: "supplied by the caller",
      category: "governance",
      priority: "high",
    },
  });
  assertStatus(inline.response, 200, "deliberate on an inline issue");
  assert(inline.data.decisionPacket, "deliberate should return a decision packet");

  const stored = await get("/api/issues");
  assert(
    stored.data.issues.some((i: any) => i.id === "40000000-0000-4000-8000-000000000001"),
    "the inline issue should have been stored",
  );
}

async function testDebateRoundsAreBounded() {
  const { response, data } = await post("/api/debate", {
    issue: {
      id: "40000000-0000-4000-8000-000000000002",
      title: "Debate issue",
      description: "for the debate test",
      category: "governance",
      priority: "high",
    },
    maxRounds: 9999,
  });
  assertStatus(response, 200, "debate");
  assert(
    data.debateSession.maxRounds <= 5,
    `debate rounds should be clamped, got ${data.debateSession.maxRounds}`,
  );
  assert(
    data.debateSession.rounds.length <= 5,
    `debate should run at most 5 rounds, ran ${data.debateSession.rounds.length}`,
  );
}

async function testDelegationAuthorization() {
  const owner = privateKeyToAccount(generatePrivateKey());

  const blanket = await post(
    "/api/delegations",
    { delegator: owner.address, delegate: "risk-agent", conditions: [] },
    false,
  );
  assertStatus(blanket.response, 400, "delegation with no conditions and no confirmation");

  const badField = await post(
    "/api/delegations",
    {
      delegator: owner.address,
      delegate: "risk-agent",
      conditions: [{ field: "decisionPacket.constructor", operator: "ne", value: null }],
    },
    false,
  );
  assertStatus(badField.response, 400, "delegation on an unknown condition field");

  const created = await post(
    "/api/delegations",
    {
      delegator: owner.address,
      delegate: "risk-agent",
      conditions: [
        {
          field: "decisionPacket.issue.category",
          operator: "in",
          value: ["governance"],
        },
      ],
    },
    false,
  );
  assertStatus(created.response, 201, "create delegation");
  const policyId = created.data.policy.id;

  const listed = await get(`/api/delegations?delegator=${owner.address}`);
  assertStatus(listed.response, 200, "list delegations");
  assert(
    listed.data.policies.some((p: any) => p.id === policyId),
    "the new policy should be listed for its delegator",
  );

  const revoked = await del(`/api/delegations/${policyId}`);
  assertStatus(revoked.response, 200, "revoke delegation");

  const afterRevoke = await get(`/api/delegations?delegator=${owner.address}`);
  assert(
    !afterRevoke.data.policies.some((p: any) => p.id === policyId),
    "a revoked policy should no longer be active",
  );
}

/**
 * Restart the API over the same database and check what survived. Without
 * this the persistence work is only ever exercised on the write path.
 */
async function testRestartRestoresState() {
  const proposal = await createProposal({ votingPeriod: 60_000 });
  const voter = voterAddress(41);
  const vote = await post(
    `/api/proposals/${proposal.id}/vote`,
    { voter, choice: "for", weight: "123" },
    false,
  );
  assertStatus(vote.response, 201, "vote before restart");

  const before = await post(`/api/proposals/${proposal.id}/tally`);
  assert(before.data.tally.forVotes === "123", "tally before restart");

  stopServer(true);
  await sleep(500);
  await startServer();

  const after = await post(`/api/proposals/${proposal.id}/tally`);
  assertStatus(after.response, 200, "tally after restart");
  assert(
    after.data.tally.forVotes === "123",
    `restored tally should match: expected 123, got ${after.data.tally.forVotes}`,
  );
  assert(after.data.tally.voteCount === 1, "restored ballot count should match");

  const restored = await get(`/api/proposals/${proposal.id}`);
  assertStatus(restored.response, 200, "proposal after restart");
  assert(
    restored.data.proposal.quorum === proposal.quorum &&
      restored.data.proposal.threshold === proposal.threshold,
    "restored proposal keeps its settings",
  );

  // testExecutionAndMeasuredOutcome left exactly one measured proof (0.5) in the
  // database. Re-read it: saving and restoring are separate code paths, so a
  // scaling applied on one side and not the other would otherwise go unnoticed —
  // nothing else in the suite observes a success rate that has been through SQLite.
  const outcomesAfter = await get("/api/outcomes");
  const measuredAfter = outcomesAfter.data.outcomes.filter(
    (o: any) => o.status === "measured",
  );
  assert(measuredAfter.length === 1, "the measured outcome should survive the restart");
  assert(
    measuredAfter[0].successRate === 0.5,
    `restored outcome keeps the 0-1 fraction, got ${measuredAfter[0].successRate}`,
  );

  // The one-vote-per-holder rule has to survive the restore, not just the
  // in-process cache.
  const again = await post(
    `/api/proposals/${proposal.id}/vote`,
    { voter: voter.toUpperCase().replace("0X", "0x"), choice: "against", weight: "999" },
    false,
  );
  assertStatus(again.response, 400, "double vote after restart");
}

/**
 * With signatures required — the production posture — an unsigned delegation
 * must be refused. The main delegation test runs with them off, so without
 * this the signature work has no coverage at all.
 */
async function testDelegationRequiresSignature() {
  stopServer(true);
  await sleep(500);
  await startServer({ REQUIRE_DELEGATION_SIGNATURE: "always" });

  const owner = privateKeyToAccount(generatePrivateKey());
  const conditions = [
    { field: "decisionPacket.issue.category", operator: "in", value: ["governance"] },
  ];

  const unsigned = await post(
    "/api/delegations",
    { delegator: owner.address, delegate: "risk-agent", conditions },
    false,
  );
  assertStatus(unsigned.response, 401, "unsigned delegation with signatures required");

  const nonce = "e2e-" + Math.random().toString(36).slice(2);
  const timestamp = Date.now();
  const message = [
    "BRIDGE Oracle Delegation",
    "Action: create",
    `Delegator: ${owner.address.toLowerCase()}`,
    "Delegate: risk-agent",
    `Conditions: ${JSON.stringify(
      conditions.map((c) => ({ field: c.field, operator: c.operator, value: c.value })),
    )}`,
    "ExpiresAt: none",
    `Nonce: ${nonce}`,
    `Timestamp: ${timestamp}`,
  ].join("\n");
  const signature = await owner.signMessage({ message });

  const signed = await post(
    "/api/delegations",
    { delegator: owner.address, delegate: "risk-agent", conditions, signature, nonce, timestamp },
    false,
  );
  assertStatus(signed.response, 201, "correctly signed delegation");

  // A lowercase lookup must find a policy stored under the checksummed form.
  const lookup = await get(`/api/delegations?delegator=${owner.address.toLowerCase()}`);
  assertStatus(lookup.response, 200, "lowercase delegator lookup");
  assert(
    lookup.data.policies.some((p: any) => p.id === signed.data.policy.id),
    "a policy must be findable by the lowercase spelling of its delegator",
  );

  // Replaying the same signature is refused.
  const replay = await post(
    "/api/delegations",
    { delegator: owner.address, delegate: "risk-agent", conditions, signature, nonce, timestamp },
    false,
  );
  assertStatus(replay.response, 401, "replayed delegation signature");

  stopServer(true);
  await sleep(500);
  await startServer();
}

async function testStats() {
  const { response, data } = await get("/api/stats");
  assertStatus(response, 200, "stats");
  assert(typeof data.signals.total === "number", "stats: signal total");
  assert(typeof data.proposals.total === "number", "stats: proposal total");
  // Not a unit check on proof.successRate: this field is a ratio of counts
  // (successful proofs / total proofs), structurally in [0,1] whatever unit the
  // proofs carry. The unit is pinned where it actually lives, in
  // testExecutionAndMeasuredOutcome and testFullySuccessfulOutcome. What this
  // asserts is that both of those proofs reached the tracker and that exactly
  // one of them passed the threshold.
  assert(
    data.outcomes.totalProofs === 2,
    `stats: expected 2 proofs, got ${data.outcomes.totalProofs}`,
  );
  assert(
    data.outcomes.successRate === 0.5,
    `stats: expected 1 of 2 proofs successful, got ${data.outcomes.successRate}`,
  );
}

async function testNotFoundPaths() {
  const proposal = await get("/api/proposals/does-not-exist");
  assertStatus(proposal.response, 404, "unknown proposal");

  const execution = await get("/api/outcomes/does-not-exist");
  assertStatus(execution.response, 404, "unknown execution");

  const delegation = await get("/api/delegations/does-not-exist");
  assertStatus(delegation.response, 404, "unknown delegation");
}

/* --------------------------------- run -------------------------------- */

async function main() {
  console.log("\n🧪 ORACLE API E2E suite\n");
  await startServer();
  console.log(`   server ready at ${baseUrl}\n`);

  try {
    await runTest("Health check", testHealthCheck);
    await runTest("Admin endpoints require the key", testAdminAuthRequired);
    await runTest("Signals and issues", testSignalsAndIssues);
    await runTest("Proposal settings are validated", testProposalValidation);
    await runTest("Voting integrity", testVotingIntegrity);
    await runTest("Proposal responses carry a tally", testProposalListIncludesTally);
    await runTest("Voting timeline is enforced", testVotingTimeline);
    await runTest("Execution and measured outcome", testExecutionAndMeasuredOutcome);
    await runTest("Deliberation contract", testDeliberationContract);
    await runTest("Debate rounds are bounded", testDebateRoundsAreBounded);
    await runTest("Delegation authorization", testDelegationAuthorization);
    await runTest("Delegation requires a signature", testDelegationRequiresSignature);
    await runTest("Restart restores governance state", testRestartRestoresState);
    // Runs after the restart test on purpose: that test asserts exactly one
    // measured proof survived, and this one mints a second.
    await runTest("A fully successful outcome", testFullySuccessfulOutcome);
    await runTest("Stats", testStats);
    await runTest("Unknown ids return 404", testNotFoundPaths);
  } finally {
    stopServer();
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;

  console.log("\n────────────────────────────────");
  console.log(`   ${passed}/${results.length} passed`);
  if (failed > 0) {
    console.log("\n   Failures:");
    for (const result of results.filter((r) => !r.passed)) {
      console.log(`   - ${result.name}: ${result.error}`);
    }
    console.log("\n   Server output:");
    console.log(serverLog.join("").split("\n").slice(-30).join("\n"));
  }
  console.log("────────────────────────────────\n");

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("E2E suite crashed:", error);
  stopServer();
  process.exit(1);
});
