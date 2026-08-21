import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve, sep } from "path";
import Database from "better-sqlite3";
import { storedPhotoName, type SniffedImage } from "@/lib/photos";
import {
  isRequestStatus,
  PUBLIC_ID_PATTERN,
  type RequestStatus,
} from "@/lib/admin-format";

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

  return database.transaction(() => {
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
    const info = database
      .prepare(
        `INSERT INTO service_requests
          (public_id, created_at, updated_at, status, name, phone, email, property, service, message, photos_json)
         VALUES (?, ?, ?, 'NEW', ?, ?, ?, ?, ?, ?, ?)`,
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
    return saved;
  })();
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
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return null;
  const intl = digits.startsWith("507")
    ? digits
    : digits.length === 8
      ? `507${digits}`
      : digits;
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

const REQUEST_SELECT = `id, public_id, created_at, updated_at, status, name, phone, email, property, service, message, photos_json`;

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
