import { createHash } from "crypto";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve, sep } from "path";
import {
  ACTIVE_CONTENT_STATUSES,
  CONTENT_ID_PATTERN,
  MAX_CONTENT_PHOTOS,
  type ContentAsset,
  type ContentAssetRole,
  type ContentAssetType,
  type ContentJob,
  type ContentStatus,
  type ContentVersion,
} from "@/lib/content-types";
import { getHomesteadDb, homesteadDataDir } from "@/lib/service-requests";

type JobRow = {
  id: number;
  public_id: string;
  status: ContentStatus;
  description: string;
  service_type: string;
  telegram_chat_id: string;
  telegram_user_id: string;
  telegram_status_message_id: number | null;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  rejected_at: string | null;
  last_error: string | null;
};

function mapJob(row: JobRow): ContentJob {
  return {
    id: row.id,
    publicId: row.public_id,
    status: row.status,
    description: row.description,
    serviceType: row.service_type,
    telegramChatId: row.telegram_chat_id,
    telegramUserId: row.telegram_user_id,
    telegramStatusMessageId: row.telegram_status_message_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    approvedAt: row.approved_at,
    rejectedAt: row.rejected_at,
    lastError: row.last_error,
  };
}

function panamaYear(date = new Date()) {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Panama",
      year: "numeric",
    }).format(date),
  );
}

function panamaMonth(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Panama",
    month: "2-digit",
  }).format(date);
}

export function contentRoot(publicId: string, createdAt?: string) {
  const date = createdAt ? new Date(createdAt) : new Date();
  return join(
    homesteadDataDir(),
    "content",
    String(panamaYear(date)),
    panamaMonth(date),
    publicId,
  );
}

function isInside(root: string, target: string) {
  const prefix = root.endsWith(sep) ? root : root + sep;
  return target === root || target.startsWith(prefix);
}

function nextPublicId() {
  const database = getHomesteadDb();
  const year = panamaYear();
  const row = database
    .prepare("SELECT last FROM content_counters WHERE year = ?")
    .get(year) as { last: number } | undefined;
  const last = row ? row.last + 1 : 1;
  if (row) {
    database.prepare("UPDATE content_counters SET last = ? WHERE year = ?").run(last, year);
  } else {
    database.prepare("INSERT INTO content_counters (year, last) VALUES (?, ?)").run(year, last);
  }
  return `HC-${year}-${String(last).padStart(6, "0")}`;
}

export function createContentJob(input: {
  chatId: string;
  userId: string;
}): ContentJob {
  const database = getHomesteadDb();
  const now = new Date().toISOString();
  const publicId = nextPublicId();
  mkdirSync(join(contentRoot(publicId, now), "originals"), { recursive: true });
  mkdirSync(join(contentRoot(publicId, now), "enhanced"), { recursive: true });
  mkdirSync(join(contentRoot(publicId, now), "branded"), { recursive: true });
  mkdirSync(join(contentRoot(publicId, now), "published"), { recursive: true });
  const info = database
    .prepare(
      `INSERT INTO content_jobs
        (public_id, status, description, service_type, telegram_chat_id, telegram_user_id, created_at, updated_at)
       VALUES (?, 'DRAFT', '', '', ?, ?, ?, ?)`,
    )
    .run(publicId, input.chatId, input.userId, now, now);
  return getJobById(Number(info.lastInsertRowid))!;
}

export function getJobById(id: number) {
  const row = getHomesteadDb()
    .prepare("SELECT * FROM content_jobs WHERE id = ?")
    .get(id) as JobRow | undefined;
  return row ? mapJob(row) : null;
}

export function getJobByPublicId(publicId: string) {
  if (!CONTENT_ID_PATTERN.test(publicId)) return null;
  const row = getHomesteadDb()
    .prepare("SELECT * FROM content_jobs WHERE public_id = ?")
    .get(publicId) as JobRow | undefined;
  return row ? mapJob(row) : null;
}

export function activeJobForChat(chatId: string) {
  const placeholders = ACTIVE_CONTENT_STATUSES.map(() => "?").join(",");
  const row = getHomesteadDb()
    .prepare(
      `SELECT * FROM content_jobs
       WHERE telegram_chat_id = ? AND status IN (${placeholders})
       ORDER BY updated_at DESC LIMIT 1`,
    )
    .get(chatId, ...ACTIVE_CONTENT_STATUSES) as JobRow | undefined;
  return row ? mapJob(row) : null;
}

