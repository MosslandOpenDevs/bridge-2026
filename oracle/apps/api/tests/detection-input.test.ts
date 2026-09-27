/**
 * What issue detection reads (src/detection-input.ts).
 *
 * The rule runs over hand-built rows; the reads run through db.ts's own
 * statements against a throwaway SQLite file, so the queries index.ts uses are
 * the ones exercised. The detectors are the real ones, configured the way
 * index.ts configures the rules these cases touch.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ThresholdDetector, AnomalyDetector, TrendDetector } from "@oracle/inference-mining";
import {
  buildDetectionInput,
  collapseRepeatedSignals,
  detectionWindow,
  GAUGE_STREAMS,
  gaugeStreamOf,
  readDetectionRows,
  type DetectionRows,
  type StoredSignalRow,
} from "../src/detection-input.js";
import { SignalChangeFilter } from "../src/signal-dedupe.js";

/* ------------------------------ harness ------------------------------ */

let failures = 0;
async function runTest(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`✅ ${name}`);
  } catch (error: any) {
    failures++;
    console.log(`❌ ${name}: ${error?.message ?? error}`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/* ------------------------------ fixtures ----------------------------- */

const NOW = new Date("2026-09-27T12:00:00.000Z");
const MIN = 60_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

let seq = 0;
function row(overrides: Partial<StoredSignalRow> & Pick<StoredSignalRow, "category" | "timestamp">): StoredSignalRow {
  const id = overrides.id ?? `row-${++seq}`;
  return {
    id,
    original_id: `orig-${id}`,
    source: "api",
    severity: "low",
    value: 0,
    unit: "n/a",
    description: `${overrides.category} reading`,
    metadata: null,
    synthetic: 0,
    stream: null,
    ...overrides,
  };
}

const mediumActivity = (timestamp: string, value = 0, id?: string) =>
  row({
    id,
    category: "medium_activity",
    stream: "medium_activity|blog_activity",
    timestamp,
    value,
    description: `Medium blog: ${value} posts in last week`,
  });

/** Every gauge stream last observed at `at`, as when all adapters answer. */
const allObservedAt = (at: string | null) =>
  new Map(at ? [...GAUGE_STREAMS.keys()].map((stream) => [stream, at] as const) : []);

/**
 * The window a production pass would read: 120 min, one sample a minute. By
 * default every stream was observed when the collector last was.
 */
const window60 = (lastObservedAt: string | null, streamObservedAt = allObservedAt(lastObservedAt)) =>
  detectionWindow({ now: NOW, windowMinutes: 120, collectIntervalSeconds: 60, lastObservedAt, streamObservedAt });

/** The medium_activity rule exactly as index.ts has it. */
const lowBlogActivity = new ThresholdDetector({
  rules: [
    {
      category: "medium_activity",
      operator: "lte",
      value: 2,
      priority: "low",
      message: "Low blog activity this week",
    },
  ],
});

const toSignals = (rows: StoredSignalRow[]) =>
  rows.map((r) => ({
    id: r.id,
    originalId: r.original_id,
    source: r.source as "api",
    timestamp: new Date(r.timestamp),
    category: r.category,
    severity: r.severity as "low",
    value: r.value,
    unit: r.unit,
    description: r.description,
    synthetic: r.synthetic === 1,
  }));

/* -------------------------------- cases ------------------------------ */

function testUnchangedGaugeStillReachesTheDetectors() {
  // Stored once four days ago and never again, because it never changed.
  const stored = mediumActivity(ago(4 * 24 * 60 * MIN), 0, "medium-4d");
  const window = window60(NOW.toISOString());
  const rows: DetectionRows = { inWindow: [], carriedIn: [stored] };
  const input = buildDetectionInput(rows, window);

  assert(input.length === 121, `one sample a minute over 120 min, both ends included: got ${input.length}`);
  assert(input.every((s) => s.id === "medium-4d" && s.value === 0), "every sample is the stored reading");
  assert(input[0].timestamp === NOW.toISOString(), "newest sample is the last observation");
  assert(input[120].timestamp === ago(120 * MIN), "oldest sample is the window start");

  const issues = lowBlogActivity.analyze(toSignals(input));
  assert(issues.length === 1, `the persisting condition is detected, got ${issues.length} issues`);
  assert(issues[0].description.includes("Low blog activity"), "it is the Low blog activity rule");
}

function testEventsAreReadAsStoredInsideTheWindow() {
  const window = window60(NOW.toISOString());
  const old = row({ category: "moc_price_alert", stream: "moc_price_alert|price_alert", timestamp: ago(180 * MIN), value: 6.1 });
  const recent = row({ category: "moc_price_alert", stream: "moc_price_alert|price_alert", timestamp: ago(30 * MIN), value: 6.4 });
  const published = row({
    category: "mossland_disclosure_published",
    stream: "mossland_disclosure_published|disclosure",
    timestamp: ago(45 * MIN),
    value: 1,
  });
  // The reads return the window only, but the rule does not rely on it.
  const input = buildDetectionInput({ inWindow: [old, recent, published], carriedIn: [] }, window);

  assert(!input.some((s) => s.id === old.id), "an event 3 h old is outside a 2 h window");
  assert(input.filter((s) => s.id === recent.id).length === 1, "an event 30 min old is in it exactly once");
  assert(input.filter((s) => s.id === published.id).length === 1, "a disclosure is one event, not a series");
  assert(
    input.find((s) => s.id === recent.id)!.timestamp === recent.timestamp,
    "an event keeps its own timestamp",
  );
}

function testNoSamplesPastAStalledCollector() {
  const stored = mediumActivity(ago(4 * 24 * 60 * MIN));
  const window = window60(ago(180 * MIN));
  const input = buildDetectionInput({ inWindow: [], carriedIn: [stored] }, window);
  assert(input.length === 0, `collection stalled 3 h ago: no gauge samples, got ${input.length}`);

  // Stalled 30 min ago: sampled up to then and not after.
  const partial = buildDetectionInput({ inWindow: [], carriedIn: [stored] }, window60(ago(30 * MIN)));
  assert(partial.length === 91, `samples from -120 to -30 min, got ${partial.length}`);
  assert(partial[0].timestamp === ago(30 * MIN), "newest sample is the last observation, not now");

  const never = buildDetectionInput({ inWindow: [], carriedIn: [stored] }, window60(null));
  assert(never.length === 0, "nothing ever observed: no samples");
}

function testResampledChangePointsEqualThePerMinuteSeries() {
  // Three hours of per-minute readings, as the collector stored them before
  // #39: a price that holds, moves, moves back and holds again, with its
  // severity band moving too.
  const perMinute: StoredSignalRow[] = [];
  for (let m = 180; m >= 0; m--) {
    const value = m > 150 ? 28.1 : m > 90 ? 28.4 : m > 40 ? 28.1 : m > 10 ? 29.9 : 28.1;
    perMinute.push(
      row({
        id: `pm-${m}`,
        category: "moc_price",
        stream: "moc_price|price",
        timestamp: ago(m * MIN),
        value,
        severity: value > 29 ? "medium" : "low",
        description: `MOC Price: ₩${value}`,
      }),
    );
  }
  // What #39 keeps of them, by its own rule.
  const filter = new SignalChangeFilter([], null);
  const changePoints: StoredSignalRow[] = [];
  for (const r of perMinute) {
    const plan = filter.plan([{ ...r, timestamp: r.timestamp }], () => "moc_price|price");
    filter.commit(plan);
    if (plan.stored) changePoints.push(r);
  }
  assert(changePoints.length === 5, `five change points, got ${changePoints.length}`);

  const window = window60(NOW.toISOString());
  const rows = {
    inWindow: changePoints.filter((r) => r.timestamp >= window.start),
    carriedIn: [changePoints.filter((r) => r.timestamp < window.start).at(-1)!],
  };
  const resampled = buildDetectionInput(rows, window);
  const expected = perMinute.filter((r) => r.timestamp >= window.start).reverse();

  assert(resampled.length === expected.length, `sample count ${resampled.length} vs ${expected.length} rows`);
  for (let i = 0; i < expected.length; i++) {
    const a = resampled[i];
    const b = expected[i];
    assert(
      a.timestamp === b.timestamp && a.value === b.value && a.severity === b.severity && a.description === b.description,
      `sample ${i} at ${a.timestamp}: ${a.value}/${a.severity} vs ${b.timestamp}: ${b.value}/${b.severity}`,
    );
  }

  // And the detectors see the same thing in both.
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  const shape = (issues: ReturnType<AnomalyDetector["analyze"]>) =>
    issues.map((i) => [i.title, i.priority, i.direction, i.evidence[0]?.data]);
  for (const detector of [new AnomalyDetector({ minSamples: 3 }), new TrendDetector()]) {
    assert(
      same(shape(detector.analyze(toSignals(resampled))), shape(detector.analyze(toSignals(expected)))),
      `${detector.name}: same result over the resampled and the per-minute series`,
    );
  }
}

function testEachGaugeStopsAtItsOwnLastObservation() {
  // The collector answered a moment ago, but only through some adapters:
  // Medium's feed last answered 3 h ago, the price feed now. Its reading must
  // not be carried through the silence on the strength of the others.
  const price = row({ id: "price", category: "moc_price", stream: "moc_price|price", timestamp: ago(3 * 24 * 60 * MIN), value: 28 });
  const blog = mediumActivity(ago(4 * 24 * 60 * MIN), 0, "blog");
  const streamObservedAt = new Map([
    ["moc_price|price", NOW.toISOString()],
    ["medium_activity|blog_activity", ago(180 * MIN)],
  ]);
  const input = buildDetectionInput({ inWindow: [], carriedIn: [price, blog] }, window60(NOW.toISOString(), streamObservedAt));
  const count = (id: string) => input.filter((s) => s.id === id).length;
  assert(count("blog") === 0, `a stream silent for 3 h gets no samples, got ${count("blog")}`);
  assert(count("price") === 121, `a stream observed now gets the whole window, got ${count("price")}`);
  assert(lowBlogActivity.analyze(toSignals(input)).length === 0, "so its condition is not re-seen while it is silent");

  // Silent for the last 30 min: sampled up to then.
  const partial = buildDetectionInput(
    { inWindow: [], carriedIn: [blog] },
    window60(NOW.toISOString(), new Map([["medium_activity|blog_activity", ago(30 * MIN)]])),
  );
  assert(partial.length === 91, `samples from -120 to -30 min, got ${partial.length}`);

  // No time at all for the stream (never observed since boot): no samples
  // past its own newest row, which is itself an observation.
  const none = buildDetectionInput({ inWindow: [], carriedIn: [blog] }, window60(NOW.toISOString(), new Map()));
  assert(none.length === 0, `no observation after a row 4 days old: no samples, got ${none.length}`);
  const written = mediumActivity(ago(10 * MIN), 1, "written");
  const direct = buildDetectionInput({ inWindow: [written], carriedIn: [blog] }, window60(NOW.toISOString(), new Map()));
  assert(
    direct.length === 111 && direct[0].timestamp === ago(10 * MIN),
    `samples end at a row newer than the stream's recorded time: got ${direct.length}, newest ${direct[0]?.timestamp}`,
  );
}

function testTheFilterRecordsEachStreamsLastObservation() {
  const boot = "2026-09-27T11:00:00.000Z";
  const filter = new SignalChangeFilter(
    [{ stream: "medium_activity|blog_activity", value: 0, description: "Medium blog: 0 posts in last week", severity: "low" }],
    boot,
  );
  assert(
    filter.streamLastObservedAt.get("medium_activity|blog_activity") === boot,
    "a seeded stream starts at the collector's last observation",
  );

  const streamOf = (s: { category: string }) => `${s.category}|${s.category === "moc_price" ? "price" : "blog_activity"}`;
  const reading = (category: string, value: number, timestamp: string, description = `${category} ${value}`) => ({
    category,
    value,
    description,
    severity: "low",
    timestamp,
  });
  // A pass where only the price feed answered, with a changed price.
  const t1 = "2026-09-27T11:01:00.000Z";
  const pass = filter.plan([reading("moc_price", 28, t1)], streamOf);
  assert(filter.streamLastObservedAt.get("moc_price|price") === undefined, "nothing is recorded before commit");
  filter.commit(pass);
  assert(filter.streamLastObservedAt.get("moc_price|price") === t1, "a stored reading is an observation");
  assert(
    filter.streamLastObservedAt.get("medium_activity|blog_activity") === boot,
    "a stream absent from the pass keeps its time",
  );

  // An unchanged reading is not stored, but it is still an observation.
  const t2 = "2026-09-27T11:02:00.000Z";
  const same = filter.plan(
    [reading("medium_activity", 0, t2, "Medium blog: 0 posts in last week"), reading("moc_price", 28, t2)],
    streamOf,
  );
  assert(same.stored === 0 && same.skipped === 2, "both unchanged");
  filter.commit(same);
  assert(filter.streamLastObservedAt.get("medium_activity|blog_activity") === t2, "skipped, still observed");
  assert(filter.streamLastObservedAt.get("moc_price|price") === t2, "skipped, still observed");

  // Synthetic readings observe nothing.
  const demo = filter.plan([{ ...reading("token_price", 1, "2026-09-27T11:03:00.000Z"), synthetic: true }], streamOf);
  filter.commit(demo);
  assert(filter.streamLastObservedAt.size === 2, "a synthetic reading records no stream");

  const noBoot = new SignalChangeFilter([{ stream: "moc_price|price", value: 1, description: "x", severity: "low" }], null);
  assert(noBoot.streamLastObservedAt.size === 0, "nothing ever observed: no stream time to seed");
}

function testIssuesReferenceEachStoredRowOnce() {
  const window = window60(NOW.toISOString());
  const before = mediumActivity(ago(3 * 24 * 60 * MIN), 1, "ma-before");
  const change = mediumActivity(ago(50 * MIN), 0, "ma-change");
  const input = buildDetectionInput({ inWindow: [change], carriedIn: [before] }, window);
  assert(input.length === 121, `121 samples of two rows, got ${input.length}`);

  const [issue] = lowBlogActivity.analyze(toSignals(input)).map(collapseRepeatedSignals);
  const ids = issue.signals.map((s) => s.id);
  assert(ids.length === 2 && new Set(ids).size === 2, `each stored row once, got ${ids.join(",")}`);
  assert(ids.includes("ma-before") && ids.includes("ma-change"), "both rows are the evidence");
  assert(
    (issue.evidence[0].data as { triggeredCount: number }).triggeredCount === 121,
    "the count still describes the series",
  );

  // Anomaly evidence cites a row per anomalous sample; one citation each.
  const flat = Array.from({ length: 30 }, (_, i) =>
    row({ id: `flat-${i}`, category: "moc_market", stream: "moc_market|market_overview", timestamp: ago((119 - i) * MIN), value: 100 }),
  );
  const spike = row({ id: "spike", category: "moc_market", stream: "moc_market|market_overview", timestamp: ago(89 * MIN), value: 900 });
  const back = row({ id: "back", category: "moc_market", stream: "moc_market|market_overview", timestamp: ago(80 * MIN), value: 100 });
  const sampled = buildDetectionInput({ inWindow: [...flat, spike, back], carriedIn: [] }, window);
  const [anomaly] = new AnomalyDetector({ minSamples: 3 }).analyze(toSignals(sampled)).map(collapseRepeatedSignals);
  assert(anomaly, "the spike held for 9 samples is an anomaly");
  const cited = anomaly.evidence.filter((e) => (e.data as { signalId?: string }).signalId);
  assert(cited.length === 1 && (cited[0].data as { signalId: string }).signalId === "spike", "cited once");
  assert((anomaly.evidence[0].data as { anomalyCount: number }).anomalyCount === 9, "nine anomalous samples");
}

function testCollectionOffReadsRowsAsStored() {
  const window = detectionWindow({
    now: NOW,
    windowMinutes: 120,
    collectIntervalSeconds: 0,
    lastObservedAt: NOW.toISOString(),
    streamObservedAt: allObservedAt(NOW.toISOString()),
  });
  assert(window.stepMs === null, "no step without a collection interval");

  let seeks = 0;
  const inside = mediumActivity(ago(20 * MIN), 0, "ma-inside");
  const rows = readDetectionRows(
    {
      between: () => [inside],
      latestInStream: () => {
        seeks++;
        return mediumActivity(ago(4 * 24 * 60 * MIN));
      },
      latestLegacy: () => {
        seeks++;
        return undefined;
      },
    },
    window,
  );
  assert(seeks === 0 && rows.carriedIn.length === 0, "nothing is carried in from before the window");
  const input = buildDetectionInput(rows, window);
  assert(input.length === 1 && input[0].id === "ma-inside", "a gauge row inside the window, once, as stored");
  assert(input[0].timestamp === inside.timestamp, "with its own timestamp");

  for (const bad of [Number.NaN, -60]) {
    const w = detectionWindow({ now: NOW, windowMinutes: 120, collectIntervalSeconds: bad, lastObservedAt: null, streamObservedAt: new Map() });
    assert(w.stepMs === null, `interval ${bad} reads as collection off`);
  }
}

function testWhatCountsAsAGauge() {
  const g = (category: string, stream: string | null, synthetic = 0) => gaugeStreamOf({ category, stream, synthetic });
  assert(g("medium_activity", "medium_activity|blog_activity") === "medium_activity|blog_activity", "tagged gauge");
  assert(g("medium_activity", null) === "medium_activity|blog_activity", "legacy row: the category's stream");
  assert(g("mossland_disclosure", "mossland_disclosure|disclosure") === null, "an event stream in a gauge category");
  assert(g("moc_price_alert", "moc_price_alert|price_alert") === null, "price alerts are events");
  assert(g("moc_tx_alert", "moc_tx_alert|transaction_alert") === null, "a conditional alert is an event");
  assert(g("custom_tvl", "custom_tvl|tvl") === null, "unknown categories are events");
  assert(g("moc_price", null, 1) === null, "synthetic rows are never resampled");

  // Synthetic rows pass through as stored, even when collection has stalled.
  const demo = row({ category: "token_price", timestamp: ago(10 * MIN), synthetic: 1, value: 42 });
  const input = buildDetectionInput({ inWindow: [demo], carriedIn: [] }, window60(ago(180 * MIN)));
  assert(input.length === 1 && input[0] === demo, "a synthetic row is read as stored");
}

function testLegacyRowsJoinTheirStream() {
  const window = window60(NOW.toISOString());
  // A tagged row and a legacy row at the same instant: the tagged one wins.
  const legacyTie = mediumActivity(ago(60 * MIN), 5, "legacy-tie");
  legacyTie.stream = null;
  const taggedTie = mediumActivity(ago(60 * MIN), 0, "tagged-tie");
  const legacyBefore = { ...mediumActivity(ago(150 * MIN), 7, "legacy-before"), stream: null };
  const input = buildDetectionInput({ inWindow: [taggedTie, legacyTie], carriedIn: [legacyBefore] }, window);
  const at = (minutesAgo: number) => input.find((s) => s.timestamp === ago(minutesAgo * MIN))!;
  assert(at(120).id === "legacy-before" && at(61).id === "legacy-before", "a legacy row carries in");
  assert(at(60).id === "tagged-tie" && at(0).id === "tagged-tie", "the tagged row wins a tie");
}

async function testReadsGoThroughTheIndexedStatements() {
  const dir = mkdtempSync(join(tmpdir(), "detection-input-"));
  process.env.DB_PATH = join(dir, "detect.db");
  try {
    const { default: db, detectionRowSource } = await import("../src/db.js");
    const insert = db.prepare(
      `INSERT INTO signals (id, original_id, source, timestamp, category, severity, value, unit, description, synthetic, stream)
       VALUES (@id, @original_id, @source, @timestamp, @category, @severity, @value, @unit, @description, @synthetic, @stream)`,
    );
    const put = (r: StoredSignalRow) => insert.run({ ...r, stream: r.stream ?? null });
    put(mediumActivity(ago(5 * 24 * 60 * MIN), 3, "tagged-old"));
    put(mediumActivity(ago(4 * 24 * 60 * MIN), 0, "tagged-4d"));
    put(row({ id: "legacy-price", category: "moc_price", timestamp: ago(130 * MIN), value: 28 }));
    put(row({ id: "legacy-too-old", category: "moc_market", timestamp: ago(300 * MIN), value: 1 }));
    put(row({ id: "alert", category: "moc_price_alert", stream: "moc_price_alert|price_alert", timestamp: ago(30 * MIN), value: 6 }));
    put(row({ id: "alert-old", category: "moc_price_alert", stream: "moc_price_alert|price_alert", timestamp: ago(200 * MIN), value: 6 }));

    const window = window60(NOW.toISOString());
    const rows = readDetectionRows(detectionRowSource, window);
    const carried = rows.carriedIn.map((r) => r.id).sort();
    assert(
      carried.join(",") === "legacy-price,tagged-4d",
      `the newest tagged row, and a legacy row only within one window before the start: got ${carried}`,
    );
    assert(rows.inWindow.map((r) => r.id).join(",") === "alert", `the window read, got ${rows.inWindow.map((r) => r.id)}`);

    const plan = (sql: string, n: number) =>
      (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...Array(n).fill("x")) as { detail: string }[])
        .map((p) => p.detail)
        .join(" ");
    assert(
      /USING INDEX idx_signals_timestamp/.test(plan("SELECT * FROM signals WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp DESC", 2)),
      "window read is a timestamp range",
    );
    assert(
      /USING INDEX idx_signals_stream/.test(plan("SELECT * FROM signals WHERE stream = ? AND timestamp < ? ORDER BY timestamp DESC LIMIT 1", 2)),
      "carry-in is a stream seek",
    );
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/* --------------------------------- run -------------------------------- */

async function main() {
  console.log("\n🧪 Detection input\n");
  await runTest("An unchanged gauge still reaches the detectors", testUnchangedGaugeStillReachesTheDetectors);
  await runTest("Events are read as stored, inside the window", testEventsAreReadAsStoredInsideTheWindow);
  await runTest("No samples past a stalled collector", testNoSamplesPastAStalledCollector);
  await runTest("Each gauge stops at its own last observation", testEachGaugeStopsAtItsOwnLastObservation);
  await runTest("The filter records each stream's last observation", testTheFilterRecordsEachStreamsLastObservation);
  await runTest("Resampled change points equal the per-minute series", testResampledChangePointsEqualThePerMinuteSeries);
  await runTest("Issues reference each stored row once", testIssuesReferenceEachStoredRowOnce);
  await runTest("Collection off reads rows as stored", testCollectionOffReadsRowsAsStored);
  await runTest("What counts as a gauge", testWhatCountsAsAGauge);
  await runTest("Legacy rows join their stream", testLegacyRowsJoinTheirStream);
  await runTest("Reads go through the indexed statements", testReadsGoThroughTheIndexedStatements);
  console.log(failures === 0 ? "\n   all passed\n" : `\n   ${failures} failed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
