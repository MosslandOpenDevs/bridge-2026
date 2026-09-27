/**
 * MosslandAdapter behaviour that produced BRIDGE's bogus proposals.
 *
 * Runs the real adapter against a stubbed global fetch, so nothing here
 * touches disclosure.moss.land. The payload shapes are the live ones (checked
 * against GET /api/disclosure and /api/getTickerKrw on 2026-09-26). The stored
 * side goes through loadMosslandAdapterState over an in-memory SQLite, the
 * same query the API runs at boot.
 */

import Database from "better-sqlite3";
import {
  MosslandAdapter,
  type MosslandNormalizedSignal,
} from "@oracle/reality-oracle";
import { loadMosslandAdapterState } from "../src/mossland-state.js";

/* ------------------------------ harness ------------------------------ */

let failures = 0;
async function runTest(name: string, fn: () => Promise<void>) {
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

/* ------------------------------- stubs ------------------------------- */

interface Doc {
  date: string;
  title: string;
  url: string;
}

const doc = (n: number, date = "2026.09"): Doc => ({
  date,
  title: `Disclosure ${n} (KOREAN)`,
  url: `https://github.com/mossland/Disclosure-and-Materials/blob/main/disclosures/doc-${n}.md`,
});

/** Newest first, like the live endpoint. */
let disclosures: Doc[] = [];

/** The fields of Upbit's KRW-MOC ticker the adapter reads. */
const tick = (signedRate: number, tradeDate = "20260926") => ({
  market: "KRW-MOC",
  trade_price: 30.6,
  change: signedRate > 0 ? "RISE" : signedRate < 0 ? "FALL" : "EVEN",
  change_rate: Math.abs(signedRate),
  signed_change_rate: signedRate,
  change_price: 1.8,
  acc_trade_price_24h: 624705609.5,
  acc_trade_volume_24h: 20690500.8,
  trade_date: tradeDate,
  timestamp: Date.UTC(2026, 8, 26, 9, 42),
});
let ticker: ReturnType<typeof tick> | null = null;

globalThis.fetch = (async (input: string | URL | Request) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  let body: unknown;
  switch (url.pathname) {
    case "/api/disclosure":
      body = disclosures;
      break;
    case "/api/getTickerKrw":
      body = ticker ? [ticker] : [];
      break;
    case "/api/getTotalTx":
    case "/api/getLastDayTx":
    case "/api/getHolderCount":
      body = { count: "0" };
      break;
    default:
      body = [];
  }
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
}) as typeof fetch;

const API_URL = "http://mossland.stub";

async function collect(adapter: MosslandAdapter): Promise<MosslandNormalizedSignal[]> {
  const raw = await adapter.fetch();
  return raw.map((r) => adapter.normalize(r));
}

const events = (signals: MosslandNormalizedSignal[]) =>
  signals.filter((s) => s.category === "mossland_disclosure_published");

