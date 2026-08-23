import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve, sep } from "path";
import Database from "better-sqlite3";
import { storedPhotoName, type SniffedImage } from "@/lib/photos";
import { toWhatsAppDigits } from "@/lib/phone";
import {
  isRequestStatus,
  PUBLIC_ID_PATTERN,
  type RequestStatus,
} from "@/lib/admin-format";
import { enqueueOutbox } from "@/lib/automation-outbox";
import { buildN8nPayload } from "@/lib/n8n";

export type SavedPhoto = {
  name: string;
  size: number;
  type: string;
  storedAs: string;
};

export type BufferedPhoto = {
  name: string;
  size: number;
  type: string;
  bytes: Buffer;
  sniffed: SniffedImage;
};

export type SavedServiceRequest = {
  id: number;
  publicId: string;
  createdAt: string;
  updatedAt: string;
  status: RequestStatus;
  name: string;
  phone: string;
  email: string;
  property: string;
  service: string;
  message: string;
  photos: SavedPhoto[];
  factsJson?: string;
};

export type RequestMessage = {
  id: number;
  publicId: string;
  direction: "INBOUND" | "OUTBOUND";
  channel: "FORM" | "EMAIL" | "TELEGRAM";
  subject: string;
  body: string;
  status: "RECORDED" | "SENT" | "FAILED";
  sentAt: string | null;
  createdAt: string;
};

function dataDir() {
  return process.env.DATA_DIR?.trim() || join(process.cwd(), "data");
}

function dbPath() {
  return join(dataDir(), "homestead.sqlite");
}

let db: Database.Database | null = null;

function columnNames(database: Database.Database, table: string) {
  return (
    database.pragma(`table_info(${table})`) as Array<{ name: string }>
  ).map((column) => column.name);
}

function migrate(database: Database.Database) {
  const columns = columnNames(database, "service_requests");
  if (!columns.includes("status")) {
    database.exec(
      `ALTER TABLE service_requests ADD COLUMN status TEXT NOT NULL DEFAULT 'NEW'`,
    );
  }
  if (!columns.includes("updated_at")) {
    database.exec(`ALTER TABLE service_requests ADD COLUMN updated_at TEXT`);
    database.exec(
      `UPDATE service_requests SET updated_at = created_at WHERE updated_at IS NULL`,
    );
  }
  if (!columns.includes("reply_lock_until")) {
    database.exec(
      `ALTER TABLE service_requests ADD COLUMN reply_lock_until TEXT`,
    );
  }
  database.exec(`
    CREATE TABLE IF NOT EXISTS service_request_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_pk INTEGER NOT NULL,
      public_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      channel TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      sent_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_public_id
      ON service_request_messages (public_id, created_at);
  `);
  migrateContentStudio(database);
}

