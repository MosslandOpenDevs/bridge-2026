import Database from "better-sqlite3";
// Imported by name so declaration emit can reference these types (TS4023).
import type { Database as SqliteDatabase } from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "data", "oracle.db");

// Ensure data directory exists
import fs from "fs";
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize database
const db: SqliteDatabase = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// Create tables
db.exec(`
  -- Signals table
  CREATE TABLE IF NOT EXISTS signals (
    id TEXT PRIMARY KEY,
    original_id TEXT NOT NULL,
    source TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    category TEXT NOT NULL,
    severity TEXT NOT NULL,
    value REAL NOT NULL,
    unit TEXT NOT NULL,
    description TEXT NOT NULL,
    metadata TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  -- Create index for faster queries
  CREATE INDEX IF NOT EXISTS idx_signals_timestamp ON signals(timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_signals_category ON signals(category);
  CREATE INDEX IF NOT EXISTS idx_signals_severity ON signals(severity);

  -- Issues table
  CREATE TABLE IF NOT EXISTS issues (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    priority TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'detected',
    kind TEXT DEFAULT 'issue',
    direction TEXT,
    detected_at TEXT NOT NULL,
    resolved_at TEXT,
    signal_ids TEXT,
    evidence TEXT,
    suggested_actions TEXT,
    decision_packet TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  -- Add columns if they don't exist (for existing databases)
  -- SQLite doesn't have IF NOT EXISTS for ALTER TABLE, so we handle this differently

  CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
  CREATE INDEX IF NOT EXISTS idx_issues_priority ON issues(priority);
  CREATE INDEX IF NOT EXISTS idx_issues_detected_at ON issues(detected_at DESC);

  -- Proposals table (for future use)
  CREATE TABLE IF NOT EXISTS proposals (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    proposer TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    voting_starts TEXT,
    voting_ends TEXT,
    issue_id TEXT,
    decision_packet TEXT,
    tally TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (issue_id) REFERENCES issues(id)
  );

  -- Decision history for agent learning
  CREATE TABLE IF NOT EXISTS decision_history (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL,
    category TEXT NOT NULL,
    priority TEXT NOT NULL,
    consensus_score REAL,
    recommendation_type TEXT,
    agent_opinions TEXT,
    outcome_status TEXT DEFAULT 'pending',
    outcome_success_rate REAL,
    kpi_results TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    outcome_recorded_at TEXT,
    FOREIGN KEY (issue_id) REFERENCES issues(id)
  );

  CREATE INDEX IF NOT EXISTS idx_decision_history_category ON decision_history(category);
  CREATE INDEX IF NOT EXISTS idx_decision_history_outcome ON decision_history(outcome_status);

  -- Agent performance tracking
  CREATE TABLE IF NOT EXISTS agent_performance (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    agent_role TEXT NOT NULL,
    decision_id TEXT NOT NULL,
    category TEXT NOT NULL,
    stance TEXT NOT NULL,
    confidence REAL NOT NULL,
    outcome_correct INTEGER,
    accuracy_delta REAL,
    recorded_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (decision_id) REFERENCES decision_history(id)
  );

  CREATE INDEX IF NOT EXISTS idx_agent_performance_agent ON agent_performance(agent_id);
  CREATE INDEX IF NOT EXISTS idx_agent_performance_role ON agent_performance(agent_role);
  CREATE INDEX IF NOT EXISTS idx_agent_performance_category ON agent_performance(category);

  -- Agent trust scores (aggregated)
  CREATE TABLE IF NOT EXISTS agent_trust_scores (
    agent_id TEXT PRIMARY KEY,
    agent_role TEXT NOT NULL,
    overall_score REAL DEFAULT 50,
    total_decisions INTEGER DEFAULT 0,
    correct_decisions INTEGER DEFAULT 0,
    accuracy_by_category TEXT,
    last_updated TEXT DEFAULT CURRENT_TIMESTAMP
  );

  -- ---------------------------------------------------------------------
  -- Governance state. Previously this lived only in process memory, so a
  -- deploy or a crash silently discarded every proposal, vote, delegation
  -- and outcome. These tables are the source of truth; the in-memory
  -- structures are a cache rebuilt from them at boot.
  -- ---------------------------------------------------------------------

  CREATE TABLE IF NOT EXISTS votes (
    id TEXT PRIMARY KEY,
    proposal_id TEXT NOT NULL,
    voter TEXT NOT NULL,
    -- Lower-cased address: the identity duplicate detection keys on, so the
    -- one-vote-per-holder rule is enforced by the database and not only by
    -- application code.
    voter_key TEXT NOT NULL,
    choice TEXT NOT NULL CHECK (choice IN ('for', 'against', 'abstain')),
    weight TEXT NOT NULL,
    reason TEXT,
    tx_hash TEXT,
    voted_at TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (proposal_id, voter_key)
  );

  CREATE INDEX IF NOT EXISTS idx_votes_proposal ON votes(proposal_id);

  CREATE TABLE IF NOT EXISTS delegations (
    id TEXT PRIMARY KEY,
    delegator TEXT NOT NULL,
    delegator_key TEXT NOT NULL,
    delegate TEXT NOT NULL,
    conditions TEXT NOT NULL,
    expires_at TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_delegations_delegator ON delegations(delegator_key);

  CREATE TABLE IF NOT EXISTS executions (
    id TEXT PRIMARY KEY,
    proposal_id TEXT NOT NULL,
    status TEXT NOT NULL,
    executed_by TEXT NOT NULL,
    executed_at TEXT NOT NULL,
    tx_hash TEXT,
    actions TEXT NOT NULL,
    kpi_results TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_executions_proposal ON executions(proposal_id);

  CREATE TABLE IF NOT EXISTS outcome_proofs (
    id TEXT PRIMARY KEY,
    execution_id TEXT NOT NULL,
    proposal_id TEXT NOT NULL,
    kpi_results TEXT NOT NULL,
    overall_success INTEGER NOT NULL,
    -- Fraction in [0,1]. Stored in one unit everywhere; see O-08.
    success_rate REAL NOT NULL,
    proof_hash TEXT NOT NULL,
    attestation TEXT,
    tx_hash TEXT,
    recorded_at TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_outcome_proofs_execution ON outcome_proofs(execution_id);

  CREATE TABLE IF NOT EXISTS entity_trust (
    entity_id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    score REAL NOT NULL,
    total_decisions INTEGER NOT NULL DEFAULT 0,
    successful_decisions INTEGER NOT NULL DEFAULT 0,
    last_updated TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS entity_trust_history (
    entity_id TEXT NOT NULL,
    proof_id TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    PRIMARY KEY (entity_id, proof_id)
  );
`);