/** A throwaway signals table with the columns the loader reads. */
function signalStore() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE signals (
    id INTEGER PRIMARY KEY,
    category TEXT NOT NULL,
    value REAL NOT NULL,
    description TEXT NOT NULL,
    metadata TEXT,
    timestamp TEXT NOT NULL
  )`);
  const insert = db.prepare(
    `INSERT INTO signals (category, value, description, metadata, timestamp) VALUES (?, ?, ?, ?, ?)`,
  );
  const row = (
    category: string,
    value: number,
    description: string,
    metadata: string | null = null,
    timestamp = new Date().toISOString(),
  ) => insert.run(category, value, description, metadata, timestamp);
  // As collectAndSaveSignals stores them: metadata serialized when present.
  const save = (signals: MosslandNormalizedSignal[]) => {
    for (const s of signals) {
      row(s.category, s.value, s.description, s.metadata ? JSON.stringify(s.metadata) : null,
        s.timestamp.toISOString());
    }
  };
  return { db, row, save };
}

/* ------------------------------- tests ------------------------------- */

async function testEventAndGaugeAreSeparate() {
  disclosures = [doc(3), doc(2), doc(1)];
  const adapter = new MosslandAdapter({
    apiUrl: API_URL,
    language: "en",
    state: { announcedDisclosures: [doc(2).url] },
  });
  const signals = await collect(adapter);

  const published = events(signals);
  assert(published.length === 1, `expected one new disclosure, got ${published.length}`);
  assert(published[0].value === 1, `event value should be 1, got ${published[0].value}`);
  assert(published[0].severity === "high", `event severity should stay high, got ${published[0].severity}`);
  assert(
    published[0].description === `New disclosure: ${doc(3).title}`,
    `unexpected description ${published[0].description}`,
  );
  assert(published[0].metadata?.key === doc(3).url, "event metadata should carry the document URL as key");
  assert(published[0].metadata?.title === doc(3).title, "event metadata should carry the title");
  assert(published[0].metadata?.date === doc(3).date, "event metadata should carry the date");

  const totals = signals.filter((s) => s.category === "mossland_disclosure");
  assert(totals.length === 1, `expected one total gauge, got ${totals.length}`);
  assert(totals[0].value === 3, `gauge should be the list length, got ${totals[0].value}`);

  // The mechanism behind 18 of 21 proposals: a value-1 event inside the
  // gauge's category, z-scored against the ~53s around it.
  assert(!totals.some((s) => s.value === 1 && s.description.startsWith("New disclosure")),
    "no announcement may land in the gauge's category");
}

async function testAnnouncesOnlyOnce() {
  disclosures = [doc(2), doc(1)];
  const adapter = new MosslandAdapter({
    apiUrl: API_URL,
    language: "en",
    state: { announcedDisclosures: [doc(1).url] },
  });
  assert(events(await collect(adapter)).length === 1, "first read should announce doc 2");
  assert(events(await collect(adapter)).length === 0, "an unchanged list announces nothing");

  disclosures = [doc(4), doc(3), doc(2), doc(1)];
  const next = events(await collect(adapter));
  assert(next.length === 2, `two new documents should give two events, got ${next.length}`);
  assert(
    next[0].metadata?.key === doc(3).url && next[1].metadata?.key === doc(4).url,
    "a batch is announced oldest first",
  );
}

async function testRewrittenLinksAreNotNew() {
  const store = signalStore();
  disclosures = [doc(3), doc(2), doc(1)];
  const adapter = new MosslandAdapter({
    apiUrl: API_URL,
    language: "en",
    state: { announcedDisclosures: [doc(2).url] },
  });
  const first = await collect(adapter);
  store.save(first);
  assert(events(first).length === 1, "doc 3 is announced once");

  // One old document's link moves (the live list has many web.archive.org
  // and medium.com links).
  disclosures = [doc(3), doc(2), { ...doc(1), url: "https://web.archive.org/web/2021/https://medium.com/doc-1" }];
  const one = events(await collect(adapter));
  assert(one.length === 0, `a rewritten link re-announced ${one.length} document(s)`);

  // Every link under one prefix moves at once.
  const moved = (d: Doc): Doc => ({ ...d, url: d.url.replace("/blob/main/", "/blob/master/") });
  disclosures = [doc(3), doc(2), doc(1)].map(moved);
  const bulk = events(await collect(adapter));
  assert(bulk.length === 0, `a bulk link rewrite re-announced ${bulk.length} document(s)`);

  // A restart after the move: doc 3 is stored under its old URL, and its
  // title|date alias is what still recognises it.
  const again = new MosslandAdapter({
    apiUrl: API_URL,
    language: "en",
    state: loadMosslandAdapterState(store.db),
  });
  const restarted = events(await collect(again));
  assert(restarted.length === 0, `a restart after a link rewrite re-announced ${restarted.length} document(s)`);

  // A genuinely new document above them is still announced.
  disclosures = [doc(4), ...disclosures];
  const fresh = events(await collect(again));
  assert(
    fresh.length === 1 && fresh[0].metadata?.key === doc(4).url,
    `a new document above rewritten links should be announced once, got ${fresh.length}`,
  );
}

async function testNoReannouncementAfterRestart() {
  const store = signalStore();
  disclosures = [doc(2), doc(1)];

  const first = new MosslandAdapter({
    apiUrl: API_URL,
    language: "en",
    state: loadMosslandAdapterState(store.db),
  });
  // Empty store: the list is the baseline, nothing is announced.
  store.save(await collect(first));
  disclosures = [doc(3), doc(2), doc(1)];
  const firstSignals = await collect(first);
  store.save(firstSignals);
  assert(events(firstSignals).length === 1, "doc 3 appeared while running and is announced");

  // A deploy: a new process over the same rows.
  for (let restart = 0; restart < 3; restart++) {
    const again = new MosslandAdapter({
      apiUrl: API_URL,
      language: "en",
      state: loadMosslandAdapterState(store.db),
    });
    const signals = await collect(again);
    store.save(signals);
    assert(events(signals).length === 0, `restart ${restart + 1} re-announced ${events(signals).length} disclosure(s)`);
  }

  // Published while the process was down: still reported once.
  disclosures = [doc(4), doc(3), doc(2), doc(1)];
  const afterDowntime = new MosslandAdapter({
    apiUrl: API_URL,
    language: "en",
    state: loadMosslandAdapterState(store.db),
  });
  const caughtUp = events(await collect(afterDowntime));
  assert(
    caughtUp.length === 1 && caughtUp[0].metadata?.key === doc(4).url,
    `a disclosure published during downtime should be announced once, got ${caughtUp.length}`,
  );
}

async function testLegacyRowsSeedTheTransition() {
  const store = signalStore();
  // What production holds: repeats of "New disclosure: <title>" at value 1 in
  // the gauge's category, next to the gauge itself.
  for (let i = 0; i < 17; i++) {
    store.row("mossland_disclosure", 1, `New disclosure: ${doc(2).title}`, null);
  }
  store.row("mossland_disclosure", 1, `New disclosure: ${doc(1).title}`, null);
  store.row("mossland_disclosure", 53, "Disclosure status: 53 total", null);
  // A total that happens to be 1 is not an announcement.
  store.row("mossland_disclosure", 1, "Disclosure status: 1 total", null);

  const state = loadMosslandAdapterState(store.db);
  const seeded = [...(state.announcedDisclosures ?? [])];
  assert(
    seeded.length === 2 && seeded.includes(doc(2).title) && seeded.includes(doc(1).title),
    `legacy titles should seed the state, got ${JSON.stringify(seeded)}`,
  );

  disclosures = [doc(2), doc(1)];
  const adapter = new MosslandAdapter({ apiUrl: API_URL, language: "en", state });
  assert(events(await collect(adapter)).length === 0, "a legacy-announced disclosure is not new");

  // Korean descriptions seed too, whatever language the process now runs in.
  const ko = signalStore();
  ko.row("mossland_disclosure", 1, `새 공시: ${doc(2).title}`, null);
  const koState = loadMosslandAdapterState(ko.db);
  assert([...(koState.announcedDisclosures ?? [])].includes(doc(2).title), "Korean legacy rows should seed");
}

async function testLegacyScanStopsOnceEventsAreKeyed() {
  const store = signalStore();
  store.row("mossland_disclosure", 1, `New disclosure: ${doc(1).title}`, null);
  store.row(
    "mossland_disclosure_published",
    1,
    `New disclosure: ${doc(2).title}`,
    JSON.stringify({ key: doc(2).url, url: doc(2).url, title: doc(2).title, date: doc(2).date }),
  );

  const seeded = [...(loadMosslandAdapterState(store.db).announcedDisclosures ?? [])];
  assert(!seeded.includes(doc(1).title), "the legacy rows are not scanned once a keyed event exists");
  assert(
    seeded.includes(doc(2).url) && seeded.includes(`${doc(2).title}|${doc(2).date}`),
    `a keyed event seeds its URL and title|date alias, got ${JSON.stringify(seeded)}`,
  );

  // Knowing only the newest announced document is enough: the older one
  // below it is history, not news.
  disclosures = [doc(2), doc(1)];
  const adapter = new MosslandAdapter({ apiUrl: API_URL, language: "en", state: loadMosslandAdapterState(store.db) });
  assert(events(await collect(adapter)).length === 0, "nothing below the newest known document is new");
}

async function testStateSurvivesAMissingTable() {
  const db = new Database(":memory:");
  const state = loadMosslandAdapterState(db);
  assert(
    state.announcedDisclosures === undefined,
    "an unreadable store should yield empty state, not throw",
  );
}

const priceAlerts = (signals: MosslandNormalizedSignal[]) =>
  signals.filter((s) => s.category === "moc_price_alert");

async function testPriceChangeKeepsItsSign() {
  disclosures = [];
  const adapter = new MosslandAdapter({ apiUrl: API_URL, language: "en" });

  ticker = tick(-0.061);
  const fall = await collect(adapter);
  const [fallAlert] = priceAlerts(fall);
  assert(fallAlert, "a 6.1% fall should raise an alert");
  assert(Math.abs(fallAlert.value - -6.1) < 1e-9, `a fall is stored negative, got ${fallAlert.value}`);
  assert(fallAlert.description === "MOC Price Alert: fall 6.10%", `unexpected description ${fallAlert.description}`);
  const price = fall.find((s) => s.category === "moc_price");
  assert(price?.description.endsWith("(-6.10%)"), `the price signal shows the fall, got ${price?.description}`);

  ticker = tick(0.061);
  const [riseAlert] = priceAlerts(await collect(adapter));
  assert(riseAlert && Math.abs(riseAlert.value - 6.1) < 1e-9, `a rise is stored positive, got ${riseAlert?.value}`);
  assert(riseAlert.description === "MOC Price Alert: rise 6.10%", `unexpected description ${riseAlert.description}`);

  ticker = null;
}

async function testPriceAlertOncePerDayAndDirection() {
  disclosures = [];
  const adapter = new MosslandAdapter({ apiUrl: API_URL, language: "en" });
  const alertsFor = async (rates: number[], tradeDate = "20260926") => {
    const out: MosslandNormalizedSignal[] = [];
    for (const rate of rates) {
      ticker = tick(rate, tradeDate);
      out.push(...priceAlerts(await collect(adapter)));
    }
    return out;
  };

  // An hour of ticks past -5%, deepening to -12%: one alert, from the crossing.
  const falling = await alertsFor([-0.02, -0.049, ...Array.from({ length: 60 }, (_, i) => -0.051 - i * 0.001)]);
  assert(falling.length === 1, `a day's fall should alert once, got ${falling.length}`);
  assert(falling[0].metadata?.key === "20260926:FALL", `unexpected key ${falling[0].metadata?.key}`);

  // Recovering inside the band and falling through again is the same day's fall.
  assert((await alertsFor([-0.03, -0.07])).length === 0, "re-crossing the same direction does not alert again");

  // The other direction is its own alert, also only once.
  const rising = await alertsFor([0.02, 0.06, 0.07, 0.08]);
  assert(rising.length === 1 && rising[0].value > 0, `a rise the same day alerts once, got ${rising.length}`);

  // A new trading day re-arms both directions.
  const nextDay = await alertsFor([-0.06, -0.06, 0.06], "20260927");
  assert(nextDay.length === 2, `the next day alerts again per direction, got ${nextDay.length}`);

  ticker = null;
}