function migrateContentStudio(database: Database.Database) {
  mkdirSync(join(dataDir(), "content"), { recursive: true });
  database.exec(`
    CREATE TABLE IF NOT EXISTS content_counters (
      year INTEGER PRIMARY KEY,
      last INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS content_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      service_type TEXT NOT NULL DEFAULT '',
      telegram_chat_id TEXT NOT NULL,
      telegram_user_id TEXT NOT NULL DEFAULT '',
      telegram_status_message_id INTEGER,
      process_lock_until TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      approved_at TEXT,
      rejected_at TEXT
    );
    CREATE TABLE IF NOT EXISTS content_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      public_id TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 0,
      asset_type TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT '',
      stored_filename TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      width INTEGER,
      height INTEGER,
      sha256 TEXT NOT NULL,
      telegram_file_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS content_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      public_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      kind TEXT NOT NULL,
      copy TEXT NOT NULL DEFAULT '',
      cta TEXT NOT NULL DEFAULT '',
      hashtags TEXT NOT NULL DEFAULT '',
      prompt TEXT NOT NULL DEFAULT '',
      privacy_note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS content_telegram_updates (
      update_id INTEGER PRIMARY KEY,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS content_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      operation TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_content_jobs_chat
      ON content_jobs (telegram_chat_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_content_assets_job
      ON content_assets (public_id, version, asset_type);
  `);
  const jobCols = columnNames(database, "content_jobs");
  const addJobCol = (name: string, ddl: string) => {
    if (!jobCols.includes(name)) database.exec(`ALTER TABLE content_jobs ADD COLUMN ${ddl}`);
  };
  addJobCol("pending_input", "pending_input TEXT");
  addJobCol("recommended_publish_at", "recommended_publish_at TEXT");
  addJobCol("recommendation_reason", "recommendation_reason TEXT");
  addJobCol("captions_json", "captions_json TEXT NOT NULL DEFAULT ''");
  addJobCol("selected_caption", "selected_caption TEXT NOT NULL DEFAULT ''");
  addJobCol("publish_lock_until", "publish_lock_until TEXT");
  addJobCol("media_group_id", "media_group_id TEXT");
  addJobCol("mix_type", "mix_type TEXT NOT NULL DEFAULT 'trabajo'");
  addJobCol("content_type", "content_type TEXT NOT NULL DEFAULT 'COMPLETED_WORK'");
  addJobCol("cta_type", "cta_type TEXT NOT NULL DEFAULT 'QUOTE_REQUEST'");
  addJobCol("format", "format TEXT NOT NULL DEFAULT 'SINGLE_IMAGE'");
  addJobCol("business_priority", "business_priority INTEGER NOT NULL DEFAULT 0");
  addJobCol("valid_until", "valid_until TEXT");
  addJobCol("source_job_id", "source_job_id TEXT NOT NULL DEFAULT ''");
  database.exec(`
    CREATE TABLE IF NOT EXISTS content_publications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      dry_run INTEGER NOT NULL DEFAULT 1,
      external_post_id TEXT NOT NULL DEFAULT '',
      caption TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      attempt INTEGER NOT NULL DEFAULT 1,
      published_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS content_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL,
      event TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS content_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      timezone TEXT NOT NULL,
      days_enabled TEXT NOT NULL,
      windows_json TEXT NOT NULL,
      max_posts_per_day INTEGER NOT NULL,
      min_hours_between_posts INTEGER NOT NULL,
      platforms TEXT NOT NULL,
      approval_required INTEGER NOT NULL,
      mode TEXT NOT NULL,
      dry_run INTEGER NOT NULL,
      paused INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const settings = database.prepare("SELECT id FROM content_settings WHERE id = 1").get();
  if (!settings) {
    database
      .prepare(
        `INSERT INTO content_settings
          (id, timezone, days_enabled, windows_json, max_posts_per_day, min_hours_between_posts, platforms, approval_required, mode, dry_run, paused, updated_at)
         VALUES (1, 'America/Panama', '1,2,3,4,5,6', ?, 1, 36, 'instagram,facebook', 1, 'ASSISTED', 1, 0, ?)`,
      )
      .run(JSON.stringify([{ start: "18:00", end: "20:00" }]), new Date().toISOString());
  }
  database.exec(`
    CREATE TABLE IF NOT EXISTS marketing_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      horizon TEXT NOT NULL,
      collected_at TEXT NOT NULL,
      reach INTEGER,
      impressions INTEGER,
      likes INTEGER,
      comments INTEGER,
      shares INTEGER,
      saves INTEGER,
      profile_visits INTEGER,
      link_clicks INTEGER,
      messages INTEGER,
      whatsapp_clicks INTEGER,
      leads INTEGER,
      source TEXT NOT NULL DEFAULT 'api',
      UNIQUE (public_id, platform, horizon)
    );
    CREATE TABLE IF NOT EXISTS marketing_recommendations (
      recommendation_id TEXT PRIMARY KEY,
      public_id TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      recommended_at TEXT,
      platform TEXT NOT NULL,
      score REAL NOT NULL,
      confidence TEXT NOT NULL,
      learning_stage TEXT NOT NULL,
      reason_codes TEXT NOT NULL,
      sample_size INTEGER NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      shadow INTEGER NOT NULL DEFAULT 1,
      decision TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS marketing_leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL DEFAULT '',
      channel TEXT NOT NULL,
      outcome TEXT NOT NULL DEFAULT 'UNKNOWN',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_marketing_snaps
      ON marketing_snapshots (public_id, collected_at);
    CREATE INDEX IF NOT EXISTS idx_marketing_recs
      ON marketing_recommendations (generated_at);
  `);
  mkdirSync(join(dataDir(), "concierge"), { recursive: true });
  database.exec(`
    CREATE TABLE IF NOT EXISTS concierge_conversations (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      state_json TEXT NOT NULL DEFAULT '{}',
      summary TEXT NOT NULL DEFAULT '',
      lead_public_id TEXT NOT NULL DEFAULT '',
      dry_run INTEGER NOT NULL DEFAULT 1,
      utm_json TEXT NOT NULL DEFAULT '',
      ip_hash TEXT NOT NULL DEFAULT '',
      processing INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS concierge_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS concierge_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      event TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS concierge_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      stored_as TEXT NOT NULL,
      mime TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS concierge_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_concierge_msgs
      ON concierge_messages (conversation_id, id);
    CREATE TABLE IF NOT EXISTS concierge_intelligence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      event TEXT NOT NULL,
      detail_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_concierge_intel
      ON concierge_intelligence (conversation_id, id);
  `);
  const conciergeCols = columnNames(database, "concierge_conversations");
  if (conciergeCols.length && !conciergeCols.includes("outcome")) {
    database.exec(`ALTER TABLE concierge_conversations ADD COLUMN outcome TEXT NOT NULL DEFAULT ''`);
  }
  const photoCols = columnNames(database, "concierge_photos");
  if (photoCols.length && !photoCols.includes("lead_id")) {
    database.exec(`ALTER TABLE concierge_photos ADD COLUMN lead_id TEXT NOT NULL DEFAULT ''`);
  }
  const requestCols = columnNames(database, "service_requests");
  if (requestCols.length && !requestCols.includes("facts_json")) {
    database.exec(`ALTER TABLE service_requests ADD COLUMN facts_json TEXT NOT NULL DEFAULT ''`);
  }
  migrateRevenueEngine(database);
}

function migrateRevenueEngine(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS revenue_customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      general_location TEXT NOT NULL DEFAULT '',
      preferred_channel TEXT NOT NULL DEFAULT '',
      source_first TEXT NOT NULL DEFAULT 'UNKNOWN',
      source_last TEXT NOT NULL DEFAULT 'UNKNOWN',
      do_not_contact INTEGER NOT NULL DEFAULT 0,
      is_test INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_rev_cust_phone ON revenue_customers (phone);
    CREATE TABLE IF NOT EXISTS revenue_leads (
      lead_id TEXT PRIMARY KEY,
      customer_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'WEBSITE_FORM',
      source_detail TEXT NOT NULL DEFAULT '',
      utm_json TEXT NOT NULL DEFAULT '',
      content_id TEXT NOT NULL DEFAULT '',
      conversation_id TEXT NOT NULL DEFAULT '',
      service_category TEXT NOT NULL DEFAULT '',
      problem_summary TEXT NOT NULL DEFAULT '',
      general_location TEXT NOT NULL DEFAULT '',
      temperature TEXT NOT NULL DEFAULT 'COLD',
      lead_score INTEGER NOT NULL DEFAULT 0,
      pipeline_stage TEXT NOT NULL DEFAULT 'NEW',
      next_action TEXT NOT NULL DEFAULT 'CONTACT_HOT_LEAD',
      next_follow_up_at TEXT,
      lost_reason TEXT NOT NULL DEFAULT '',
      quote_id TEXT NOT NULL DEFAULT '',
      job_id TEXT NOT NULL DEFAULT '',
      is_test INTEGER NOT NULL DEFAULT 0,
      dry_run INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS revenue_followups (
      followup_id TEXT PRIMARY KEY,
      lead_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      scheduled_at TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'TELEGRAM_INTERNAL',
      status TEXT NOT NULL DEFAULT 'PENDING',
      attempt INTEGER NOT NULL DEFAULT 1,
      suggested_message TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS revenue_quotes (
      quote_id TEXT PRIMARY KEY,
      quote_number TEXT NOT NULL UNIQUE,
      lead_id TEXT NOT NULL,
      customer_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      valid_until TEXT,
      items_json TEXT NOT NULL DEFAULT '[]',
      subtotal REAL,
      tax REAL,
      discount REAL,
      total REAL,
      currency TEXT NOT NULL DEFAULT 'PAB',
      status TEXT NOT NULL DEFAULT 'DRAFT',
      pricing_status TEXT NOT NULL DEFAULT 'NEEDS_MANUAL_PRICING',
      notes TEXT NOT NULL DEFAULT '',
      terms TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1,
      sent_at TEXT,
      accepted_at TEXT,
      rejected_at TEXT
    );
    CREATE TABLE IF NOT EXISTS revenue_appointments (
      appointment_id TEXT PRIMARY KEY,
      lead_id TEXT NOT NULL,
      job_id TEXT NOT NULL DEFAULT '',
      customer_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL DEFAULT '',
      service TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'PROPOSED',
      assigned_to TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      confirmed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS revenue_jobs (
      job_id TEXT PRIMARY KEY,
      job_number TEXT NOT NULL UNIQUE,
      lead_id TEXT NOT NULL,
      customer_id INTEGER NOT NULL,
      quote_id TEXT NOT NULL DEFAULT '',
      appointment_id TEXT NOT NULL DEFAULT '',
      service TEXT NOT NULL DEFAULT '',
      scope TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'SCHEDULED',
      quoted_amount REAL,
      final_amount REAL,
      payment_status TEXT NOT NULL DEFAULT 'UNPAID',
      satisfaction TEXT NOT NULL DEFAULT '',
      photo_permission INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS revenue_reviews (
      review_id TEXT PRIMARY KEY,
      customer_id INTEGER NOT NULL,
      job_id TEXT NOT NULL DEFAULT '',
      platform TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ELIGIBLE',
      requested_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS revenue_referrals (
      referral_id TEXT PRIMARY KEY,
      referrer_customer_id INTEGER NOT NULL,
      referred_lead_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ASKED',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS revenue_maintenance (
      opportunity_id TEXT PRIMARY KEY,
      customer_id INTEGER NOT NULL,
      lead_id TEXT NOT NULL DEFAULT '',
      service TEXT NOT NULL,
      eligible_at TEXT NOT NULL,
      recommended_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS revenue_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id TEXT NOT NULL DEFAULT '',
      event TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS revenue_quote_counters (
      year INTEGER PRIMARY KEY,
      last INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS revenue_job_counters (
      year INTEGER PRIMARY KEY,
      last INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS revenue_operator_pending (
      chat_id TEXT PRIMARY KEY,
      lead_id TEXT NOT NULL,
      expect TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  migrateLeadHandoff(database);
  migrateAppointmentCalendar(database);
  migrateAutomationOutbox(database);
  migrateWaveC(database);
  migrateTelegramOperatorsTable(database);
  migrateRetentionWaveETable(database);
}

function migrateRetentionWaveETable(database: Database.Database) {
  const { migrateRetentionWaveE } = require("@/lib/retention-engine") as typeof import("@/lib/retention-engine");
  migrateRetentionWaveE(database);
}

function migrateAppointmentCalendar(database: Database.Database) {
  const cols = columnNames(database, "revenue_appointments");
  if (cols.length && !cols.includes("version")) {
    database.exec(`ALTER TABLE revenue_appointments ADD COLUMN version INTEGER NOT NULL DEFAULT 1`);
  }
  if (cols.length && !cols.includes("notes")) {
    database.exec(`ALTER TABLE revenue_appointments ADD COLUMN notes TEXT NOT NULL DEFAULT ''`);
  }
  if (cols.length && !cols.includes("source")) {
    database.exec(`ALTER TABLE revenue_appointments ADD COLUMN source TEXT NOT NULL DEFAULT ''`);
  }
  database.exec(`
    CREATE TABLE IF NOT EXISTS revenue_appointment_notices (
      notice_key TEXT PRIMARY KEY,
      appointment_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      version INTEGER NOT NULL,
      sent_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rev_appt_date ON revenue_appointments (date, start_time);
    CREATE INDEX IF NOT EXISTS idx_rev_appt_status ON revenue_appointments (status);
  `);
  try {
    database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_rev_appt_open_slot
      ON revenue_appointments (date, start_time)
      WHERE status IN ('REQUESTED','PROPOSED','CONFIRMED','RESCHEDULED');
    `);
  } catch {
    // Existing overlapping open slots would block boot. App continues; uniqueness still enforced in createAppointment.
  }
}

function migrateAutomationOutbox(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS automation_outbox (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      correlation_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 8,
      next_attempt_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_attempt_at TEXT,
      delivered_at TEXT,
      last_error TEXT NOT NULL DEFAULT '',
      processing_until TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_outbox_status_next
      ON automation_outbox (status, next_attempt_at);
    CREATE INDEX IF NOT EXISTS idx_outbox_correlation
      ON automation_outbox (correlation_id);
    CREATE TABLE IF NOT EXISTS automation_engine_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS automation_outbox_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
  `);
}

function migrateLeadHandoff(database: Database.Database) {
  const leadCols = columnNames(database, "revenue_leads");
  const addLead = (name: string, ddl: string) => {
    if (!leadCols.includes(name)) database.exec(`ALTER TABLE revenue_leads ADD COLUMN ${ddl}`);
  };
  addLead("phone_normalized", "phone_normalized TEXT NOT NULL DEFAULT ''");
  addLead("preferred_date", "preferred_date TEXT NOT NULL DEFAULT ''");
  addLead("preferred_time_window", "preferred_time_window TEXT NOT NULL DEFAULT ''");
  addLead("contact_captured_at", "contact_captured_at TEXT");
  addLead("lead_created_at", "lead_created_at TEXT");
  addLead("internal_alert_at", "internal_alert_at TEXT");
  addLead("first_human_action_at", "first_human_action_at TEXT");
  addLead("visit_proposed_at", "visit_proposed_at TEXT");
  addLead("visit_confirmed_at", "visit_confirmed_at TEXT");
  addLead("hot_reminded_at", "hot_reminded_at TEXT");
  addLead("pending_operator", "pending_operator TEXT NOT NULL DEFAULT ''");
  addLead("snoozed_until", "snoozed_until TEXT");
  addLead("dismissed_at", "dismissed_at TEXT");
  addLead("rescue_cycle", "rescue_cycle INTEGER NOT NULL DEFAULT 0");
  addLead("rescue_alerted_at", "rescue_alerted_at TEXT");
  addLead("rescued_to_booking", "rescued_to_booking INTEGER NOT NULL DEFAULT 0");
  migrateOpsWaveB(database);
}

function migrateTelegramOperatorsTable(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS telegram_operators (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_user_id TEXT NOT NULL UNIQUE,
      telegram_chat_id TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'PENDING',
      is_active INTEGER NOT NULL DEFAULT 0,
      notify_requests INTEGER NOT NULL DEFAULT 0,
      notify_appointments INTEGER NOT NULL DEFAULT 0,
      notify_leads INTEGER NOT NULL DEFAULT 0,
      notify_sla INTEGER NOT NULL DEFAULT 0,
      notify_content INTEGER NOT NULL DEFAULT 0,
      notify_daily_brief INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_seen_at TEXT,
      approved_at TEXT,
      approved_by_operator_id INTEGER,
      deactivated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_telegram_operators_active
      ON telegram_operators (is_active, role);
    CREATE INDEX IF NOT EXISTS idx_telegram_operators_chat
      ON telegram_operators (telegram_chat_id);
    CREATE TABLE IF NOT EXISTS telegram_operator_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operator_id INTEGER,
      telegram_user_id TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL DEFAULT '',
      entity_id TEXT NOT NULL DEFAULT '',
      result TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_telegram_operator_audit_entity
      ON telegram_operator_audit (entity_type, entity_id, created_at);
    CREATE TABLE IF NOT EXISTS telegram_operator_metrics (
      key TEXT PRIMARY KEY,
      value INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
  `);
  const now = new Date().toISOString();
  for (const key of [
    "active_telegram_operators",
    "pending_telegram_operators",
    "telegram_delivery_success",
    "telegram_delivery_failure",
    "telegram_permission_denied",
    "telegram_stale_callback",
  ]) {
    database
      .prepare(
        "INSERT OR IGNORE INTO telegram_operator_metrics (key, value, updated_at) VALUES (?, 0, ?)",
      )
      .run(key, now);
  }
  const ids = [
    ...(process.env.HOMESTEAD_TELEGRAM_ADMIN_CHAT_IDS || "").split(/[,\s]+/),
    process.env.HOMESTEAD_TELEGRAM_CHAT_ID || "",
  ]
    .map((item) => item.trim())
    .filter(Boolean);
  const unique = [...new Set(ids)];
  for (const id of unique) {
    const row = database
      .prepare("SELECT id FROM telegram_operators WHERE telegram_user_id = ? OR telegram_chat_id = ?")
      .get(id, id);
    if (row) continue;
    database
      .prepare(
        `INSERT INTO telegram_operators (
          telegram_user_id, telegram_chat_id, display_name, role, is_active,
          notify_requests, notify_appointments, notify_leads, notify_sla, notify_content, notify_daily_brief,
          created_at, updated_at, approved_at
        ) VALUES (?, ?, ?, 'OWNER', 1, 1, 1, 1, 1, 1, 1, ?, ?, ?)`,
      )
      .run(id, id, "Owner", now, now, now);
  }
}

function migrateOpsWaveB(database: Database.Database) {
  const reqCols = columnNames(database, "service_requests");
  const addReq = (name: string, ddl: string) => {
    if (reqCols.includes(name)) return;
    database.exec(`ALTER TABLE service_requests ADD COLUMN ${ddl}`);
  };
  addReq("sla_first_alerted_at", "sla_first_alerted_at TEXT");
  addReq("sla_escalated_at", "sla_escalated_at TEXT");
  addReq("snoozed_until", "snoozed_until TEXT");
  database.exec(`
    CREATE TABLE IF NOT EXISTS ops_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      actor TEXT NOT NULL DEFAULT '',
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ops_audit_entity ON ops_audit (entity_type, entity_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_leads_rescue ON revenue_leads (dismissed_at, first_human_action_at, rescue_alerted_at);
    CREATE INDEX IF NOT EXISTS idx_requests_sla ON service_requests (status, sla_first_alerted_at, sla_escalated_at);
  `);
}

function migrateWaveC(database: Database.Database) {
  const jobCols = columnNames(database, "revenue_jobs");
  const addJob = (name: string, ddl: string) => {
    if (jobCols.includes(name)) return;
    database.exec(`ALTER TABLE revenue_jobs ADD COLUMN ${ddl}`);
  };
  addJob("started_at", "started_at TEXT");
  addJob("started_by", "started_by TEXT NOT NULL DEFAULT ''");
  addJob("completed_by", "completed_by TEXT NOT NULL DEFAULT ''");
  addJob("cancelled_at", "cancelled_at TEXT");
  addJob("cancel_reason", "cancel_reason TEXT NOT NULL DEFAULT ''");
  addJob("followup_due_at", "followup_due_at TEXT");
  addJob("followup_sent_at", "followup_sent_at TEXT");
  addJob("followup_status", "followup_status TEXT NOT NULL DEFAULT ''");
  addJob("followup_cycle", "followup_cycle INTEGER NOT NULL DEFAULT 0");
  addJob("satisfaction_response", "satisfaction_response TEXT NOT NULL DEFAULT ''");
  addJob("satisfaction_received_at", "satisfaction_received_at TEXT");
  addJob("review_requested_at", "review_requested_at TEXT");
  addJob("review_link_opened_at", "review_link_opened_at TEXT");
  addJob("review_reminder_at", "review_reminder_at TEXT");
  addJob("marketing_usage_approved", "marketing_usage_approved INTEGER NOT NULL DEFAULT 0");
  addJob("marketing_usage_approved_at", "marketing_usage_approved_at TEXT");
  addJob("recommended_next_service_at", "recommended_next_service_at TEXT");
  addJob("source_content_id", "source_content_id TEXT NOT NULL DEFAULT ''");
  addJob("photo_count", "photo_count INTEGER NOT NULL DEFAULT 0");
  addJob("is_test", "is_test INTEGER NOT NULL DEFAULT 0");
  addJob("recovery_status", "recovery_status TEXT NOT NULL DEFAULT ''");
  addJob("recovery_at", "recovery_at TEXT");
  addJob("recovery_contacted_at", "recovery_contacted_at TEXT");
  addJob("feedback_cycle", "feedback_cycle INTEGER NOT NULL DEFAULT 0");
  addJob("content_prompted_at", "content_prompted_at TEXT");
  addJob("content_skipped_at", "content_skipped_at TEXT");
  const custCols = columnNames(database, "revenue_customers");
  if (custCols.length && !custCols.includes("marketing_opt_in")) {
    database.exec(`ALTER TABLE revenue_customers ADD COLUMN marketing_opt_in INTEGER NOT NULL DEFAULT 0`);
  }
  database.exec(`
    CREATE TABLE IF NOT EXISTS job_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      original_relpath TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      mime TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'WORK',
      marketing_usage_approved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL DEFAULT '',
      UNIQUE (job_id, sha256)
    );
    CREATE INDEX IF NOT EXISTS idx_job_photos_job ON job_photos (job_id, created_at);
    CREATE TABLE IF NOT EXISTS job_feedback_tokens (
      token TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      cycle INTEGER NOT NULL DEFAULT 1,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      response TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_job_feedback_job ON job_feedback_tokens (job_id, cycle);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON revenue_jobs (status, is_test, created_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_customer ON revenue_jobs (customer_id, status);
    CREATE INDEX IF NOT EXISTS idx_jobs_appointment ON revenue_jobs (appointment_id);
  `);
}

export function getHomesteadDb() {
  return getDb();
}

export function homesteadDataDir() {
  return dataDir();
}

function getDb() {
  if (db) return db;
  mkdirSync(join(dataDir(), "photos"), { recursive: true });
  mkdirSync(join(dataDir(), "content"), { recursive: true });
  mkdirSync(join(dataDir(), "concierge"), { recursive: true });
  mkdirSync(join(dataDir(), "jobs"), { recursive: true });
  const instance = new Database(dbPath());
  instance.pragma("journal_mode = WAL");
  instance.pragma("busy_timeout = 4000");
  instance.exec(`
    CREATE TABLE IF NOT EXISTS request_counters (
      year INTEGER PRIMARY KEY,
      last INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS service_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT NOT NULL,
      property TEXT NOT NULL,
      service TEXT NOT NULL,
      message TEXT NOT NULL,
      photos_json TEXT NOT NULL
    );
  `);
  migrate(instance);
  db = instance;
  return instance;
}

function nextPublicId(database: Database.Database, year: number) {
  const row = database
    .prepare("SELECT last FROM request_counters WHERE year = ?")
    .get(year) as { last: number } | undefined;
  const last = row ? row.last + 1 : 1;
  if (row) {
    database.prepare("UPDATE request_counters SET last = ? WHERE year = ?").run(last, year);
  } else {
    database.prepare("INSERT INTO request_counters (year, last) VALUES (?, ?)").run(year, last);
  }
  return `HS-${year}-${String(last).padStart(6, "0")}`;
}

function photosRoot(publicId: string) {
  return resolve(join(dataDir(), "photos", publicId));
}

function isInside(root: string, target: string) {
  const prefix = root.endsWith(sep) ? root : root + sep;
  return target === root || target.startsWith(prefix);
}

export function saveServiceRequest(input: {
  name: string;
  phone: string;
  email: string;
  property: string;
  service: string;
  message: string;
  photos: BufferedPhoto[];
  factsJson?: string;
}): SavedServiceRequest {
  const database = getDb();
  const created = new Date();
  const year = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Panama",
      year: "numeric",
    }).format(created),
  );
  const createdAt = created.toISOString();

  const saved = database.transaction(() => {
    const publicId = nextPublicId(database, year);
    const photoDir = join(dataDir(), "photos", publicId);
    mkdirSync(photoDir, { recursive: true });
    const photos: SavedPhoto[] = [];
    for (const [index, file] of input.photos.entries()) {
      const storedAs = storedPhotoName(index, file.sniffed.ext);
      writeFileSync(join(photoDir, storedAs), file.bytes);
      photos.push({
        name: storedAs,
        size: file.size,
        type: file.sniffed.mime,
        storedAs,
      });
    }
    const factsJson = input.factsJson || "";
    const info = database
      .prepare(
        `INSERT INTO service_requests
          (public_id, created_at, updated_at, status, name, phone, email, property, service, message, photos_json, facts_json)
         VALUES (?, ?, ?, 'NEW', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        publicId,
        createdAt,
        createdAt,
        input.name,
        input.phone,
        input.email,
        input.property,
        input.service,
        input.message,
        JSON.stringify(photos),
        factsJson,
      );
    const saved: SavedServiceRequest = {
      id: Number(info.lastInsertRowid),
      publicId,
      createdAt,
      updatedAt: createdAt,
      status: "NEW",
      name: input.name,
      phone: input.phone,
      email: input.email,
      property: input.property,
      service: input.service,
      message: input.message,
      photos,
      factsJson,
    };
    insertMessage(database, {
      requestPk: saved.id,
      publicId,
      direction: "INBOUND",
      channel: "FORM",
      subject: "Solicitud recibida",
      body: input.message,
      status: "RECORDED",
      sentAt: createdAt,
    });
    const payload = buildN8nPayload(saved);
    enqueueOutbox(database, {
      eventType: "service_request.created",
      correlationId: publicId,
      idempotencyKey: `service_request.created:${publicId}`,
      data: payload as unknown as Record<string, unknown>,
    });
    return saved;
  })();
  void import("@/lib/revenue-ingest").then((mod) => mod.ingestSavedRequest(saved)).catch(() => undefined);
  return saved;
}

export function readStoredPhoto(publicId: string, storedAs: string) {
  const root = photosRoot(publicId);
  const target = resolve(join(root, storedAs));
  if (!isInside(root, target)) return null;
  const database = getDb();
  const row = database
    .prepare("SELECT photos_json FROM service_requests WHERE public_id = ?")
    .get(publicId) as { photos_json: string } | undefined;
  if (!row) return null;
  const photos = JSON.parse(row.photos_json) as SavedPhoto[];
  const meta = photos.find((photo) => photo.storedAs === storedAs);
  if (!meta) return null;
  try {
    return {
      bytes: readFileSync(target),
      mime: meta.type || "application/octet-stream",
      storedAs: meta.storedAs,
    };
  } catch {
    return null;
  }
}

export function customerWhatsAppUrl(phone: string, message?: string) {
  const intl = toWhatsAppDigits(phone);
  if (!intl) return null;
  const text = message ? `?text=${encodeURIComponent(message)}` : "";
  return `https://wa.me/${intl}${text}`;
}

type DbRequestRow = {
  id: number;
  public_id: string;
  created_at: string;
  updated_at: string | null;
  status: string;
  name: string;
  phone: string;
  email: string;
  property: string;
  service: string;
  message: string;
  photos_json: string;
  facts_json?: string;
};

function mapRequest(row: DbRequestRow): SavedServiceRequest {
  return {
    id: row.id,
    publicId: row.public_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
    status: isRequestStatus(row.status) ? row.status : "NEW",
    name: row.name,
    phone: row.phone,
    email: row.email,
    property: row.property,
    service: row.service,
    message: row.message,
    photos: JSON.parse(row.photos_json) as SavedPhoto[],
    factsJson: row.facts_json || "",
  };
}

function insertMessage(
  database: Database.Database,
  input: {
    requestPk: number;
    publicId: string;
    direction: RequestMessage["direction"];
    channel: RequestMessage["channel"];
    subject: string;
    body: string;
    status: RequestMessage["status"];
    sentAt: string | null;
  },
) {
  const createdAt = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO service_request_messages
        (request_pk, public_id, direction, channel, subject, body, status, sent_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.requestPk,
      input.publicId,
      input.direction,
      input.channel,
      input.subject,
      input.body,
      input.status,
      input.sentAt,
      createdAt,
    );
}

const REQUEST_SELECT = `id, public_id, created_at, updated_at, status, name, phone, email, property, service, message, photos_json, COALESCE(facts_json,'') as facts_json`;

export function getRequestByPublicId(publicId: string) {
  if (!PUBLIC_ID_PATTERN.test(publicId)) return null;
  const row = getDb()
    .prepare(`SELECT ${REQUEST_SELECT} FROM service_requests WHERE public_id = ?`)
    .get(publicId) as DbRequestRow | undefined;
  return row ? mapRequest(row) : null;
}

export function listRequestMessages(publicId: string): RequestMessage[] {
  const rows = getDb()
    .prepare(
      `SELECT id, public_id, direction, channel, subject, body, status, sent_at, created_at
       FROM service_request_messages WHERE public_id = ? ORDER BY created_at ASC, id ASC`,
    )
    .all(publicId) as Array<{
    id: number;
    public_id: string;
    direction: RequestMessage["direction"];
    channel: RequestMessage["channel"];
    subject: string;
    body: string;
    status: RequestMessage["status"];
    sent_at: string | null;
    created_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    publicId: row.public_id,
    direction: row.direction,
    channel: row.channel,
    subject: row.subject,
    body: row.body,
    status: row.status,
    sentAt: row.sent_at,
    createdAt: row.created_at,
  }));
}