export function updateJob(
  publicId: string,
  patch: Partial<{
    status: ContentStatus;
    description: string;
    serviceType: string;
    telegramStatusMessageId: number | null;
    lastError: string | null;
    approvedAt: string | null;
    rejectedAt: string | null;
  }>,
) {
  const current = getJobByPublicId(publicId);
  if (!current) return null;
  const updatedAt = new Date().toISOString();
  getHomesteadDb()
    .prepare(
      `UPDATE content_jobs SET
        status = ?,
        description = ?,
        service_type = ?,
        telegram_status_message_id = ?,
        last_error = ?,
        approved_at = ?,
        rejected_at = ?,
        updated_at = ?
       WHERE public_id = ?`,
    )
    .run(
      patch.status ?? current.status,
      patch.description ?? current.description,
      patch.serviceType ?? current.serviceType,
      patch.telegramStatusMessageId === undefined
        ? current.telegramStatusMessageId
        : patch.telegramStatusMessageId,
      patch.lastError === undefined ? current.lastError : patch.lastError,
      patch.approvedAt === undefined ? current.approvedAt : patch.approvedAt,
      patch.rejectedAt === undefined ? current.rejectedAt : patch.rejectedAt,
      updatedAt,
      publicId,
    );
  return getJobByPublicId(publicId);
}

export function beginProcessLock(publicId: string, ms = 180_000) {
  const database = getHomesteadDb();
  const now = Date.now();
  const row = database
    .prepare("SELECT process_lock_until, status FROM content_jobs WHERE public_id = ?")
    .get(publicId) as { process_lock_until: string | null; status: string } | undefined;
  if (!row) return false;
  if (row.process_lock_until && Date.parse(row.process_lock_until) > now) return false;
  const until = new Date(now + ms).toISOString();
  const result = database
    .prepare(
      `UPDATE content_jobs SET process_lock_until = ?, updated_at = ?
       WHERE public_id = ? AND (process_lock_until IS NULL OR process_lock_until <= ?)`,
    )
    .run(until, new Date(now).toISOString(), publicId, new Date(now).toISOString());
  return result.changes === 1;
}

export function clearProcessLock(publicId: string) {
  getHomesteadDb()
    .prepare("UPDATE content_jobs SET process_lock_until = NULL WHERE public_id = ?")
    .run(publicId);
}

export function seenTelegramUpdate(updateId: number) {
  const database = getHomesteadDb();
  const existing = database
    .prepare("SELECT update_id FROM content_telegram_updates WHERE update_id = ?")
    .get(updateId);
  if (existing) return true;
  database
    .prepare("INSERT INTO content_telegram_updates (update_id, created_at) VALUES (?, ?)")
    .run(updateId, new Date().toISOString());
  return false;
}

export function listAssets(
  publicId: string,
  assetType?: ContentAssetType,
  version?: number,
) {
  const clauses = ["public_id = ?"];
  const params: Array<string | number> = [publicId];
  if (assetType) {
    clauses.push("asset_type = ?");
    params.push(assetType);
  }
  if (version !== undefined) {
    clauses.push("version = ?");
    params.push(version);
  }
  const rows = getHomesteadDb()
    .prepare(
      `SELECT * FROM content_assets WHERE ${clauses.join(" AND ")} ORDER BY id ASC`,
    )
    .all(...params) as Array<{
    id: number;
    job_id: number;
    public_id: string;
    version: number;
    asset_type: ContentAssetType;
    role: ContentAssetRole;
    stored_filename: string;
    relative_path: string;
    mime_type: string;
    size: number;
    width: number | null;
    height: number | null;
    sha256: string;
    telegram_file_id: string | null;
    created_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    jobId: row.job_id,
    publicId: row.public_id,
    version: row.version,
    assetType: row.asset_type,
    role: row.role,
    storedFilename: row.stored_filename,
    relativePath: row.relative_path,
    mimeType: row.mime_type,
    size: row.size,
    width: row.width,
    height: row.height,
    sha256: row.sha256,
    telegramFileId: row.telegram_file_id,
    createdAt: row.created_at,
  })) satisfies ContentAsset[];
}

export function originalCount(publicId: string) {
  return listAssets(publicId, "ORIGINAL", 0).length;
}

