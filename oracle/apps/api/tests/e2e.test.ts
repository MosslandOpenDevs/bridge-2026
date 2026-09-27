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
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "node:net";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import Database from "better-sqlite3";

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
      // Listen where baseUrl points, even if apps/api/.env binds a tailnet
      // address; empty for the same dotenv reason as the LLM keys below.
      HOST: "",
      TRUST_PROXY: "",
      DB_PATH: join(dataDir, "e2e.db"),
      ADMIN_API_KEY: ADMIN_KEY,
      NODE_ENV: "test",
      // The signal assertions need something to collect, and the real adapters
      // reach the network and swallow their own failures. Stated outright so
      // the suite does not quietly start depending on live Mossland/Medium
      // responses if NODE_ENV here ever changes.
      ENABLE_MOCK_SIGNALS: "1",
      // No live LLM calls from a test run. src/index.ts starts with
      // `import "dotenv/config"`, and the README tells contributors to put
      // their keys in apps/api/.env — so without this, running the suite on a
      // configured machine bills them for a real deliberation plus a real
      // debate. Empty rather than deleted: dotenv only fills keys that are
      // unset, and an empty string is falsy everywhere these are read, so the
      // agents fall back to their rule-based path. A test that wants the real
      // thing can still pass a key through startServer's overrides.
      ANTHROPIC_API_KEY: "",
      OPENAI_API_KEY: "",
      LLM_PROVIDER: "",
      OLLAMA_BASE_URL: "",
      // Background jobs off so the suite observes only what it triggers.
      SIGNAL_COLLECT_INTERVAL: "0",
      ISSUE_DETECT_INTERVAL: "0",
      AUTO_FINALIZE_INTERVAL: "0",
      // The autonomous loop is left to its defaults, which are off, so that
      // testAutonomousLoopOffByDefault can pin them. Empty rather than
      // omitted for the same dotenv reason as the keys above: a contributor
      // who opted in through apps/api/.env must not change what is tested.
      AUTO_DELIBERATE_ENABLED: "",
      AUTO_PROPOSAL_ENABLED: "",
      OUTCOME_EVAL_ENABLED: "",
      // BRIDGE's own voting is off by default (Mossland DAO votes on Agora),
      // but the code stays behind VOTING_ENABLED and the governance tests keep
      // exercising it. testVotingOffByDefault boots without this to pin the
      // default.
      VOTING_ENABLED: "1",
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

/**
 * Whether the server has written `text` since serverLog[from]. Waits briefly:
 * stdout is a pipe, and on macOS a startup line can land a moment after
 * /health first answers.
 */
async function logContains(text: string, from = 0, timeoutMs = 2_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (serverLog.slice(from).join("").includes(text)) return true;
    if (Date.now() >= deadline) return false;
    await sleep(50);
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

/**
 * The `stats:update` payload a new Socket.IO connection receives.
 *
 * Spoken over Engine.IO's long-polling transport with plain fetch — open,
 * CONNECT to the default namespace, read until the event arrives, close — so
 * the suite needs no socket.io-client dependency.
 */
async function socketStats(): Promise<any> {
  const base = `${baseUrl}/socket.io/?EIO=4&transport=polling`;
  const open = await fetch(base);
  assertStatus(open, 200, "socket handshake");
  const { sid } = JSON.parse((await open.text()).slice(1));
  const url = `${base}&sid=${sid}`;
  const send = (packet: string) =>
    fetch(url, { method: "POST", body: packet, headers: { "Content-Type": "text/plain" } });
  try {
    assertStatus(await send("40"), 200, "socket connect");
    for (let poll = 0; poll < 3; poll++) {
      const body = await (await fetch(url, { signal: AbortSignal.timeout(5000) })).text();
      // Engine.IO v4 separates packets in one polling payload with 0x1e.
      for (const packet of body.split("\x1e")) {
        if (!packet.startsWith("42")) continue;
        const [event, data] = JSON.parse(packet.slice(2));
        if (event === "stats:update") return data;
      }
    }
    throw new Error("socket: no stats:update after connecting");
  } finally {
    await send("1").catch(() => undefined);
  }
}

/* -------------------------------- tests ------------------------------- */

async function testHealthCheck() {
  const { response, data } = await get("/health");
  assertStatus(response, 200, "health");
  // The suite runs with SIGNAL_COLLECT_INTERVAL=0 and no network guarantee, so
  // there may be no observed signal at all. With collection off that is the
  // expected state, not a fault: the status must be "ok", and the body must say
  // why no freshness was judged. The staleness rule itself is covered by
  // testHealthStalenessRule without waiting on a clock.
  assert(data.status === "ok", `health: status should be ok with collection off, got ${data.status}`);
  assert(
    data.collection?.enabled === false && data.collection.staleAfterSeconds === null,
    `health: collection should be reported off, got ${JSON.stringify(data.collection)}`,
  );
  assert(data.reason === null, `health: an ok status carries no reason, got ${data.reason}`);
  assert(
    data.lastProcessedAt === data.lastObservedSignalAt,
    "health: lastProcessedAt is the contract's alias for lastObservedSignalAt",
  );
  // Contract rule 6, set by the app itself so the deploy gate's direct probe
  // of the API port gets it too, not only traffic through nginx.
  assert(
    /no-store|no-cache/.test(response.headers.get("cache-control") ?? ""),
    `health: Cache-Control should forbid caching, got ${response.headers.get("cache-control")}`,
  );
  const strict = await get("/api/health?strict=1");
  assertStatus(strict.response, 200, "strict health while ok");
  assert(typeof data.version === "string", "health: version should be a string");
  // The ecosystem health contract's three required fields. `service` is the
  // registry id, so a collector can attribute the payload; `timestamp` is when
  // this response was produced, which is what makes a repeated poll tell you
  // the process is still answering.
  assert(data.service === "bridge", "health: service should be the registry id 'bridge'");
  assert(
    typeof data.timestamp === "string" && !Number.isNaN(Date.parse(data.timestamp)),
    "health: timestamp should be an RFC 3339 instant",
  );
  // null is "unknown", never "just now" — callers must be able to tell.
  assert(
    data.lastObservedSignalAt === null || typeof data.lastObservedSignalAt === "string",
    "health: lastObservedSignalAt should be an ISO string or null",
  );
}

/**
 * Adding an LLM key used to be enough to have the server deliberate, open
 * proposals and write proxy outcome scores by itself. All three are opt-in
 * now; this pins the defaults so a refactor of envFlag or of the flags cannot
 * quietly turn the loop back on. The harness passes the flags empty, which
 * envFlag reads as "use the default".
 */
async function testAutonomousLoopOffByDefault() {
  for (const line of [
    "Auto deliberation: DISABLED",
    "Auto proposal promotion: DISABLED",
    "Outcome evaluation: DISABLED",
  ]) {
    assert(await logContains(line), `startup log should say "${line}"`);
  }
}

/**
 * Boot a second, throwaway API process with its own port and database, for
 * tests about how the process starts rather than what it serves. Resolves once
 * GET /health answers (not /api/health, which the global rate limiter counts)
 * or with the exit code if the process stops first.
 */
async function bootSide(
  env: Record<string, string>,
): Promise<{ url: string; exitCode: number | null; log: () => string; stop: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), "oracle-side-"));
  const port = await freePort();
  const out: string[] = [];
  const child = spawn(process.execPath, [join(API_ROOT, "dist", "index.js")], {
    cwd: API_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "",
      TRUST_PROXY: "",
      DB_PATH: join(dir, "side.db"),
      ADMIN_API_KEY: ADMIN_KEY,
      NODE_ENV: "test",
      ENABLE_MOCK_SIGNALS: "0",
      ANTHROPIC_API_KEY: "",
      OPENAI_API_KEY: "",
      LLM_PROVIDER: "",
      OLLAMA_BASE_URL: "",
      SIGNAL_COLLECT_INTERVAL: "0",
      ISSUE_DETECT_INTERVAL: "0",
      AUTO_FINALIZE_INTERVAL: "0",
      AUTO_DELIBERATE_ENABLED: "",
      AUTO_PROPOSAL_ENABLED: "",
      OUTCOME_EVAL_ENABLED: "",
      MAINNET_RPC_URL: "off",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (c) => out.push(String(c)));
  child.stderr?.on("data", (c) => out.push(String(c)));
  // 'close', not 'exit': only then has the refusal message been read off the pipe.
  const closed = new Promise((resolve) => child.on("close", resolve));
  const stop = () => {
    child.kill("SIGTERM");
    rmSync(dir, { recursive: true, force: true });
  };
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      await closed;
      stop();
      return { url, exitCode: child.exitCode, log: () => out.join(""), stop };
    }
    try {
      if ((await fetch(`${url}/health`)).ok) {
        return { url, exitCode: null, log: () => out.join(""), stop };
      }
    } catch {
      // not up yet
    }
    await sleep(100);
  }
  stop();
  throw new Error(`side API neither came up nor exited:\n${out.join("")}`);
}

/** Whether this host can listen on ::1, i.e. has an IPv6 loopback at all. */
async function hasIpv6Loopback(): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once("error", () => resolve(false));
    srv.listen(0, "::1", () => srv.close(() => resolve(true)));
  });
}

/**
 * HOST binds one address, and TRUST_PROXY decides whose X-Forwarded-For moves
 * a caller into another rate-limit bucket. The second half is the reason the
 * setting exists: with the default of one hop, anything reaching the port
 * without nginx can name a new address per request and never be limited.
 */