// Columns added after the proposals table shipped. SQLite has no
// ADD COLUMN IF NOT EXISTS, so each is attempted and its "duplicate column"
// error ignored.
for (const [column, definition] of [
  ["voting_period_ms", "INTEGER"],
  ["quorum", "INTEGER"],
  ["threshold", "REAL"],
  ["execution_eta", "TEXT"],
  ["executed_at", "TEXT"],
  ["snapshot_block", "INTEGER"],
  ["onchain_id", "INTEGER"],
] as const) {
  try {
    db.exec(`ALTER TABLE proposals ADD COLUMN ${column} ${definition}`);
  } catch {
    // Column already present.
  }
}

console.log(`📦 Database initialized at ${DB_PATH}`);

/** Shape of a row in the `issues` table, as returned by better-sqlite3. */
export interface IssueRow {
  id: string;
  title: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  kind: string | null;
  direction: string | null;
  detected_at: string;
  resolved_at: string | null;
  signal_ids: string | null;
  evidence: string | null;
  suggested_actions: string | null;
  decision_packet: string | null;
  created_at: string;
  updated_at: string;
}

// Signal operations
export const signalDb = {
  insert: db.prepare(`
    INSERT OR REPLACE INTO signals (id, original_id, source, timestamp, category, severity, value, unit, description, metadata)
    VALUES (@id, @originalId, @source, @timestamp, @category, @severity, @value, @unit, @description, @metadata)
  `),

  getById: db.prepare(`SELECT * FROM signals WHERE id = ?`),

  getRecent: db.prepare(`
    SELECT * FROM signals ORDER BY timestamp DESC LIMIT ?
  `),

  getByCategory: db.prepare(`
    SELECT * FROM signals WHERE category = ? ORDER BY timestamp DESC LIMIT ?
  `),

  getBySeverity: db.prepare(`
    SELECT * FROM signals WHERE severity = ? ORDER BY timestamp DESC LIMIT ?
  `),

  getByTimeRange: db.prepare(`
    SELECT * FROM signals WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp DESC
  `),

  count: db.prepare(`SELECT COUNT(*) as count FROM signals`),

  countByCategory: db.prepare(`
    SELECT category, COUNT(*) as count FROM signals GROUP BY category
  `),

  deleteOld: db.prepare(`
    DELETE FROM signals WHERE timestamp < ?
  `),

  clear: db.prepare(`DELETE FROM signals`),
};