async function testPriceAlertNotRepeatedAfterRestart() {
  disclosures = [];
  const store = signalStore();
  // A legacy alert: no metadata, so it cannot say which day it covered.
  store.row("moc_price_alert", 6.1, "MOC Price Alert: fall 6.10%");

  ticker = tick(-0.061);
  const first = new MosslandAdapter({ apiUrl: API_URL, language: "en", state: loadMosslandAdapterState(store.db) });
  const firstSignals = await collect(first);
  store.save(firstSignals);
  assert(priceAlerts(firstSignals).length === 1, "the first process raises the day's alert");

  const second = new MosslandAdapter({ apiUrl: API_URL, language: "en", state: loadMosslandAdapterState(store.db) });
  assert(priceAlerts(await collect(second)).length === 0, "a restart the same trading day does not raise it again");

  ticker = tick(-0.061, "20260927");
  assert(priceAlerts(await collect(second)).length === 1, "the next trading day does");

  // Alerts older than the lookback are not read back at all.
  const later = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const stale = loadMosslandAdapterState(store.db, later);
  assert([...(stale.raisedPriceAlerts ?? [])].length === 0, "alerts from days ago are not loaded");

  ticker = null;
}

/* --------------------------------- run -------------------------------- */

async function main() {
  console.log("\n🧪 MosslandAdapter\n");
  await runTest("Disclosure events and the total use separate categories", testEventAndGaugeAreSeparate);
  await runTest("A disclosure is announced once", testAnnouncesOnlyOnce);
  await runTest("A rewritten link does not make an old disclosure new", testRewrittenLinksAreNotNew);
  await runTest("A restart does not re-announce a disclosure", testNoReannouncementAfterRestart);
  await runTest("Legacy rows seed the transition", testLegacyRowsSeedTheTransition);
  await runTest("Legacy rows are not scanned once events are keyed", testLegacyScanStopsOnceEventsAreKeyed);
  await runTest("Missing state does not stop the collector", testStateSurvivesAMissingTable);
  await runTest("A price change keeps its sign", testPriceChangeKeepsItsSign);
  await runTest("A price alert fires once per trading day and direction", testPriceAlertOncePerDayAndDirection);
  await runTest("A restart does not repeat the day's price alert", testPriceAlertNotRepeatedAfterRestart);
  console.log(failures === 0 ? "\n   all passed\n" : `\n   ${failures} failed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