async function testBindHostAndTrustedProxy() {
  // Three /api/ requests a minute per client, so a shared bucket shows at once.
  const limit = { RATE_LIMIT_GLOBAL: "3" };
  const forged = (url: string, i: number) =>
    fetch(`${url}/api/health`, { headers: { "X-Forwarded-For": `203.0.113.${i}` } });

  const bound = await bootSide({ ...limit, HOST: "127.0.0.1", TRUST_PROXY: "127.0.0.1" });
  try {
    assert(bound.exitCode === null, `HOST=127.0.0.1 should boot:\n${bound.log()}`);
    const health = await fetch(`${bound.url}/api/health`);
    assertStatus(health, 200, "health on the bound address");
    assert((await health.json()).service === "bridge", "health: bound server should answer as bridge");
    const port = new URL(bound.url).port;
    assert(
      bound.log().includes(`Listening on 127.0.0.1:${port}, X-Forwarded-For trusted from 127.0.0.1`),
      `startup log should name the bound address and the trusted proxy:\n${bound.log()}`,
    );
    // Answering on 127.0.0.1 is also what a wildcard bind does. The bind is
    // only real if another local address is refused; ::1 is the one every
    // dual-stack host has (skipped where it does not exist).
    if (await hasIpv6Loopback()) {
      const other = await fetch(`http://[::1]:${port}/health`).then(
        (res) => `answered ${res.status}`,
        (error: unknown) => {
          const cause = (error as { cause?: { code?: string } }).cause;
          return cause?.code ?? String(error);
        },
      );
      assert(other === "ECONNREFUSED", `HOST=127.0.0.1 should refuse [::1]:${port}, got ${other}`);
    } else {
      console.log("    (no ::1 on this host; skipped the other-interface check)");
    }
    // The caller is the trusted proxy here, so each forwarded address is a
    // client of its own and none of them reaches the limit.
    for (let i = 1; i <= 5; i++) {
      assertStatus(await forged(bound.url, i), 200, `forwarded client ${i} via the trusted proxy`);
    }
  } finally {
    bound.stop();
  }

  // Same forged headers from a peer that is not the named proxy: they are
  // ignored, every request counts against the caller, and the fourth is 429.
  const direct = await bootSide({ ...limit, TRUST_PROXY: "100.107.17.114" });
  try {
    assert(direct.exitCode === null, `TRUST_PROXY=<ip> should boot:\n${direct.log()}`);
    const statuses: number[] = [];
    for (let i = 1; i <= 4; i++) statuses.push((await forged(direct.url, i)).status);
    assert(
      statuses.join(",") === "200,200,200,429",
      `a direct caller should not escape the limit by forging X-Forwarded-For, got ${statuses.join(",")}`,
    );
  } finally {
    direct.stop();
  }
}

async function testInvalidTrustProxyStopsBoot() {
  for (const value of ["true", "10.0.0.1, 2", "10.0.0.0/33", "nginx.internal"]) {
    const side = await bootSide({ TRUST_PROXY: value });
    if (side.exitCode === null) side.stop();
    assert(side.exitCode === 1, `TRUST_PROXY="${value}" should stop the boot, exit code ${side.exitCode}`);
    assert(
      side.log().includes(`Refusing to start: TRUST_PROXY must be a hop count`) &&
        side.log().includes(`got "${value}"`),
      `TRUST_PROXY="${value}" should be named in the refusal:\n${side.log()}`,
    );
  }
}

/**
 * The failure this field exists to catch: real collection dies, the demo
 * adapter keeps writing, and every other health field stays put. `status` is
 * always "ok", `timestamp` is our own clock, and /api/stats only has
 * cumulative totals that never fall — so if `lastObservedSignalAt` counted
 * synthetic rows too, a dead pipeline would look perfectly healthy.
 *
 * Roughly a third of stored signals are synthetic in production, so this is
 * not a hypothetical.
 */
async function testHealthIgnoresSyntheticSignals() {
  const seed = (db: InstanceType<typeof Database>) => {
    const insert = db.prepare(
      `INSERT INTO signals (id, original_id, source, timestamp, category, severity, value, unit, description, synthetic)
       VALUES (?, ?, 'health-probe', ?, ?, 'low', 0, 'n/a', ?, ?)`,
    );
    // Observed signal a week old; synthetic signal from today.
    insert.run("hp-obs", "hp-obs", "2026-09-01T00:00:00.000Z", "health_probe_obs", "observed", 0);
    insert.run("hp-syn", "hp-syn", "2026-09-09T00:00:00.000Z", "health_probe_syn", "demo", 1);
  };

  let db = new Database(join(dataDir, "e2e.db"));
  try {
    seed(db);
  } finally {
    db.close();
  }

  try {
    const { response, data } = await get("/health");
    assertStatus(response, 200, "health with a newer synthetic signal");
    assert(
      data.lastObservedSignalAt === "2026-09-01T00:00:00.000Z",
      `health: lastObservedSignalAt should ignore synthetic rows, got ${data.lastObservedSignalAt}`,
    );
    // Weeks old, and still ok: collection is off in this process, so an old
    // observation is expected rather than a stalled pipeline.
    assert(
      data.status === "ok",
      `health: an old signal with collection off should stay ok, got ${data.status}`,
    );
  } finally {
    // Leave no trace: later tests assert on category counts, and these probe
    // rows would otherwise show up there as real signal categories.
    db = new Database(join(dataDir, "e2e.db"));
    try {
      db.prepare("DELETE FROM signals WHERE id IN ('hp-obs', 'hp-syn')").run();
    } finally {
      db.close();
    }
  }
}

/**
 * The staleness rule, exercised directly instead of by waiting on a clock.
 * health.ts has no database or Express dependency for exactly this reason.
 *
 * The anchor case is the real one: on 2026-09-14 ingestion stopped for 487
 * minutes and /api/health said "ok" throughout, because `status` was a
 * constant. The same stored timestamp must now read as degraded.
 */
async function testHealthStalenessRule() {
  const { deriveHealth, healthHttpStatus, resolveHealthConfig, MIN_STALE_AFTER_SECONDS } =
    await import("../src/health.js");

  // HTTP status, the whole table. Only (down, strict) is a 503: the deploy
  // gate's `curl -f` reads strict, and a degraded 503 there would roll back
  // every deploy that lands before its first collection — and any deploy made
  // while ingestion is stalled, which is when the fix ships.
  for (const status of ["ok", "degraded", "down"] as const) {
    for (const strict of [false, true]) {
      const expected = status === "down" && strict ? 503 : 200;
      const actual = healthHttpStatus(status, strict);
      assert(actual === expected, `${status} with strict=${strict} should be ${expected}, got ${actual}`);
    }
  }
  const at = "2026-09-14T00:00:00.000Z";
  const after = (seconds: number) => new Date(Date.parse(at) + seconds * 1000);
  const reads = (value: string | null) => () => value;

  // Threshold: max(180 s, 3 × interval), collection off when the interval is not > 0.
  assert(resolveHealthConfig(60).staleAfterSeconds === 180, "threshold at the shipped 60 s interval");
  assert(resolveHealthConfig(5).staleAfterSeconds === MIN_STALE_AFTER_SECONDS, "short intervals keep the floor");
  assert(resolveHealthConfig(300).staleAfterSeconds === 900, "long intervals scale by three");
  for (const off of [0, -1, Number.NaN]) {
    const config = resolveHealthConfig(off, "600");
    assert(
      !config.collecting && config.staleAfterSeconds === null,
      `interval ${off} means collection is off, whatever the override`,
    );
  }
  const overridden = resolveHealthConfig(60, "600");
  assert(overridden.staleAfterSeconds === 600 && !overridden.overrideRejected, "override is honoured");
  for (const bad of ["0", "-5", "soon"]) {
    const config = resolveHealthConfig(60, bad);
    assert(
      config.staleAfterSeconds === 180 && config.overrideRejected,
      `override "${bad}" should fall back to the default and be flagged`,
    );
  }

  const collecting = resolveHealthConfig(60);
  const outage = deriveHealth(reads(at), collecting, after(487 * 60));
  assert(outage.status === "degraded", `a 487-minute gap should be degraded, got ${outage.status}`);
  assert(outage.lastObservedSignalAt === at, "degraded still reports what it knows");
  assert(typeof outage.reason === "string", "degraded says why");

  assert(deriveHealth(reads(at), collecting, after(60)).status === "ok", "one tick old is ok");
  assert(deriveHealth(reads(at), collecting, after(180)).status === "ok", "exactly at the threshold is ok");
  assert(deriveHealth(reads(at), collecting, after(181)).status === "degraded", "past the threshold is degraded");
  assert(deriveHealth(reads(at), collecting, after(-600)).status === "ok", "clock skew into the future is not staleness");

  // Nothing observed yet — also a fresh deploy before its first collection.
  const empty = deriveHealth(reads(null), collecting, after(0));
  assert(empty.status === "degraded" && empty.lastObservedSignalAt === null, "no signal while collecting is degraded");
  const garbled = deriveHealth(reads("not a date"), collecting, after(0));
  assert(garbled.status === "degraded" && garbled.lastObservedSignalAt === null, "an unreadable time is an unknown time");

  // Collection off: neither age nor absence is a fault.
  const off = resolveHealthConfig(0);
  assert(deriveHealth(reads(at), off, after(487 * 60)).status === "ok", "old signal with collection off is ok");
  assert(deriveHealth(reads(null), off, after(0)).status === "ok", "no signal with collection off is ok");

  // A database that cannot be read is down, collection on or off.
  const boom = () => {
    throw new Error("SQLITE_CORRUPT");
  };
  for (const config of [collecting, off]) {
    const down = deriveHealth(boom, config, after(0));
    assert(down.status === "down" && down.lastObservedSignalAt === null, "a failed read is down, not ok");
    assert(!down.reason?.includes("SQLITE"), "the raw error stays in the server log");
  }
}

/**
 * The whole path for "down": the running server loses its signals table, and
 * the endpoint has to say so — in the body at /api/health (contract rule 4:
 * 200 whenever it answers) and as a 503 at ?strict=1, which is what the
 * deploy gate's `curl -f` reads to roll a broken release back.
 */
async function testHealthReportsDown() {
  const dbPath = join(dataDir, "e2e.db");
  let db = new Database(dbPath);
  try {
    db.exec("ALTER TABLE signals RENAME TO signals_hidden");
  } finally {
    db.close();
  }

  try {
    const plain = await get("/api/health");
    assertStatus(plain.response, 200, "health with an unreadable database");
    assert(plain.data.status === "down", `health: expected down, got ${plain.data.status}`);
    assert(plain.data.service === "bridge", "health: down still names the service");
    assert(plain.data.lastObservedSignalAt === null, "health: down knows no signal time");

    const strict = await get("/api/health?strict=1");
    assertStatus(strict.response, 503, "strict health with an unreadable database");
    assert(strict.data.status === "down", "strict health: the body still carries the verdict");
  } finally {
    db = new Database(dbPath);
    try {
      db.exec("ALTER TABLE signals_hidden RENAME TO signals");
    } finally {
      db.close();
    }
  }

  const { data } = await get("/api/health");
  assert(data.status === "ok", `health: should recover once the table is back, got ${data.status}`);
}

