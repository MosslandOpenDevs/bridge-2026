import Database from "better-sqlite3";
// Imported by name so declaration emit can reference these types (TS4023).
import type { Database as SqliteDatabase, Statement } from "better-sqlite3";
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
`);

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

  // Check if similar issue already exists (to avoid duplicates)
  findSimilar: db.prepare(`
    SELECT * FROM issues
    WHERE category = ?
      AND status IN ('detected', 'deliberating', 'proposed')
      AND detected_at > datetime('now', '-15 minutes')
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