export function listServiceRequests(filters: {
  q?: string;
  status?: RequestStatus | "ALL";
  service?: string;
  from?: string;
  to?: string;
}) {
  const clauses: string[] = [];
  const params: Array<string> = [];
  if (filters.status && filters.status !== "ALL") {
    clauses.push("status = ?");
    params.push(filters.status);
  }
  if (filters.service) {
    clauses.push("service = ?");
    params.push(filters.service);
  }
  if (filters.from) {
    clauses.push("created_at >= ?");
    params.push(filters.from);
  }
  if (filters.to) {
    clauses.push("created_at <= ?");
    params.push(filters.to);
  }
  if (filters.q?.trim()) {
    const query = `%${filters.q.trim().toLowerCase()}%`;
    clauses.push(
      "(lower(public_id) LIKE ? OR lower(name) LIKE ? OR lower(email) LIKE ? OR phone LIKE ?)",
    );
    params.push(query, query, query, `%${filters.q.trim()}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = getDb()
    .prepare(
      `SELECT ${REQUEST_SELECT} FROM service_requests ${where} ORDER BY created_at DESC, id DESC`,
    )
    .all(...params) as DbRequestRow[];
  return rows.map(mapRequest);
}

export function countRequestsByStatus() {
  const rows = getDb()
    .prepare("SELECT status, COUNT(*) as total FROM service_requests GROUP BY status")
    .all() as Array<{ status: string; total: number }>;
  const counts: Record<RequestStatus, number> = {
    NEW: 0,
    CONTACTED: 0,
    IN_PROGRESS: 0,
    COMPLETED: 0,
    CANCELLED: 0,
  };
  for (const row of rows) {
    if (isRequestStatus(row.status)) counts[row.status] = row.total;
  }
  return counts;
}

export function updateRequestStatus(publicId: string, status: RequestStatus) {
  const request = getRequestByPublicId(publicId);
  if (!request) return null;
  const updatedAt = new Date().toISOString();
  getDb()
    .prepare(
      "UPDATE service_requests SET status = ?, updated_at = ? WHERE public_id = ?",
    )
    .run(status, updatedAt, publicId);
  return getRequestByPublicId(publicId);
}

export function repliedPublicIds() {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT public_id FROM service_request_messages
       WHERE channel = 'EMAIL' AND status = 'SENT'`,
    )
    .all() as Array<{ public_id: string }>;
  return new Set(rows.map((row) => row.public_id));
}

export function recordTelegramNotified(request: SavedServiceRequest) {
  insertMessage(getDb(), {
    requestPk: request.id,
    publicId: request.publicId,
    direction: "OUTBOUND",
    channel: "TELEGRAM",
    subject: "Notificación Telegram",
    body: "Notificación enviada a Telegram",
    status: "SENT",
    sentAt: new Date().toISOString(),
  });
}

export function beginReplyLock(publicId: string) {
  const database = getDb();
  const now = Date.now();
  const row = database
    .prepare(
      "SELECT id, reply_lock_until FROM service_requests WHERE public_id = ?",
    )
    .get(publicId) as { id: number; reply_lock_until: string | null } | undefined;
  if (!row) return false;
  if (row.reply_lock_until && Date.parse(row.reply_lock_until) > now) return false;
  const until = new Date(now + 20_000).toISOString();
  const result = database
    .prepare(
      `UPDATE service_requests SET reply_lock_until = ?
       WHERE public_id = ? AND (reply_lock_until IS NULL OR reply_lock_until <= ?)`,
    )
    .run(until, publicId, new Date(now).toISOString());
  return result.changes === 1;
}

export function clearReplyLock(publicId: string) {
  getDb()
    .prepare("UPDATE service_requests SET reply_lock_until = NULL WHERE public_id = ?")
    .run(publicId);
}

export function recordOutboundEmail(input: {
  request: SavedServiceRequest;
  subject: string;
  body: string;
  sent: boolean;
}) {
  const sentAt = new Date().toISOString();
  const database = getDb();
  database.transaction(() => {
    insertMessage(database, {
      requestPk: input.request.id,
      publicId: input.request.publicId,
      direction: "OUTBOUND",
      channel: "EMAIL",
      subject: input.subject,
      body: input.body,
      status: input.sent ? "SENT" : "FAILED",
      sentAt: input.sent ? sentAt : null,
    });
    if (input.sent) {
      const nextStatus =
        input.request.status === "NEW" ? "CONTACTED" : input.request.status;
      database
        .prepare(
          "UPDATE service_requests SET status = ?, updated_at = ? WHERE public_id = ?",
        )
        .run(nextStatus, sentAt, input.request.publicId);
    }
  })();
}