/**
 * The 2026-09-14 outage, end to end: collection is on, the scheduler keeps
 * ticking, and no observed signal lands. Every other boot in this suite has
 * collection off, so without this the handler could ignore HEALTH_CONFIG, or
 * answer 503 for degraded under ?strict=1, and still pass.
 *
 * Made deterministic without cutting the network: the newest observed signal
 * is a day old, and a trigger makes every insert into `signals` fail, so
 * whatever the adapters fetch never lands. A pass that cannot store its
 * readings does not count as an observation either (the change filter learns
 * a pass only after its write commits), which is what a stalled pipeline looks
 * like from here. Reads are untouched, so this is degraded and not down.
 *
 * The trigger used to drop inserts silently with RAISE(IGNORE). Freshness no
 * longer comes from the newest row alone — unchanged readings are not stored —
 * so a write that reports success is taken at its word; a failing one is the
 * stall this process can actually see.
 */
async function testHealthWhileIngestionStalls() {
  const dbPath = join(dataDir, "e2e.db");
  const lastObserved = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const setUp = (db: InstanceType<typeof Database>) => {
    db.prepare("DELETE FROM signals WHERE synthetic = 0").run();
    // Earlier passes recorded when they last observed; a day-old signal is
    // only the last observation once that record is gone too.
    db.prepare("DELETE FROM collector_state").run();
    db.prepare(
      `INSERT INTO signals (id, original_id, source, timestamp, category, severity, value, unit, description, synthetic)
       VALUES ('stall-obs', 'stall-obs', 'health-probe', ?, 'health_probe_obs', 'low', 0, 'n/a', 'observed', 0)`,
    ).run(lastObserved);
    db.exec(`CREATE TRIGGER e2e_stall_ingestion BEFORE INSERT ON signals
             BEGIN SELECT RAISE(ABORT, 'e2e: ingestion stalled'); END`);
  };

  stopServer(true);
  await sleep(500);
  let db = new Database(dbPath);
  try {
    setUp(db);
  } finally {
    db.close();
  }

  try {
    await startServer({ SIGNAL_COLLECT_INTERVAL: "3600", MOSSLAND_API_URL: "http://127.0.0.1:9" });

    const { response, data } = await get("/api/health");
    assertStatus(response, 200, "health while ingestion stalls");
    assert(
      JSON.stringify(data.collection) ===
        JSON.stringify({ enabled: true, intervalSeconds: 3600, staleAfterSeconds: 10800 }),
      `health: collection should report the configured interval, got ${JSON.stringify(data.collection)}`,
    );
    assert(data.status === "degraded", `health: a day-old signal should be degraded, got ${data.status}`);
    assert(data.lastObservedSignalAt === lastObserved, "health: degraded still reports the last signal");
    assert(
      typeof data.reason === "string" && data.reason.includes("stale after 10800s"),
      `health: degraded should say why, got ${data.reason}`,
    );

    // What the deploy gate reads. A 503 here would roll back a deploy made
    // while ingestion is stalled, which is when the fix ships.
    const strict = await get("/api/health?strict=1");
    assertStatus(strict.response, 200, "strict health while degraded");
    assert(strict.data.status === "degraded", "strict health: the body still carries the verdict");
  } finally {
    stopServer(true);
    await sleep(500);
    db = new Database(dbPath);
    try {
      db.exec("DROP TRIGGER IF EXISTS e2e_stall_ingestion");
    } finally {
      db.close();
    }
    await startServer();
  }
}

/**
 * Runs before anything is executed or measured, which is the only window in
 * the suite where nothing has been. The endpoint has to say so rather than
 * reporting a rate: 0% is a claim about how the service performed, and until a
 * proof exists there is nothing to make that claim about.
 */