// Migrate existing database: add kind and direction columns if they don't exist
try {
  db.exec(`ALTER TABLE issues ADD COLUMN kind TEXT DEFAULT 'issue'`);
} catch (e) {
  // Column already exists, ignore
}
try {
  db.exec(`ALTER TABLE issues ADD COLUMN direction TEXT`);
} catch (e) {
  // Column already exists, ignore
}

// Issue operations
export const issueDb = {
  insert: db.prepare(`
    INSERT INTO issues (id, title, description, category, priority, status, kind, direction, detected_at, signal_ids, evidence, suggested_actions)
    VALUES (@id, @title, @description, @category, @priority, @status, @kind, @direction, @detectedAt, @signalIds, @evidence, @suggestedActions)
  `),

  update: db.prepare(`
    UPDATE issues SET
      status = @status,
      resolved_at = @resolvedAt,
      decision_packet = @decisionPacket,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `),

  getById: db.prepare(`SELECT * FROM issues WHERE id = ?`),

  getRecent: db.prepare(`
    SELECT * FROM issues ORDER BY detected_at DESC LIMIT ?
  `),

  getByStatus: db.prepare(`
    SELECT * FROM issues WHERE status = ? ORDER BY detected_at DESC LIMIT ?
  `),

  getByPriority: db.prepare(`
    SELECT * FROM issues WHERE priority = ? ORDER BY detected_at DESC LIMIT ?
  `),

  getActive: db.prepare(`
    SELECT * FROM issues WHERE status IN ('detected', 'deliberating', 'proposed')
    ORDER BY
      CASE priority
        WHEN 'urgent' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
      END,
      detected_at DESC
    LIMIT ?
  `),

  count: db.prepare(`SELECT COUNT(*) as count FROM issues`),

  countByStatus: db.prepare(`
    SELECT status, COUNT(*) as count FROM issues GROUP BY status
  `),

  /**
   * Suppress a repeat detection of the same thing within a short window.
   *
   * Compared as julianday, not as text: detected_at is stored in ISO form
   * ("2026-08-05T12:00:00.000Z") while datetime('now', …) yields a
   * space-separated string, and "T" sorts above " ", so a plain text
   * comparison treated every earlier issue from the same day as "recent" and
   * suppressed it. The key includes kind and direction as well as category,
   * so a threshold breach and a downward trend in one category are not
   * mistaken for the same detection.
   */
  findSimilar: db.prepare(`
    SELECT * FROM issues
    WHERE category = @category
      AND IFNULL(kind, 'issue') = IFNULL(@kind, 'issue')
      AND IFNULL(direction, '') = IFNULL(@direction, '')
      AND status IN ('detected', 'deliberating', 'proposed')
      AND julianday(detected_at) > julianday('now', @window)
    LIMIT 1
  `),

  clear: db.prepare(`DELETE FROM issues`),
};

// Proposal operations (persisted alongside in-memory VotingSystem)
export const proposalDb = {
  insert: db.prepare(`
    INSERT INTO proposals (id, title, description, proposer, status, voting_starts, voting_ends, issue_id, decision_packet)
    VALUES (@id, @title, @description, @proposer, @status, @votingStarts, @votingEnds, @issueId, @decisionPacket)
  `),

  updateStatus: db.prepare(`
    UPDATE proposals SET status = @status, tally = @tally, updated_at = CURRENT_TIMESTAMP WHERE id = @id
  `),

  getById: db.prepare(`SELECT * FROM proposals WHERE id = ?`),

  getRecent: db.prepare(`SELECT * FROM proposals ORDER BY created_at DESC LIMIT ?`),

  count: db.prepare(`SELECT COUNT(*) as count FROM proposals`),

  countByStatus: db.prepare(`SELECT status, COUNT(*) as count FROM proposals GROUP BY status`),

  existsByIssueId: db.prepare(`SELECT id FROM proposals WHERE issue_id = ? LIMIT 1`),
};