export function sha256Of(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function storeOriginal(input: {
  job: ContentJob;
  bytes: Buffer;
  mime: string;
  ext: string;
  telegramFileId?: string;
  width?: number | null;
  height?: number | null;
}) {
  if (originalCount(input.job.publicId) >= MAX_CONTENT_PHOTOS) {
    return { ok: false as const, error: "too_many" };
  }
  const hash = sha256Of(input.bytes);
  const duplicates = listAssets(input.job.publicId, "ORIGINAL", 0).filter(
    (asset) => asset.sha256 === hash,
  );
  if (duplicates.length) {
    return { ok: true as const, asset: duplicates[0], duplicate: true };
  }
  const index = originalCount(input.job.publicId) + 1;
  const storedFilename = `original-${String(index).padStart(3, "0")}.${input.ext}`;
  const relativePath = join(
    String(panamaYear(new Date(input.job.createdAt))),
    panamaMonth(new Date(input.job.createdAt)),
    input.job.publicId,
    "originals",
    storedFilename,
  );
  const abs = resolve(join(homesteadDataDir(), "content", relativePath));
  const root = resolve(contentRoot(input.job.publicId, input.job.createdAt));
  if (!isInside(root, abs)) return { ok: false as const, error: "path" };
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, input.bytes);
  const now = new Date().toISOString();
  const info = getHomesteadDb()
    .prepare(
      `INSERT INTO content_assets
        (job_id, public_id, version, asset_type, role, stored_filename, relative_path, mime_type, size, width, height, sha256, telegram_file_id, created_at)
       VALUES (?, ?, 0, 'ORIGINAL', '', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.job.id,
      input.job.publicId,
      storedFilename,
      relativePath.replaceAll("\\", "/"),
      input.mime,
      input.bytes.length,
      input.width ?? null,
      input.height ?? null,
      hash,
      input.telegramFileId ?? null,
      now,
    );
  const asset = listAssets(input.job.publicId, "ORIGINAL", 0).find(
    (item) => item.id === Number(info.lastInsertRowid),
  )!;
  return { ok: true as const, asset, duplicate: false };
}

export function storeDerivedAsset(input: {
  job: ContentJob;
  version: number;
  assetType: Exclude<ContentAssetType, "ORIGINAL">;
  role: ContentAssetRole;
  bytes: Buffer;
  mime: string;
  ext: string;
  folder: "enhanced" | "branded" | "published";
  filename: string;
  width?: number | null;
  height?: number | null;
}) {
  const relativePath = join(
    String(panamaYear(new Date(input.job.createdAt))),
    panamaMonth(new Date(input.job.createdAt)),
    input.job.publicId,
    input.folder,
    input.filename,
  );
  const abs = resolve(join(homesteadDataDir(), "content", relativePath));
  const root = resolve(contentRoot(input.job.publicId, input.job.createdAt));
  if (!isInside(root, abs)) throw new Error("content_path_escape");
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, input.bytes);
  const now = new Date().toISOString();
  getHomesteadDb()
    .prepare(
      `INSERT INTO content_assets
        (job_id, public_id, version, asset_type, role, stored_filename, relative_path, mime_type, size, width, height, sha256, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.job.id,
      input.job.publicId,
      input.version,
      input.assetType,
      input.role,
      input.filename,
      relativePath.replaceAll("\\", "/"),
      input.mime,
      input.bytes.length,
      input.width ?? null,
      input.height ?? null,
      sha256Of(input.bytes),
      now,
    );
}

export function readAssetBytes(asset: ContentAsset) {
  const abs = resolve(join(homesteadDataDir(), "content", asset.relativePath));
  const root = resolve(join(homesteadDataDir(), "content"));
  if (!isInside(root, abs)) return null;
  return readFileSync(abs);
}

export function nextVersionNumber(publicId: string) {
  const row = getHomesteadDb()
    .prepare("SELECT MAX(version) as max_version FROM content_versions WHERE public_id = ?")
    .get(publicId) as { max_version: number | null };
  return (row.max_version || 0) + 1;
}

export function saveVersion(input: {
  job: ContentJob;
  version: number;
  kind: ContentVersion["kind"];
  copy: string;
  cta: string;
  hashtags: string;
  prompt: string;
  privacyNote: string;
}) {
  const now = new Date().toISOString();
  getHomesteadDb()
    .prepare(
      `INSERT INTO content_versions
        (job_id, public_id, version, kind, copy, cta, hashtags, prompt, privacy_note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.job.id,
      input.job.publicId,
      input.version,
      input.kind,
      input.copy,
      input.cta,
      input.hashtags,
      input.prompt,
      input.privacyNote,
      now,
    );
}

export function latestVersion(publicId: string) {
  const row = getHomesteadDb()
    .prepare(
      `SELECT * FROM content_versions WHERE public_id = ? ORDER BY version DESC, id DESC LIMIT 1`,
    )
    .get(publicId) as
    | {
        id: number;
        job_id: number;
        public_id: string;
        version: number;
        kind: ContentVersion["kind"];
        copy: string;
        cta: string;
        hashtags: string;
        prompt: string;
        privacy_note: string;
        created_at: string;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    jobId: row.job_id,
    publicId: row.public_id,
    version: row.version,
    kind: row.kind,
    copy: row.copy,
    cta: row.cta,
    hashtags: row.hashtags,
    prompt: row.prompt,
    privacyNote: row.privacy_note,
    createdAt: row.created_at,
  } satisfies ContentVersion;
}

export function recordUsage(publicId: string, provider: string, operation: string) {
  getHomesteadDb()
    .prepare(
      "INSERT INTO content_usage (public_id, provider, operation, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(publicId, provider, operation, new Date().toISOString());
}

export function usageCount(publicId: string) {
  const row = getHomesteadDb()
    .prepare("SELECT COUNT(*) as total FROM content_usage WHERE public_id = ?")
    .get(publicId) as { total: number };
  return row.total;
}