async function testStatsBeforeAnyOutcome() {
  const { response, data } = await get("/api/stats");
  assertStatus(response, 200, "stats before any outcome");
  assert(
    data.outcomes.totalProofs === 0,
    `stats: expected no proofs yet, got ${data.outcomes.totalProofs}`,
  );
  assert(
    data.outcomes.successRate === null,
    `stats: success rate with no proofs should be null, got ${JSON.stringify(
      data.outcomes.successRate,
    )}`,
  );
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

/**
 * The store-on-change rule itself, exercised without a server. The cases are
 * the production ones: the disclosure adapter's event and total share a
 * category and must not defeat each other, moc_price's severity moves with the
 * reading, and a pass whose write fails must leave nothing behind.
 */
async function testSignalChangeFilterRule() {
  const { SignalChangeFilter, signalStream, laterTimestamp } = await import(
    "../src/signal-dedupe.js"
  );
  const at = (minute: number) => new Date(Date.parse("2026-09-26T00:00:00.000Z") + minute * 60_000);
  const reading = (category: string, value: number, description: string, minute: number, extra = {}) => ({
    category,
    value,
    description,
    severity: "low",
    timestamp: at(minute),
    ...extra,
  });
  const kinds = new Map<object, string>();
  const typed = <T extends object>(signal: T, type: string) => {
    kinds.set(signal, type);
    return signal;
  };
  const streamOf = (signal: { category: string }) =>
    signalStream(signal.category, { data: { type: kinds.get(signal) } });

  assert(signalStream("moc_price", { data: { type: "price" } }) === "moc_price|price", "stream: category and type");
  assert(signalStream("custom", { data: { _endpoint: "tvl" } }) === "custom|tvl", "stream: APIAdapter endpoint name");
  assert(signalStream("custom", undefined) === "custom", "stream: category alone without a raw signal");
  assert(laterTimestamp(null, undefined) === null, "laterTimestamp: nothing known");
  assert(
    laterTimestamp("2026-09-26T00:00:00.000Z", "2026-09-26T00:01:00.000Z") === "2026-09-26T00:01:00.000Z",
    "laterTimestamp: the later one",
  );

  // Seeded with what is stored: the disclosure total, and the event a restart
  // is about to re-emit.
  const filter = new SignalChangeFilter(
    [
      { stream: "mossland_disclosure|disclosure_stats", value: 53, description: "Total 53 disclosures", severity: "low" },
      { stream: "mossland_disclosure|disclosure", value: 1, description: "New disclosure: A", severity: "high" },
    ],
    "2026-09-25T23:59:00.000Z",
  );
  assert(filter.streamCount === 2, "seed: two streams");

  const pass1 = [
    typed(reading("mossland_disclosure", 1, "New disclosure: A", 1, { severity: "high" }), "disclosure"),
    typed(reading("mossland_disclosure", 53, "Total 53 disclosures", 1), "disclosure_stats"),
    typed(reading("moc_price", 41, "MOC 41", 1), "price"),
    reading("token_price", 12.3, "demo", 1, { synthetic: true }),
  ];
  const plan1 = filter.plan(pass1, streamOf);
  assert(plan1.skipped === 2, `restart re-emission and unchanged total skipped, got ${plan1.skipped}`);
  assert(plan1.stored === 1 && plan1.synthetic === 1, "new stream stored, synthetic kept");
  assert(
    plan1.writes.map((w) => w.stream).join(",") === "moc_price|price,",
    `writes: the new stream, then the synthetic row with no stream, got ${plan1.writes.map((w) => w.stream)}`,
  );
  assert(plan1.observedAt === at(1).toISOString(), "observedAt: newest observed reading, synthetic ignored");
  assert(plan1.lastObservedAt === at(1).toISOString(), "lastObservedAt: what to record once the pass commits");
  const demoOnly = filter.plan([reading("token_price", 1, "demo", 1, { synthetic: true })], streamOf);
  assert(demoOnly.lastObservedAt === null, "a pass that observed nothing records no observation");

  // The write failed: nothing is learned, and the next pass stores it again.
  const retry = filter.plan(pass1, streamOf);
  assert(retry.stored === 1, "an uncommitted plan leaves the filter unchanged");
  assert(filter.lastObservedAt === "2026-09-25T23:59:00.000Z", "an uncommitted pass is not an observation");
  filter.commit(retry);
  assert(filter.lastObservedAt === at(1).toISOString(), "a committed pass is an observation");

  // Severity alone changing is a change; so is the value moving and coming back.
  const sequence = [
    reading("moc_price", 41, "MOC 41", 2),
    reading("moc_price", 41, "MOC 41", 3, { severity: "medium" }),
    reading("moc_price", 42, "MOC 42", 4),
    reading("moc_price", 41, "MOC 41", 5),
    reading("moc_price", 41, "MOC 41", 6),
  ].map((s) => typed(s, "price"));
  const storedFlags = sequence.map((signal) => {
    const plan = filter.plan([signal], streamOf);
    filter.commit(plan);
    return plan.stored;
  });
  assert(
    storedFlags.join("") === "01110",
    `moc_price: unchanged, severity change, value change, back again, unchanged -> 01110, got ${storedFlags.join("")}`,
  );
  assert(filter.lastObservedAt === at(6).toISOString(), "freshness advances on skipped readings too");

  // Twice in one pass: judged against the reading about to be stored.
  const twice = filter.plan(
    [
      typed(reading("moc_tx_alert", 7, "7 tx", 7), "transaction_alert"),
      typed(reading("moc_tx_alert", 7, "7 tx", 7), "transaction_alert"),
    ],
    streamOf,
  );
  assert(twice.stored === 1 && twice.skipped === 1, "a repeat inside one pass is skipped");

  // /api/market sends market cap as a string; the seeded row is a REAL from
  // SQLite. The same reading must match across that, or every restart stores
  // one duplicate row per such stream.
  const market = new SignalChangeFilter(
    [{ stream: "moc_market|market", value: 13772181754, description: "MOC market cap", severity: "low" }],
    null,
  );
  const restartPass = market.plan(
    [typed(reading("moc_market", "13772181754.00" as unknown as number, "MOC market cap", 8), "market")],
    streamOf,
  );
  assert(
    restartPass.stored === 0 && restartPass.skipped === 1,
    `a numeric string equal to the stored REAL is the same reading, got stored=${restartPass.stored}`,
  );
  const movedPass = market.plan(
    [typed(reading("moc_market", "13772181755.00" as unknown as number, "MOC market cap", 9), "market")],
    streamOf,
  );
  assert(movedPass.stored === 1, "a numeric string that differs is a change");
}

/**
 * Collection stores changes only, end to end, against a stub of the Mossland
 * API so the readings are ours to hold still or move.
 *
 * Covers what the rule is for: an unchanged reading is not stored again, a
 * changed one is, /api/health still advances when nothing was stored (its
 * freshness must not start meaning "the market last moved"), and after a
 * restart an unchanged reading is recognised from the seeded filter instead
 * of being stored again. MosslandAdapter itself no longer re-announces the
 * latest disclosure after a restart (it is seeded from stored events), which
 * the restart step checks too.
 */
async function testUnchangedSignalsAreNotStored() {
  const { createServer: createHttpServer } = await import("node:http");
  const dbPath = join(dataDir, "e2e.db");
  let disclosures = [
    { title: "E2E disclosure C", date: "2026-09-03", url: "https://example.invalid/c" },
    { title: "E2E disclosure B", date: "2026-09-02", url: "https://example.invalid/b" },
    { title: "E2E disclosure A", date: "2026-09-01", url: "https://example.invalid/a" },
  ];
  // Only the disclosure list is served; every other Mossland endpoint 404s,
  // which the adapter already treats as "no reading".
  const stub = createHttpServer((req, res) => {
    if (req.url?.startsWith("/api/disclosure")) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(disclosures));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
  const address = stub.address();
  const stubUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  type Row = { id: string; timestamp: string; value: number; description: string; stream: string | null };
  const disclosureRows = (): Row[] => {
    const db = new Database(dbPath, { readonly: true });
    try {
      return db
        .prepare(
          `SELECT id, timestamp, value, description, stream FROM signals
           WHERE category IN ('mossland_disclosure', 'mossland_disclosure_published')
           ORDER BY timestamp`,
        )
        .all() as Row[];
    } finally {
      db.close();
    }
  };
  // Rows an earlier collection stored from the live API stay out of the counts.
  const before = new Set(disclosureRows().map((row) => row.id));
  const ours = () => disclosureRows().filter((row) => !before.has(row.id));
  const collect = async (label: string) => {
    const result = await post("/api/signals/collect");
    assertStatus(result.response, 200, label);
    return result.data;
  };

  // No demo adapter: its rows are written on every pass, so with it on no
  // pass is ever one with nothing to store, and the locked-database step
  // below would fail on the demo insert whether or not an unchanged pass
  // still writes.
  const env = { MOSSLAND_API_URL: stubUrl, ENABLE_MOCK_SIGNALS: "0" };

  stopServer(true);
  await sleep(500);
  try {
    await startServer(env);

    // An unrecognised list is the adapter's baseline: no event, only the total.
    await collect("first collection");
    const first = ours();
    assert(first.length === 1, `first pass: only the total should be stored, got ${first.length}`);
    assert(
      first[0].stream === "mossland_disclosure|disclosure_stats",
      `first pass: the total's stream, got ${first[0].stream}`,
    );

    const second = await collect("repeated collection");
    const total = second.signals.find(
      (s: { category: string; value: number }) => s.category === "mossland_disclosure" && s.value === 3,
    );
    assert(total, "second pass: the unchanged total should still be collected");
    assert(ours().length === 1, `second pass: an unchanged reading must not be stored, got ${ours().length} rows`);
    assert(second.skipped >= 1, `second pass: the response should count the skip, got ${second.skipped}`);

    const health = await get("/api/health");
    const lastObserved = Date.parse(health.data.lastObservedSignalAt);
    assert(
      lastObserved >= Date.parse(total.timestamp),
      `health: lastObservedSignalAt should reach the unstored reading at ${total.timestamp}, got ${health.data.lastObservedSignalAt}`,
    );
    assert(
      lastObserved > Math.max(...ours().map((row) => Date.parse(row.timestamp))),
      "health: freshness should move past the newest stored disclosure row",
    );

    // A database that refuses writes has to fail a pass with nothing to store
    // as well, or health reports it fresh until some stream happens to move.
    // Holding the write lock from here is such a database whatever table the
    // pass touches: an unchanged pass used to commit an empty transaction,
    // which takes no lock, and advanced lastObservedSignalAt regardless.
    const observedBeforeLock = health.data.lastObservedSignalAt;
    const locker = new Database(dbPath);
    try {
      locker.exec("BEGIN IMMEDIATE");
      const blocked = await post("/api/signals/collect");
      assert(
        blocked.response.status === 500,
        `locked database: an unchanged pass should fail, got ${blocked.response.status}`,
      );
    } finally {
      if (locker.inTransaction) locker.exec("ROLLBACK");
      locker.close();
    }
    const afterLock = await get("/api/health");
    assert(
      afterLock.data.lastObservedSignalAt === observedBeforeLock,
      `locked database: a pass that could not write is not an observation, got ${afterLock.data.lastObservedSignalAt}`,
    );

    disclosures = [
      { title: "E2E disclosure D", date: "2026-09-04", url: "https://example.invalid/d" },
      ...disclosures,
    ];
    await collect("collection after a change");
    const changed = ours();
    assert(changed.length === 3, `changed pass: the new event and the new total should be stored, got ${changed.length}`);
    assert(
      changed.some(
        (row) =>
          row.description.includes("E2E disclosure D") &&
          row.stream === "mossland_disclosure_published|disclosure",
      ) && changed.some((row) => row.stream?.endsWith("disclosure_stats") && row.value === 4),
      "changed pass: an event row for disclosure D and a total of 4",
    );

    stopServer(true);
    await sleep(500);
    await startServer(env);
    // The adapter is seeded from the stored events, so D is not announced
    // again; the unchanged total is still collected, and the filter, seeded
    // from the database, knows it is stored.
    const afterRestart = await collect("collection after a restart");
    assert(
      !afterRestart.signals.some(
        (s: { description: string }) => s.description.includes("E2E disclosure D"),
      ),
      "restart: the adapter should not re-announce the latest disclosure",
    );
    assert(
      afterRestart.skipped >= 1,
      `restart: the unchanged total should be skipped, got skipped=${afterRestart.skipped}`,
    );
    assert(ours().length === 3, `restart: nothing unchanged may be stored again, got ${ours().length} rows`);
  } finally {
    await new Promise<void>((resolve) => stub.close(() => resolve()));
    stopServer(true);
    await sleep(500);
    // Leave no trace: later tests count what the live adapters stored.
    const db = new Database(dbPath);
    try {
      const remove = db.prepare("DELETE FROM signals WHERE id = ?");
      for (const row of ours()) remove.run(row.id);
    } finally {
      db.close();
    }
    await startServer();
  }
}

/**
 * Embedded signals are what made ?limit=500 a 6.8MB answer in production, so
 * large pages leave them out unless asked, and no page exceeds 200 rows. Small
 * pages — the issues page reads the default 50 — keep embedding, so existing
 * consumers see no change.
 */
async function testIssueListDefaults() {
  const category = "issue_list_probe";
  const db = new Database(join(dataDir, "e2e.db"));
  try {
    // More open rows than the cap, so the cap is what limits the page.
    const insert = db.prepare(
      `INSERT INTO issues (id, title, description, category, priority, status, detected_at, signal_ids, synthetic, fingerprint)
       VALUES (?, 'probe', 'probe', ?, 'low', 'detected', ?, '[]', 1, ?)`,
    );
    const at = new Date().toISOString();
    db.transaction(() => {
      for (let i = 0; i < 205; i++) insert.run(`ilp-${i}`, category, at, `${category}|issue|`);
    })();
  } finally {
    db.close();
  }

  try {
    const embedded = (issues: any[]) => issues.every((issue) => Array.isArray(issue.signals));
    const bare = (issues: any[]) => issues.every((issue) => !("signals" in issue));

    const small = await get("/api/issues");
    assertStatus(small.response, 200, "default issue list");
    assert(
      small.data.signalsIncluded === true && small.data.count > 0 && embedded(small.data.issues),
      "issues: the default page of 50 should still embed signals",
    );

    const large = await get("/api/issues?limit=51");
    assertStatus(large.response, 200, "issue list of 51");
    assert(
      large.data.signalsIncluded === false && large.data.count === 51 && bare(large.data.issues),
      `issues: a page over 50 should leave signals out by default, got signalsIncluded=${large.data.signalsIncluded}`,
    );

    const asked = await get("/api/issues?limit=51&includeSignals=true");
    assert(
      asked.data.signalsIncluded === true && embedded(asked.data.issues),
      "issues: includeSignals=true should still embed on a large page",
    );

    const declined = await get("/api/issues?limit=10&includeSignals=false");
    assert(
      declined.data.signalsIncluded === false && bare(declined.data.issues),
      "issues: includeSignals=false should hold on a small page",
    );

    const capped = await get("/api/issues?limit=1000");
    assert(
      capped.data.count === 200,
      `issues: limit should be capped at 200, got ${capped.data.count}`,
    );
  } finally {
    const cleanup = new Database(join(dataDir, "e2e.db"));
    try {
      cleanup.prepare(`DELETE FROM issues WHERE category = ?`).run(category);
    } finally {
      cleanup.close();
    }
  }
}

/**
 * A second detection over the same signals must report zero NEW issues.
 *
 * The condition is still open, so it folds into the existing row — but
 * `savedIssues` also carries escalations, and reporting its length as "new" is
 * what made production announce issues that were never created: an issue below
 * AUTO_DELIBERATE_MIN_PRIORITY re-escalates on every pass, so the log said
 * "saved 2 new" every five minutes while the newest row was three weeks old.
 *
 * Asserted on `inserted`, the count of rows that did not exist. Reverting the
 * fix fails this: `saved` is 1 on the second pass, not 0.
 */
async function testDetectionCountsOnlyNewRows() {
  const category = "dedupe_probe";
  const ids: string[] = [];
  const seed = (db: InstanceType<typeof Database>) => {
    const insert = db.prepare(
      `INSERT INTO signals (id, original_id, source, timestamp, category, severity, value, unit, description, synthetic)
       VALUES (?, ?, 'dedupe-probe', ?, ?, 'high', ?, 'n/a', 'probe', 0)`,
    );
    // A flat baseline plus one far outlier: a z-score the anomaly detector
    // cannot miss, so the first pass is guaranteed to create a row.
    for (let i = 0; i < 12; i++) {
      const id = `dp-${i}`;
      ids.push(id);
      const at = new Date(Date.now() - (12 - i) * 1000).toISOString();
      insert.run(id, id, at, category, i === 11 ? 100000 : 10);
    }
  };

  let db = new Database(join(dataDir, "e2e.db"));
  try {
    seed(db);
  } finally {
    db.close();
  }

  try {
    const first = await post("/api/issues/detect");
    assertStatus(first.response, 200, "first detection");
    assert(
      first.data.inserted > 0,
      `detect: the probe anomaly should create a row, got inserted=${first.data.inserted}`,
    );

    const second = await post("/api/issues/detect");
    assertStatus(second.response, 200, "second detection");
    assert(
      second.data.inserted === 0,
      `detect: re-detecting an open condition is not new, got inserted=${second.data.inserted}`,
    );
  } finally {
    // Leave no trace: the Stats test asserts on category counts.
    db = new Database(join(dataDir, "e2e.db"));
    try {
      db.prepare(`DELETE FROM signals WHERE category = ?`).run(category);
      db.prepare(`DELETE FROM issues WHERE category = ?`).run(category);
    } finally {
      db.close();
    }
  }
}

/**
 * A condition that holds without changing stays detected.
 *
 * Production's medium_activity has read 0 since before change-only storage,
 * so it is stored once and never again. Detection used to read the newest
 * 1,000 rows; after ~3 days of other streams' changes that row was no longer
 * among them, and the open "Low blog activity" issue stopped being re-seen —
 * last_seen_at froze while the blog was still silent. Detection now reads a
 * time window and carries each gauge's row in force into it
 * (detection-input.ts), so the issue is re-seen on every pass.
 *
 * Collection has to be on for that (with it off nothing is carried in), so
 * this boots with an hourly interval and a recorded last observation of now.
 * At that interval the 120-minute default holds too few samples for the trend
 * fit, so the window is widened to five intervals (effectiveWindowMinutes).
 * A trigger drops any medium_activity reading the live adapter might store,
 * so the seeded row is the only one. 1,200 newer rows of another stream, all
 * older than the window, are what pushed the row out of the old read: with
 * them, reverting to the newest-1,000 read fails this test.
 */
async function testPersistingGaugeStaysDetected() {
  const dbPath = join(dataDir, "e2e.db");
  const fingerprint = "medium_activity|issue|";
  const fourDaysAgo = new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString();

  stopServer(true);
  await sleep(500);
  let db = new Database(dbPath);
  try {
    db.transaction(() => {
      db.prepare(`DELETE FROM issues WHERE fingerprint = ?`).run(fingerprint);
      db.prepare(`DELETE FROM signals WHERE category = 'medium_activity'`).run();
      db.prepare(
        `INSERT INTO signals (id, original_id, source, timestamp, category, severity, value, unit, description, synthetic, stream)
         VALUES ('persisting-medium', 'persisting-medium', 'api', ?, 'medium_activity', 'low', 0, 'posts/week',
                 'Medium blog: 0 posts in last week', 0, 'medium_activity|blog_activity')`,
      ).run(fourDaysAgo);
      const filler = db.prepare(
        `INSERT INTO signals (id, original_id, source, timestamp, category, severity, value, unit, description, synthetic, stream)
         VALUES (?, ?, 'window-probe', ?, 'window_probe', 'low', ?, 'n/a', 'probe', 0, 'window_probe|probe')`,
      );
      // Every 3 minutes from ~66 h to 6 h ago: newer than the medium row,
      // outside the 5 h window.
      for (let i = 0; i < 1200; i++) {
        const at = new Date(Date.now() - (6 * 3600 + i * 180) * 1000).toISOString();
        filler.run(`wp-${i}`, `wp-${i}`, at, 1);
      }
      db.prepare(
        `INSERT INTO collector_state (id, last_observed_at) VALUES (1, ?)
         ON CONFLICT(id) DO UPDATE SET last_observed_at = excluded.last_observed_at`,
      ).run(new Date().toISOString());
      db.exec(`CREATE TRIGGER e2e_hold_medium BEFORE INSERT ON signals
               WHEN NEW.category = 'medium_activity' BEGIN SELECT RAISE(IGNORE); END`);
    })();
  } finally {
    db.close();
  }

  const openRow = () => {
    const reader = new Database(dbPath, { readonly: true });
    try {
      return reader
        .prepare(`SELECT id, last_seen_at, signal_ids, description FROM issues
                  WHERE fingerprint = ? AND status = 'detected'`)
        .all(fingerprint) as { id: string; last_seen_at: string; signal_ids: string; description: string }[];
    } finally {
      reader.close();
    }
  };

  try {
    await startServer({ SIGNAL_COLLECT_INTERVAL: "3600", MOSSLAND_API_URL: "http://127.0.0.1:9" });

    const first = await post("/api/issues/detect");
    assertStatus(first.response, 200, "first detection");
    assert(first.data.input?.stepSeconds === 3600, `detect: gauges sampled hourly, got ${JSON.stringify(first.data.input)}`);
    assert(
      Date.parse(first.data.input.to) - Date.parse(first.data.input.from) === 5 * 3600 * 1000,
      `detect: a 120-min window widened to five hourly intervals, got ${JSON.stringify(first.data.input)}`,
    );
    const [row] = openRow();
    assert(row, "detect: a medium_activity stored four days ago should still raise its issue");
    assert(row.description.includes("Low blog activity"), `detect: the threshold rule, got ${row.description}`);
    const ids: string[] = JSON.parse(row.signal_ids);
    assert(
      ids.length === 1 && ids[0] === "persisting-medium",
      `signal_ids: the stored row once, however many samples it was, got ${row.signal_ids}`,
    );

    await sleep(20);
    const second = await post("/api/issues/detect");
    assertStatus(second.response, 200, "second detection");
    const after = openRow();
    assert(after.length === 1 && after[0].id === row.id, "detect: the open issue is re-seen, not duplicated");
    assert(
      Date.parse(after[0].last_seen_at) > Date.parse(row.last_seen_at),
      `detect: last_seen_at should advance while the condition holds: ${row.last_seen_at} -> ${after[0].last_seen_at}`,
    );

    const listed = await get("/api/issues?limit=50");
    const issue = listed.data.issues.find((i: { id: string }) => i.id === row.id);
    assert(
      issue && issue.signals.length === 1 && issue.signals[0].id === "persisting-medium" &&
        issue.signals[0].timestamp === fourDaysAgo,
      "issues: the embedded signal is the stored row, with its own timestamp",
    );
  } finally {
    stopServer(true);
    await sleep(500);
    db = new Database(dbPath);
    try {
      db.exec("DROP TRIGGER IF EXISTS e2e_hold_medium");
      db.prepare(`DELETE FROM signals WHERE category IN ('medium_activity', 'window_probe')`).run();
      db.prepare(`DELETE FROM issues WHERE fingerprint = ? OR category = 'window_probe'`).run(fingerprint);
    } finally {
      db.close();
    }
    await startServer();
  }
}

/**
 * Opening a database that predates the `synthetic` column must migrate it,
 * and must leave /health's query with an efficient plan.
 *
 * Two regressions, both from adding an index over that column:
 *
 *   - Created alongside the other signals indexes, it ran before the ALTER
 *     TABLE that adds the column, so upgrading an existing deployment died at
 *     startup with "no such column: synthetic" and never reached the
 *     migration. Every test above runs against a fresh database, where the
 *     CREATE TABLE already has the column — so none of them saw it.
 *
 *   - With only (synthetic, category) present, the planner preferred it for
 *     /health's "newest observed signal" and sorted every observed row in a
 *     temp b-tree: 0.01ms -> 184ms on 628k observed rows, and better-sqlite3
 *     is synchronous, so every other request waited too.
 *
 * Runs db.js in its own process against a hand-built legacy schema, which is
 * the actual upgrade path and needs no server.
 */
async function testLegacyDatabaseUpgrade() {
  const legacyDir = mkdtempSync(join(tmpdir(), "oracle-legacy-"));
  const legacyDb = join(legacyDir, "legacy.db");

  try {
    // The signals table as it was before the synthetic marker existed.
    const seed = new Database(legacyDb);
    try {
      seed.exec(
        `CREATE TABLE signals (
           id TEXT PRIMARY KEY, original_id TEXT NOT NULL, source TEXT NOT NULL,
           timestamp TEXT NOT NULL, category TEXT NOT NULL, severity TEXT NOT NULL,
           value REAL NOT NULL, unit TEXT NOT NULL, description TEXT NOT NULL,
           metadata TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
         )`,
      );
      seed
        .prepare(
          `INSERT INTO signals (id, original_id, source, timestamp, category, severity, value, unit, description)
           VALUES ('legacy', 'legacy', 'api', '2026-09-01T00:00:00.000Z', 'moc_price', 'low', 1, 'n/a', 'predates synthetic')`,
        )
        .run();
    } finally {
      seed.close();
    }

    const exitCode = await new Promise<number>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["--input-type=module", "-e", `import(${JSON.stringify(pathToFileURL(join(API_ROOT, "dist", "db.js")).href)})`],
        { cwd: API_ROOT, env: { ...process.env, DB_PATH: legacyDb }, stdio: ["ignore", "pipe", "pipe"] },
      );
      const out: string[] = [];
      child.stdout?.on("data", (c) => out.push(String(c)));
      child.stderr?.on("data", (c) => out.push(String(c)));
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`db.js exited ${code} on a pre-synthetic database:\n${out.join("")}`));
          return;
        }
        resolve(code ?? 0);
      });
    });
    assert(exitCode === 0, "legacy upgrade: db.js should open a pre-synthetic database");

    const upgraded = new Database(legacyDb, { readonly: true });
    try {
      const columns = upgraded
        .prepare(`PRAGMA table_info(signals)`)
        .all() as { name: string }[];
      assert(
        columns.some((c) => c.name === "synthetic"),
        "legacy upgrade: the synthetic column should have been added",
      );

      // The exact query /health runs. A plan that sorts is the regression.
      const plan = (
        upgraded
          .prepare(
            `EXPLAIN QUERY PLAN SELECT timestamp FROM signals WHERE synthetic = 0 ORDER BY timestamp DESC LIMIT 1`,
          )
          .all() as { detail: string }[]
      )
        .map((r) => r.detail)
        .join(" | ");
      assert(
        !/TEMP B-TREE/i.test(plan),
        `health query should not sort; plan was: ${plan}`,
      );
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(legacyDir, { recursive: true, force: true });
  }
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