/** Whether an issue id refers to a stored issue (proposals.issue_id is a FK). */
export const issueExists = db.prepare(`SELECT 1 FROM issues WHERE id = ? LIMIT 1`);

// Governance state operations. See the table comments above: these rows are
// the source of truth for proposals, votes, delegations and outcomes.
export const governanceDb = {
  upsertProposal: db.prepare(`
    INSERT INTO proposals (
      id, title, description, proposer, status, voting_starts, voting_ends,
      issue_id, decision_packet, voting_period_ms, quorum, threshold,
      execution_eta, executed_at, snapshot_block, onchain_id
    ) VALUES (
      @id, @title, @description, @proposer, @status, @votingStarts, @votingEnds,
      @issueId, @decisionPacket, @votingPeriodMs, @quorum, @threshold,
      @executionEta, @executedAt, @snapshotBlock, @onchainId
    )
    ON CONFLICT(id) DO UPDATE SET
      title = @title,
      description = @description,
      proposer = @proposer,
      status = @status,
      voting_starts = @votingStarts,
      voting_ends = @votingEnds,
      issue_id = @issueId,
      decision_packet = @decisionPacket,
      voting_period_ms = @votingPeriodMs,
      quorum = @quorum,
      threshold = @threshold,
      execution_eta = @executionEta,
      executed_at = @executedAt,
      snapshot_block = @snapshotBlock,
      onchain_id = @onchainId,
      updated_at = CURRENT_TIMESTAMP
  `),

  allProposals: db.prepare(`SELECT * FROM proposals ORDER BY created_at ASC`),

  insertVote: db.prepare(`
    INSERT INTO votes (id, proposal_id, voter, voter_key, choice, weight, reason, tx_hash, voted_at)
    VALUES (@id, @proposalId, @voter, @voterKey, @choice, @weight, @reason, @txHash, @votedAt)
  `),

  allVotes: db.prepare(`SELECT * FROM votes ORDER BY voted_at ASC`),

  upsertDelegation: db.prepare(`
    INSERT INTO delegations (id, delegator, delegator_key, delegate, conditions, expires_at, active)
    VALUES (@id, @delegator, @delegatorKey, @delegate, @conditions, @expiresAt, @active)
    ON CONFLICT(id) DO UPDATE SET
      delegator = @delegator,
      delegator_key = @delegatorKey,
      delegate = @delegate,
      conditions = @conditions,
      expires_at = @expiresAt,
      active = @active,
      updated_at = CURRENT_TIMESTAMP
  `),

  setDelegationActive: db.prepare(`
    UPDATE delegations SET active = @active, updated_at = CURRENT_TIMESTAMP WHERE id = @id
  `),

  allDelegations: db.prepare(`SELECT * FROM delegations ORDER BY created_at ASC`),

  upsertExecution: db.prepare(`
    INSERT INTO executions (id, proposal_id, status, executed_by, executed_at, tx_hash, actions, kpi_results)
    VALUES (@id, @proposalId, @status, @executedBy, @executedAt, @txHash, @actions, @kpiResults)
    ON CONFLICT(id) DO UPDATE SET
      status = @status,
      tx_hash = @txHash,
      actions = @actions,
      kpi_results = @kpiResults
  `),

  allExecutions: db.prepare(`SELECT * FROM executions ORDER BY executed_at ASC`),

  upsertProof: db.prepare(`
    INSERT INTO outcome_proofs (
      id, execution_id, proposal_id, kpi_results, overall_success,
      success_rate, proof_hash, attestation, tx_hash, recorded_at
    ) VALUES (
      @id, @executionId, @proposalId, @kpiResults, @overallSuccess,
      @successRate, @proofHash, @attestation, @txHash, @recordedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      kpi_results = @kpiResults,
      overall_success = @overallSuccess,
      success_rate = @successRate,
      proof_hash = @proofHash,
      attestation = @attestation,
      tx_hash = @txHash
  `),

  allProofs: db.prepare(`SELECT * FROM outcome_proofs ORDER BY recorded_at ASC`),

  upsertTrust: db.prepare(`
    INSERT INTO entity_trust (entity_id, entity_type, score, total_decisions, successful_decisions, last_updated)
    VALUES (@entityId, @entityType, @score, @totalDecisions, @successfulDecisions, @lastUpdated)
    ON CONFLICT(entity_id) DO UPDATE SET
      entity_type = @entityType,
      score = @score,
      total_decisions = @totalDecisions,
      successful_decisions = @successfulDecisions,
      last_updated = @lastUpdated
  `),

  allTrust: db.prepare(`SELECT * FROM entity_trust`),

  insertTrustHistory: db.prepare(`
    INSERT OR IGNORE INTO entity_trust_history (entity_id, proof_id, recorded_at)
    VALUES (@entityId, @proofId, @recordedAt)
  `),

  allTrustHistory: db.prepare(`
    SELECT * FROM entity_trust_history ORDER BY recorded_at ASC
  `),
};

