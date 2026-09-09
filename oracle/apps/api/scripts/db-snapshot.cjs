#!/usr/bin/env node
// Online snapshot of the API's SQLite database.
//
// Usage: node apps/api/scripts/db-snapshot.cjs <source.db> <dest.db>
//
// Why this exists rather than a `sqlite3 .backup` call in deploy.sh: the
// sqlite3 CLI is not installed on the app server, and the deploy script made it
// part of an `if` condition, so the pre-deploy snapshot was skipped in silence.
// It had therefore never run once -- the backup directory did not exist and the
// log had no line about it either way. better-sqlite3 is a dependency of this
// package and is rebuilt by every deploy, so it is always there when the deploy
// needs it; the CLI never was.
//
// VACUUM INTO is an online backup: it is safe against a live, writing database
// (the API keeps collecting through a deploy) and it compacts as it copies --
// 355MB became 307MB in 0.4s on production. Lives under apps/api/ rather than
// oracle/scripts/ so `require` resolves through this package's node_modules;
// under pnpm's layout it does not resolve from the workspace root.
//
// CommonJS on purpose: apps/api is "type": "module", and this needs to run
// straight from source without a build step, because it runs BEFORE the build.

const Database = require("better-sqlite3");

const [source, dest] = process.argv.slice(2);

if (!source || !dest) {
  console.error("usage: db-snapshot.cjs <source.db> <dest.db>");
  process.exit(64);
}

// Read-only: a snapshot must never be the thing that writes to the database it
// is protecting. Escape single quotes -- the path is ours, but VACUUM INTO
// takes a string literal and a mangled one would write somewhere unintended.
const db = new Database(source, { readonly: true });
try {
  db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
} finally {
  db.close();
}