/**
 * Voting and delegation moved to Agora: with VOTING_ENABLED left at its
 * default, every vote and delegation write must answer 410 with a code and a
 * link a client can act on, while the reads keep serving the history. Empty
 * rather than omitted, as with the autonomous-loop flags, so an apps/api/.env
 * that turns voting on cannot change what this pins.
 */
async function testVotingOffByDefault() {
  // Created while voting is on, so the DELETE below has something real to refuse.
  const owner = voterAddress(0xd1);
  const conditions = [
    { field: "decisionPacket.issue.category", operator: "in", value: ["governance"] },
  ];
  const created = await post(
    "/api/delegations",
    { delegator: owner, delegate: "risk-agent", conditions },
    false,
  );
  assertStatus(created.response, 201, "delegation while voting is on");

  stopServer(true);
  await sleep(500);
  const logFrom = serverLog.length;
  await startServer({ VOTING_ENABLED: "" });
  try {
    assert(
      await logContains("Voting and delegation: DISABLED", logFrom),
      'startup log should say "Voting and delegation: DISABLED"',
    );

    const assertMoved = (context: string, result: { response: Response; data: any }) => {
      assertStatus(result.response, 410, context);
      assert(
        result.data?.code === "VOTING_MOVED_TO_AGORA",
        `${context}: expected code VOTING_MOVED_TO_AGORA, got ${result.data?.code}`,
      );
      assert(
        result.data?.agoraUrl === "https://agora.moss.land",
        `${context}: expected agoraUrl https://agora.moss.land, got ${result.data?.agoraUrl}`,
      );
    };

    // Admin proposal creation is unaffected; only the public writes close.
    const proposal = await createProposal({ votingPeriod: 60_000 });
    assertMoved(
      "vote with voting off",
      await post(
        `/api/proposals/${proposal.id}/vote`,
        { voter: voterAddress(0xd2), choice: "for", weight: "100" },
        false,
      ),
    );
    assertMoved(
      "delegation with voting off",
      await post(
        "/api/delegations",
        { delegator: voterAddress(0xd3), delegate: "risk-agent", conditions },
        false,
      ),
    );
    assertMoved(
      "revocation with voting off",
      await del(`/api/delegations/${created.data.policy.id}`, undefined, false),
    );

    const detail = await get(`/api/proposals/${proposal.id}`);
    assertStatus(detail.response, 200, "proposal detail with voting off");
    const history = await get(`/api/delegations?delegator=${owner}`);
    assertStatus(history.response, 200, "delegation history with voting off");
    assert(
      history.data.policies.some((p: any) => p.id === created.data.policy.id && p.active),
      "a refused revocation must leave the stored delegation as it was",
    );
  } finally {
    stopServer(true);
    await sleep(500);
    await startServer();
  }
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

/**
 * The proposal list must say which proposals were raised on demo data. Without
 * the marker the web had no way to tell 143 synthetic proposals from 21 real
 * ones, and presented all of them as governance history.
 *
 * A proposal is synthetic when its linked issue is, which is also how
 * /api/stats splits its totals — so the two are checked against each other.
 */
async function testProposalListMarksSynthetic() {
  const syntheticIssueId = "50000000-0000-4000-8000-000000000001";
  const db = new Database(join(dataDir, "e2e.db"));
  try {
    db.prepare(
      `INSERT INTO issues (id, title, description, category, priority, status, detected_at, synthetic)
       VALUES (?, 'Demo issue', 'Raised on demo signals', 'governance', 'low', 'resolved', ?, 1)`,
    ).run(syntheticIssueId, new Date().toISOString());
  } finally {
    db.close();
  }

  const packet = decisionPacket();
  packet.issueId = syntheticIssueId;
  packet.issue.id = syntheticIssueId;
  const created = await post("/api/proposals", {
    decisionPacket: packet,
    proposer: voterAddress(0xbeef),
    options: { quorum: 1, threshold: 50, votingPeriod: 60_000 },
  });
  assertStatus(created.response, 201, "create proposal on a synthetic issue");
  const syntheticId: string = created.data.proposal.id;
  const observedId: string = (await createProposal({ votingPeriod: 60_000 })).id;

  const list = async (query: string) => {
    const { response, data } = await get(`/api/proposals${query}`);
    assertStatus(response, 200, `list proposals${query}`);
    assert(
      data.count === data.proposals.length,
      `list proposals${query}: count ${data.count} != ${data.proposals.length} rows`,
    );
    return data.proposals as { id: string; synthetic: unknown }[];
  };
  const ids = (rows: { id: string }[]) => new Set(rows.map((p) => p.id));

  const all = await list("");
  assert(
    all.every((p) => typeof p.synthetic === "boolean"),
    "every listed proposal should carry a boolean synthetic marker",
  );
  assert(
    all.find((p) => p.id === syntheticId)?.synthetic === true,
    "a proposal on a synthetic issue should be marked synthetic",
  );
  assert(
    all.find((p) => p.id === observedId)?.synthetic === false,
    "a proposal on no stored issue should not be marked synthetic",
  );

  const excluded = await list("?synthetic=exclude");
  assert(
    excluded.every((p) => p.synthetic === false) && ids(excluded).has(observedId),
    "synthetic=exclude should return only non-synthetic proposals",
  );
  const only = await list("?synthetic=only");
  assert(
    only.every((p) => p.synthetic === true) && ids(only).has(syntheticId),
    "synthetic=only should return only synthetic proposals",
  );
  assert(
    excluded.length + only.length === all.length,
    "exclude and only should partition the full list",
  );
  const included = await list("?synthetic=include");
  assert(included.length === all.length, "synthetic=include should be the default");

  // The proposals page filters on both at once, so they must combine.
  const activeObserved = await list("?status=active&synthetic=exclude");
  assert(
    activeObserved.every((p) => p.synthetic === false) &&
      ids(activeObserved).has(observedId) &&
      !ids(activeObserved).has(syntheticId),
    "status and synthetic filters should apply together",
  );

  const stats = await get("/api/stats");
  assertStatus(stats.response, 200, "stats");
  assert(
    stats.data.proposals.synthetic.total === only.length &&
      stats.data.proposals.total === excluded.length,
    `list and stats disagree on synthetic proposals: stats ${stats.data.proposals.total}+${stats.data.proposals.synthetic.total}, list ${excluded.length}+${only.length}`,
  );

  const invalid = await get("/api/proposals?synthetic=hide");
  assertStatus(invalid.response, 400, "unknown synthetic filter");
}

/**
 * The full proposal list is 3.38MB in production and it could not be asked for
 * less; limit and offset page it after the filters, and without them the
 * answer is exactly what it was.
 */
async function testProposalListPaging() {
  // At least three, whatever ran before.
  await createProposal({ votingPeriod: 60_000 });
  await createProposal({ votingPeriod: 60_000 });
  const newest = await createProposal({ votingPeriod: 60_000 });

  const full = await get("/api/proposals");
  assertStatus(full.response, 200, "unpaged list");
  const all: string[] = full.data.proposals.map((p: { id: string }) => p.id);
  assert(
    full.data.count === all.length && full.data.returned === all.length && all.length >= 3,
    `unpaged list: count ${full.data.count} and returned ${full.data.returned} should both be ${all.length}`,
  );

  const first = await get("/api/proposals?limit=2");
  assertStatus(first.response, 200, "first page");
  assert(
    first.data.count === all.length && first.data.returned === 2,
    `first page: expected count ${all.length} and returned 2, got ${first.data.count}/${first.data.returned}`,
  );
  assert(
    first.data.proposals.map((p: { id: string }) => p.id).join() === all.slice(0, 2).join(),
    "first page should be the head of the unpaged list",
  );
  assert(
    typeof first.data.proposals[0].tally === "object",
    "paged rows should carry their tally like unpaged ones",
  );

  const second = await get("/api/proposals?limit=2&offset=1");
  assert(
    second.data.proposals.map((p: { id: string }) => p.id).join() === all.slice(1, 3).join(),
    "offset should shift the page along the same order",
  );

  const past = await get(`/api/proposals?offset=${all.length}`);
  assert(
    past.data.returned === 0 && past.data.count === all.length,
    "an offset past the end should return an empty page but the full count",
  );

  // Pages are cut oldest first unless asked otherwise: the default is the
  // unpaged order, and order=desc puts the newest proposal on the first page.
  const ids = (data: any) => data.proposals.map((p: { id: string }) => p.id).join();
  const asc = await get("/api/proposals?order=asc");
  assert(ids(asc.data) === all.join(), "order=asc should be the default, unpaged order");
  const latest = await get("/api/proposals?order=desc&limit=1");
  assertStatus(latest.response, 200, "newest page");
  assert(
    latest.data.returned === 1 && latest.data.proposals[0].id === newest.id,
    `order=desc&limit=1 should be the proposal created last (${newest.id}), got ${ids(latest.data)}`,
  );
  const desc = await get("/api/proposals?order=desc");
  const created = desc.data.proposals.map((p: { createdAt: string }) => Date.parse(p.createdAt));
  assert(
    desc.data.count === all.length &&
      created.every((t: number, i: number) => i === 0 || created[i - 1] >= t),
    "order=desc should list every proposal, newest createdAt first",
  );
  const descPage = await get("/api/proposals?order=desc&limit=2&offset=1");
  assert(
    ids(descPage.data) === desc.data.proposals.slice(1, 3).map((p: { id: string }) => p.id).join(),
    "offset should shift a desc page along the desc order",
  );
  const badOrder = await get("/api/proposals?order=newest");
  assertStatus(badOrder.response, 400, "unknown order");

  // count is the filtered total, not the table's.
  const excluded = await get("/api/proposals?synthetic=exclude");
  const excludedPage = await get("/api/proposals?synthetic=exclude&limit=1");
  assert(
    excludedPage.data.count === excluded.data.count && excludedPage.data.returned === 1,
    "count should be the total matching the filters",
  );

  const oversized = await get("/api/proposals?limit=100000");
  assertStatus(oversized.response, 200, "oversized limit");
  assert(
    oversized.data.returned === Math.min(all.length, 200),
    `limit should be capped at 200, got ${oversized.data.returned}`,
  );

  for (const query of ["limit=0", "limit=abc", "limit=-1", "limit=1.5", "offset=-1", "offset=x"]) {
    const bad = await get(`/api/proposals?${query}`);
    assertStatus(bad.response, 400, `malformed paging ${query}`);
  }
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

/**
 * A vote that never reached quorum decided nothing, and must not be reported
 * as a rejection. Production closed 163 proposals as "rejected" with zero
 * votes each, which /api/stats then published as 163 decisions against.
 *
 * Three closes, one per branch of finalizeProposal: no votes at all, a
 * unanimous "for" that still fell short of quorum, and a quorate "against" —
 * the only one of the three that is a rejection.
 */
async function testUnquorateProposalExpires() {
  const statsBefore = await get("/api/stats");
  assertStatus(statsBefore.response, 200, "stats before expiry");
  assert(
    typeof statsBefore.data.proposals.expired === "number",
    "stats: proposals should carry an expired count",
  );
  assert(
    typeof statsBefore.data.proposals.synthetic.expired === "number",
    "stats: the synthetic split should carry an expired count too",
  );

  const noVotes = await createProposal({ quorum: 1, votingPeriod: 800 });
  const shortOfQuorum = await createProposal({ quorum: 2, votingPeriod: 800 });
  const quorateAgainst = await createProposal({ quorum: 1, votingPeriod: 800 });

  const forVote = await post(
    `/api/proposals/${shortOfQuorum.id}/vote`,
    { voter: voterAddress(51), choice: "for", weight: "10" },
    false,
  );
  assertStatus(forVote.response, 201, "vote on the short-of-quorum proposal");
  const againstVote = await post(
    `/api/proposals/${quorateAgainst.id}/vote`,
    { voter: voterAddress(52), choice: "against", weight: "10" },
    false,
  );
  assertStatus(againstVote.response, 201, "vote on the quorate proposal");

  await sleep(1000);

  const expectations: [string, string, string][] = [
    [noVotes.id, "expired", "zero votes"],
    [shortOfQuorum.id, "expired", "one 'for' vote against a quorum of 2"],
    [quorateAgainst.id, "rejected", "a quorate 'against' vote"],
  ];
  for (const [id, expected, label] of expectations) {
    const finalized = await post(`/api/proposals/${id}/finalize`);
    assertStatus(finalized.response, 200, `finalize with ${label}`);
    assert(
      finalized.data.proposal.status === expected,
      `finalize with ${label}: expected ${expected}, got ${finalized.data.proposal.status}`,
    );
  }

  const statsAfter = await get("/api/stats");
  assert(
    statsAfter.data.proposals.expired === statsBefore.data.proposals.expired + 2,
    `stats: expected 2 more expired, got ${statsAfter.data.proposals.expired}`,
  );
  assert(
    statsAfter.data.proposals.rejected === statsBefore.data.proposals.rejected + 1,
    `stats: expected exactly 1 more rejected, got ${statsAfter.data.proposals.rejected}`,
  );

  const listed = await get("/api/proposals?status=expired");
  assertStatus(listed.response, 200, "list expired proposals");
  const listedIds = new Set(listed.data.proposals.map((p: any) => p.id));
  assert(
    listedIds.has(noVotes.id) && listedIds.has(shortOfQuorum.id) && !listedIds.has(quorateAgainst.id),
    "status=expired should list exactly the two unquorate proposals from this test",
  );
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

  // A decision taken on invented evidence has to be recorded as such, or the
  // agents read it back as precedent in a real deliberation. There is no
  // endpoint for decision history — it only ever feeds the agent prompts — so
  // this reads the row the server wrote.
  const syntheticIssueId = "40000000-0000-4000-8000-000000000002";
  const onSynthetic = await post("/api/deliberate", {
    issue: {
      id: syntheticIssueId,
      title: "Inline issue from demo signals",
      description: "supplied by the caller, marked invented",
      category: "governance",
      priority: "high",
      synthetic: true,
    },
  });
  assertStatus(onSynthetic.response, 200, "deliberate on a synthetic inline issue");

  const db = new Database(join(dataDir, "e2e.db"), { readonly: true });
  try {
    const marker = (id: string) =>
      db
        .prepare("SELECT synthetic FROM decision_history WHERE issue_id = ? ORDER BY created_at DESC LIMIT 1")
        .get(id) as { synthetic: number } | undefined;
    assert(
      marker(syntheticIssueId)?.synthetic === 1,
      "a decision on a synthetic issue should be recorded as synthetic",
    );
    assert(
      marker("40000000-0000-4000-8000-000000000001")?.synthetic === 0,
      "a decision on an observed issue should not be recorded as synthetic",
    );
  } finally {
    db.close();
  }
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
 * Rows written before "expired" existed say "rejected" for every proposal that
 * did not pass. Boot must relabel the ones that never reached quorum, persist
 * that, leave a genuine rejection alone, and do nothing on the boot after.
 *
 * The old label is written straight into SQLite, which is exactly what an
 * earlier build (or a rollback to one) leaves behind.
 */
async function testRestoredRejectionIsRelabelled() {
  const unquorate = await createProposal({ quorum: 1, votingPeriod: 800 });
  const genuine = await createProposal({ quorum: 1, votingPeriod: 800 });
  const against = await post(
    `/api/proposals/${genuine.id}/vote`,
    { voter: voterAddress(61), choice: "against", weight: "10" },
    false,
  );
  assertStatus(against.response, 201, "vote on the genuinely rejected proposal");
  await sleep(1000);
  for (const id of [unquorate.id, genuine.id]) {
    assertStatus((await post(`/api/proposals/${id}/finalize`)).response, 200, "finalize");
  }

  // Put back what the old finalizer wrote for the unquorate one.
  const readStatus = (id: string) => {
    const db = new Database(join(dataDir, "e2e.db"), { readonly: true });
    try {
      return (db.prepare("SELECT status FROM proposals WHERE id = ?").get(id) as any)?.status;
    } finally {
      db.close();
    }
  };
  const db = new Database(join(dataDir, "e2e.db"));
  try {
    db.prepare("UPDATE proposals SET status = 'rejected' WHERE id = ?").run(unquorate.id);
  } finally {
    db.close();
  }
  assert(readStatus(genuine.id) === "rejected", "the quorate proposal was stored as rejected");

  const logMark = serverLog.length;
  stopServer(true);
  await sleep(500);
  await startServer();

  assert(
    await logContains("relabelled 1 zero-quorum proposals as expired", logMark),
    "boot should log the relabel with its count",
  );

  const relabelled = await get(`/api/proposals/${unquorate.id}`);
  assert(
    relabelled.data.proposal.status === "expired",
    `restored unquorate proposal: expected expired, got ${relabelled.data.proposal.status}`,
  );
  assert(readStatus(unquorate.id) === "expired", "the relabel should be persisted, not only in memory");

  const untouched = await get(`/api/proposals/${genuine.id}`);
  assert(
    untouched.data.proposal.status === "rejected",
    `a quorate rejection must stay rejected, got ${untouched.data.proposal.status}`,
  );

  // Idempotent: nothing left to relabel on the next boot.
  const secondMark = serverLog.length;
  stopServer(true);
  await sleep(500);
  await startServer();
  // The listen-time lines are the last a boot writes, so once they are in the
  // log the hydration line would have been too.
  assert(
    await logContains("Auto finalize", secondMark),
    "second boot should have finished logging its startup",
  );
  assert(
    !serverLog.slice(secondMark).join("").includes("zero-quorum proposals as expired"),
    "a second boot should find nothing to relabel",
  );

  // A quorate rejection whose vote row fails to restore has a short tally in
  // memory. It must not be relabelled on that evidence: the write is
  // permanent, and repairing the row afterwards would not bring "rejected"
  // back.
  const setGenuineVoteWeight = (weight: string) => {
    const rw = new Database(join(dataDir, "e2e.db"));
    try {
      rw.prepare("UPDATE votes SET weight = ? WHERE proposal_id = ?").run(weight, genuine.id);
    } finally {
      rw.close();
    }
  };
  setGenuineVoteWeight("not-a-number");
  const thirdMark = serverLog.length;
  stopServer(true);
  await sleep(500);
  await startServer();
  assert(
    await logContains("not relabelled as expired", thirdMark),
    "boot should say why it left a proposal with unrestored votes alone",
  );
  assert(
    readStatus(genuine.id) === "rejected",
    "a rejection with an unreadable vote row must stay rejected in storage",
  );

  setGenuineVoteWeight("10");
  stopServer(true);
  await sleep(500);
  await startServer();
  const repaired = await get(`/api/proposals/${genuine.id}`);
  assert(
    repaired.data.proposal.status === "rejected",
    `after the vote row is repaired the proposal is still rejected, got ${repaired.data.proposal.status}`,
  );
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

  // The demo adapter is on for this suite (see startServer), so every signal
  // collected here is invented. That makes this the case the endpoint exists to
  // get right: the demo rows must be reported, and must be reported *beside*
  // the observed counts rather than inside them.
  assert(
    data.signals.synthetic.total > 0,
    "stats: demo signals should still be reported, not dropped",
  );
  const sumCounts = (buckets: { count: number }[]) =>
    buckets.reduce((total: number, bucket) => total + bucket.count, 0);
  assert(
    sumCounts(data.signals.byCategory) === data.signals.total,
    `stats: observed categories should sum to the observed total, got ${sumCounts(
      data.signals.byCategory,
    )} vs ${data.signals.total}`,
  );
  assert(
    sumCounts(data.signals.synthetic.byCategory) === data.signals.synthetic.total,
    "stats: demo categories should sum to the demo total",
  );
  // Compared against the response's own buckets rather than a copy of
  // MockAdapter's category list, so this keeps testing the boundary and not the
  // list.
  const demoCategories = new Set<string>(
    data.signals.synthetic.byCategory.map((bucket: { category: string }) => bucket.category),
  );
  const leaked = data.signals.byCategory
    .filter((bucket: { category: string }) => demoCategories.has(bucket.category))
    .map((bucket: { category: string }) => bucket.category);
  assert(
    leaked.length === 0,
    `stats: demo categories counted as observed: ${leaked.join(", ")}`,
  );
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

  // Added fields. Conditions are distinct open fingerprints, so never more
  // than the rows; the last day's rows are a subset of all rows.
  for (const [label, value] of [
    ["signals.lastDay", data.signals.lastDay],
    ["issues.conditions", data.issues.conditions],
    ["issues.synthetic.conditions", data.issues.synthetic.conditions],
    ["issues.openRows", data.issues.openRows],
    ["issues.synthetic.openRows", data.issues.synthetic.openRows],
  ] as const) {
    assert(
      Number.isInteger(value) && value >= 0,
      `stats: ${label} should be a count, got ${JSON.stringify(value)}`,
    );
  }
  assert(
    data.signals.lastDay <= data.signals.total,
    `stats: ${data.signals.lastDay} rows in the last day exceeds ${data.signals.total} in total`,
  );
  // conditions are counted over openRows, which are a subset of all rows.
  for (const scope of [data.issues, data.issues.synthetic]) {
    assert(
      scope.conditions <= scope.openRows && scope.openRows <= scope.total,
      `stats: expected conditions <= openRows <= total, got ${scope.conditions}/${scope.openRows}/${scope.total}`,
    );
  }
  assert(
    typeof data.asOf === "string" && !Number.isNaN(Date.parse(data.asOf)),
    `stats: asOf should be a timestamp, got ${JSON.stringify(data.asOf)}`,
  );
}

/**
 * /api/stats is served from a cache that the Socket.IO connect handler shares,
 * dropped by a successful write that can move its figures and by nothing else.
 *
 * Also pins what `conditions` means: rows left over from before open issues
 * were folded by fingerprint count once per condition, not once per row.
 */
async function testStatsCache() {
  const first = await get("/api/stats");
  assertStatus(first.response, 200, "stats");
  const again = await get("/api/stats");
  assert(
    JSON.stringify(again.data) === JSON.stringify(first.data),
    "stats: a second read inside the window should be the cached payload",
  );

  const agree = (socket: any, stats: any, label: string) =>
    assert(
      socket.signals === stats.signals.total &&
        socket.issues === stats.issues.total &&
        socket.proposals === stats.proposals.total &&
        socket.activeProposals === stats.proposals.active &&
        socket.synthetic.signals === stats.signals.synthetic.total &&
        socket.synthetic.issues === stats.issues.synthetic.total &&
        socket.synthetic.proposals === stats.proposals.synthetic.total,
      `${label}: socket ${JSON.stringify(socket)} disagrees with /api/stats`,
    );
  agree(await socketStats(), first.data, "on connect");

  // Three open rows of one condition, one of another, one closed: as legacy
  // duplicates would sit in the table. Written behind the API's back, so the
  // cache cannot know about them until something invalidates it.
  const category = "conditions_probe";
  const at = new Date().toISOString();
  const db = new Database(join(dataDir, "e2e.db"));
  try {
    const insert = db.prepare(
      `INSERT INTO issues (id, title, description, category, priority, status, detected_at, synthetic, fingerprint)
       VALUES (?, 'probe', 'probe', ?, 'low', ?, ?, 0, ?)`,
    );
    insert.run("cp-1", category, "detected", at, `${category}|issue|up`);
    insert.run("cp-2", category, "detected", at, `${category}|issue|up`);
    insert.run("cp-3", category, "deliberating", at, `${category}|issue|up`);
    insert.run("cp-4", category, "detected", at, `${category}|issue|down`);
    insert.run("cp-5", category, "resolved", at, `${category}|anomaly|up`);
  } finally {
    db.close();
  }

  try {
    const cached = await get("/api/stats");
    assert(
      cached.data.asOf === first.data.asOf && cached.data.issues.total === first.data.issues.total,
      "stats: an out-of-band row should not show before the cache is dropped",
    );
    // The rows are in the table now, so a handler that counted per connection
    // would report five more. Only one that reads the cache reports none.
    const socketCached = await socketStats();
    assert(
      socketCached.issues === first.data.issues.total,
      `stats: the socket should read the cache, got ${socketCached.issues} issue rows against ${first.data.issues.total} cached`,
    );

    // A refused write changed nothing, so it must not cost a recomputation.
    const refused = await post("/api/proposals", { decisionPacket: {} });
    assertStatus(refused.response, 400, "malformed proposal");
    const stillCached = await get("/api/stats");
    assert(
      stillCached.data.asOf === first.data.asOf,
      "stats: a failed write should leave the cache in place",
    );

    // Nor does a public write that succeeds but moves nothing stats counts:
    // otherwise anyone could force a recomputation every other request.
    const anyProposal = await get("/api/proposals?limit=1");
    const tally = await post(
      `/api/proposals/${anyProposal.data.proposals[0].id}/tally`,
      undefined,
      false,
    );
    assertStatus(tally.response, 200, "tally");
    const afterTally = await get("/api/stats");
    assert(
      afterTally.data.asOf === first.data.asOf,
      "stats: a read-only tally should leave the cache in place",
    );

    // Any successful write, not only the ones that recompute on purpose.
    await createProposal({ votingPeriod: 60_000 });
    const fresh = await get("/api/stats");
    assert(fresh.data.asOf !== first.data.asOf, "stats: a successful write should drop the cache");
    assert(
      fresh.data.proposals.total === first.data.proposals.total + 1,
      "stats: the new proposal should be counted after the write",
    );
    assert(
      fresh.data.issues.total === first.data.issues.total + 5,
      `stats: expected 5 more issue rows, got ${fresh.data.issues.total - first.data.issues.total}`,
    );
    assert(
      fresh.data.issues.conditions === first.data.issues.conditions + 2,
      `stats: 4 open rows of 2 conditions should add 2 conditions, got ${
        fresh.data.issues.conditions - first.data.issues.conditions
      }`,
    );
    assert(
      fresh.data.issues.openRows === first.data.issues.openRows + 4,
      `stats: the resolved probe row should not count as open, got ${
        fresh.data.issues.openRows - first.data.issues.openRows
      } more open rows`,
    );
    agree(await socketStats(), fresh.data, "after a write");

    // A collection recomputes at once, so its event and the next read agree.
    const collected = await post("/api/signals/collect");
    assertStatus(collected.response, 200, "collect signals");
    const afterCollect = await get("/api/stats");
    assert(
      afterCollect.data.signals.total + afterCollect.data.signals.synthetic.total ===
        fresh.data.signals.total +
          fresh.data.signals.synthetic.total +
          collected.data.stored +
          collected.data.synthetic,
      "stats: the collected rows should be counted after a collection",
    );
  } finally {
    const cleanup = new Database(join(dataDir, "e2e.db"));
    try {
      cleanup.prepare(`DELETE FROM issues WHERE category = ?`).run(category);
    } finally {
      cleanup.close();
    }
    // Drop the cache again so nothing after this reads the probe rows.
    await post("/api/signals/collect");
  }
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
    await runTest("Autonomous loop is off by default", testAutonomousLoopOffByDefault);
    await runTest("HOST binds one address and TRUST_PROXY names the proxy", testBindHostAndTrustedProxy);
    await runTest("An invalid TRUST_PROXY stops the boot", testInvalidTrustProxyStopsBoot);
    await runTest("Health ignores synthetic signals", testHealthIgnoresSyntheticSignals);
    await runTest("Health staleness rule", testHealthStalenessRule);
    await runTest("Health reports down when the database cannot be read", testHealthReportsDown);
    await runTest("No success rate before anything is measured", testStatsBeforeAnyOutcome);
    await runTest("Admin endpoints require the key", testAdminAuthRequired);
    await runTest("Signals and issues", testSignalsAndIssues);
    await runTest("Signal change filter rule", testSignalChangeFilterRule);
    await runTest("Unchanged signals are not stored", testUnchangedSignalsAreNotStored);
    await runTest("Large issue pages leave signals out", testIssueListDefaults);
    await runTest("Detection counts only new rows", testDetectionCountsOnlyNewRows);
    await runTest("A persisting condition stays detected", testPersistingGaugeStaysDetected);
    await runTest("Legacy database upgrades and keeps health fast", testLegacyDatabaseUpgrade);
    await runTest("Proposal settings are validated", testProposalValidation);
    await runTest("Voting integrity", testVotingIntegrity);
    await runTest("Voting and delegation are off by default", testVotingOffByDefault);
    await runTest("Proposal responses carry a tally", testProposalListIncludesTally);
    await runTest("Proposal list marks synthetic proposals", testProposalListMarksSynthetic);
    await runTest("Proposal list pages", testProposalListPaging);
    await runTest("Voting timeline is enforced", testVotingTimeline);
    await runTest("A vote without quorum expires", testUnquorateProposalExpires);
    await runTest("Execution and measured outcome", testExecutionAndMeasuredOutcome);
    await runTest("Deliberation contract", testDeliberationContract);
    await runTest("Debate rounds are bounded", testDebateRoundsAreBounded);
    await runTest("Delegation authorization", testDelegationAuthorization);
    await runTest("Delegation requires a signature", testDelegationRequiresSignature);
    await runTest("Restart restores governance state", testRestartRestoresState);
    await runTest("Stored zero-quorum rejections are relabelled", testRestoredRejectionIsRelabelled);
    // Runs after the restart test on purpose: that test asserts exactly one
    // measured proof survived, and this one mints a second.
    await runTest("A fully successful outcome", testFullySuccessfulOutcome);
    await runTest("Stats", testStats);
    await runTest("Stats cache is shared with the socket and dropped on writes", testStatsCache);
    await runTest("Unknown ids return 404", testNotFoundPaths);
    // Last: it deletes the observed signals earlier tests count.
    await runTest("Health is degraded while ingestion stalls", testHealthWhileIngestionStalls);
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