/** Run a set of writes as one transaction. */
export function inTransaction<T>(fn: () => T): T {
  return db.transaction(fn)();
}

// Decision history operations (for agent learning)
export const decisionHistoryDb = {
  insert: db.prepare(`
    INSERT INTO decision_history (id, issue_id, category, priority, consensus_score, recommendation_type, agent_opinions, outcome_status)
    VALUES (@id, @issueId, @category, @priority, @consensusScore, @recommendationType, @agentOpinions, @outcomeStatus)
  `),

  updateOutcome: db.prepare(`
    UPDATE decision_history SET
      outcome_status = @outcomeStatus,
      outcome_success_rate = @outcomeSuccessRate,
      kpi_results = @kpiResults,
      outcome_recorded_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `),

  getById: db.prepare(`SELECT * FROM decision_history WHERE id = ?`),

  getByIssueId: db.prepare(`
    SELECT * FROM decision_history WHERE issue_id = ? ORDER BY created_at DESC LIMIT 1
  `),

  getByCategory: db.prepare(`
    SELECT * FROM decision_history
    WHERE category = ? AND outcome_status = 'completed'
    ORDER BY created_at DESC LIMIT ?
  `),

  getSimilar: db.prepare(`
    SELECT * FROM decision_history
    WHERE category = ? AND outcome_status = 'completed'
    ORDER BY created_at DESC LIMIT ?
  `),

  getRecent: db.prepare(`
    SELECT * FROM decision_history ORDER BY created_at DESC LIMIT ?
  `),

  getWithOutcomes: db.prepare(`
    SELECT * FROM decision_history
    WHERE outcome_status = 'completed'
    ORDER BY created_at DESC LIMIT ?
  `),

  getCategorySuccessRate: db.prepare(`
    SELECT
      category,
      COUNT(*) as total,
      AVG(outcome_success_rate) as avg_success_rate
    FROM decision_history
    WHERE outcome_status = 'completed'
    GROUP BY category
  `),

  count: db.prepare(`SELECT COUNT(*) as count FROM decision_history`),

  getPendingOlderThan: db.prepare(`
    SELECT * FROM decision_history
    WHERE outcome_status = 'pending' AND created_at < datetime('now', ?)
    ORDER BY created_at ASC LIMIT ?
  `),
};

// Issue follow-up queries for outcome evaluation
export const issueFollowupDb = {
  countNewByCategorySince: db.prepare(`
    SELECT COUNT(*) as count FROM issues
    WHERE category = ?
      AND priority IN ('high', 'urgent', 'critical')
      AND created_at > ?
  `),
};

