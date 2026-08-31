import type { Database } from "better-sqlite3";

export function migrateAutonomousOperations(database: Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS operational_signals (
      signal_id TEXT PRIMARY KEY,
      signal_type TEXT NOT NULL,
      source TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      customer_id INTEGER,
      request_id TEXT,
      appointment_id TEXT,
      detected_at TEXT NOT NULL,
      business_time TEXT,
      severity TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 50,
      facts_json TEXT NOT NULL DEFAULT '{}',
      evidence_json TEXT NOT NULL DEFAULT '{}',
      ai_assessment_json TEXT,
      deduplication_key TEXT NOT NULL UNIQUE,
      state_version TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      recommended_action TEXT,
      reasoning_summary TEXT,
      delivery_mode TEXT NOT NULL DEFAULT 'IMMEDIATE',
      notified_at TEXT,
      acknowledged_at TEXT,
      acknowledged_by_operator_id INTEGER,
      resolved_at TEXT,
      last_notified_at TEXT,
      notification_count INTEGER NOT NULL DEFAULT 0,
      cooldown_until TEXT,
      superseded_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_operational_signals_status
      ON operational_signals (status, severity, priority);
    CREATE INDEX IF NOT EXISTS idx_operational_signals_entity
      ON operational_signals (entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_operational_signals_dedup
      ON operational_signals (deduplication_key);
    CREATE TABLE IF NOT EXISTS autonomous_action_tokens (
      token TEXT PRIMARY KEY,
      signal_id TEXT NOT NULL,
      operator_id INTEGER,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      state_version TEXT NOT NULL,
      nonce TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_autonomous_action_tokens_signal
      ON autonomous_action_tokens (signal_id);
    CREATE TABLE IF NOT EXISTS autonomous_signal_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      signal_id TEXT NOT NULL,
      operator_id INTEGER,
      feedback TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS autonomous_metrics (
      key TEXT PRIMARY KEY,
      value INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
  `);
}