// Agent performance operations
export const agentPerformanceDb = {
  insert: db.prepare(`
    INSERT INTO agent_performance (id, agent_id, agent_role, decision_id, category, stance, confidence, outcome_correct, accuracy_delta)
    VALUES (@id, @agentId, @agentRole, @decisionId, @category, @stance, @confidence, @outcomeCorrect, @accuracyDelta)
  `),

  getByAgent: db.prepare(`
    SELECT * FROM agent_performance WHERE agent_id = ? ORDER BY recorded_at DESC LIMIT ?
  `),

  getByRole: db.prepare(`
    SELECT * FROM agent_performance WHERE agent_role = ? ORDER BY recorded_at DESC LIMIT ?
  `),

  getAgentAccuracy: db.prepare(`
    SELECT
      agent_role,
      COUNT(*) as total_decisions,
      SUM(CASE WHEN outcome_correct = 1 THEN 1 ELSE 0 END) as correct_decisions,
      AVG(confidence) as avg_confidence,
      AVG(CASE WHEN outcome_correct IS NOT NULL THEN accuracy_delta ELSE NULL END) as avg_accuracy_delta
    FROM agent_performance
    WHERE agent_role = ?
    GROUP BY agent_role
  `),

  getAgentAccuracyByCategory: db.prepare(`
    SELECT
      agent_role,
      category,
      COUNT(*) as total_decisions,
      SUM(CASE WHEN outcome_correct = 1 THEN 1 ELSE 0 END) as correct_decisions,
      AVG(confidence) as avg_confidence
    FROM agent_performance
    WHERE agent_role = ? AND category = ?
    GROUP BY agent_role, category
  `),

  getRoleStats: db.prepare(`
    SELECT
      agent_role,
      COUNT(*) as total_decisions,
      SUM(CASE WHEN outcome_correct = 1 THEN 1 ELSE 0 END) as correct_decisions,
      AVG(confidence) as avg_confidence
    FROM agent_performance
    WHERE outcome_correct IS NOT NULL
    GROUP BY agent_role
  `),
};

// Agent trust scores operations
export const agentTrustDb = {
  upsert: db.prepare(`
    INSERT INTO agent_trust_scores (agent_id, agent_role, overall_score, total_decisions, correct_decisions, accuracy_by_category, last_updated)
    VALUES (@agentId, @agentRole, @overallScore, @totalDecisions, @correctDecisions, @accuracyByCategory, CURRENT_TIMESTAMP)
    ON CONFLICT(agent_id) DO UPDATE SET
      overall_score = @overallScore,
      total_decisions = @totalDecisions,
      correct_decisions = @correctDecisions,
      accuracy_by_category = @accuracyByCategory,
      last_updated = CURRENT_TIMESTAMP
  `),

  getByAgent: db.prepare(`SELECT * FROM agent_trust_scores WHERE agent_id = ?`),

  getByRole: db.prepare(`SELECT * FROM agent_trust_scores WHERE agent_role = ?`),

  getAll: db.prepare(`SELECT * FROM agent_trust_scores ORDER BY overall_score DESC`),

  getLeaderboard: db.prepare(`
    SELECT * FROM agent_trust_scores ORDER BY overall_score DESC LIMIT ?
  `),
};

// Helper to serialize/deserialize JSON fields
export function serializeSignal(signal: any) {
  return {
    id: signal.id,
    originalId: signal.originalId,
    source: signal.source,
    timestamp: signal.timestamp instanceof Date ? signal.timestamp.toISOString() : signal.timestamp,
    category: signal.category,
    severity: signal.severity,
    value: signal.value,
    unit: signal.unit,
    description: signal.description,
    metadata: signal.metadata ? JSON.stringify(signal.metadata) : null,
  };
}

export function deserializeSignal(row: any) {
  return {
    id: row.id,
    originalId: row.original_id,
    source: row.source,
    timestamp: new Date(row.timestamp),
    category: row.category,
    severity: row.severity,
    value: row.value,
    unit: row.unit,
    description: row.description,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
  };
}

export function serializeIssue(issue: any) {
  return {
    id: issue.id,
    title: issue.title,
    description: issue.description,
    category: issue.category,
    priority: issue.priority,
    status: issue.status,
    kind: issue.kind || "issue",
    direction: issue.direction || null,
    detectedAt: issue.detectedAt instanceof Date ? issue.detectedAt.toISOString() : issue.detectedAt,
    signalIds: JSON.stringify(issue.signals?.map((s: any) => s.id) || []),
    evidence: JSON.stringify(issue.evidence || []),
    suggestedActions: JSON.stringify(issue.suggestedActions || []),
  };
}

export function deserializeIssue(row: any) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    priority: row.priority,
    status: row.status,
    kind: row.kind || "issue",
    direction: row.direction || null,
    detectedAt: row.detected_at,
    resolvedAt: row.resolved_at,
    signalIds: row.signal_ids ? JSON.parse(row.signal_ids) : [],
    evidence: row.evidence ? JSON.parse(row.evidence) : [],
    suggestedActions: row.suggested_actions ? JSON.parse(row.suggested_actions) : [],
    decisionPacket: row.decision_packet ? JSON.parse(row.decision_packet) : null,
  };
}

export default db;
