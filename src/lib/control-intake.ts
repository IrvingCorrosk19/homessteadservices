import { createHash, randomUUID } from "crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { dirname, join, resolve } from "path";
import {
  createContentJob,
  findOriginalBySha256,
  getJobByPublicId,
  latestVersion,
  listAssets,
  recordContentEvent,
  saveVersion,
  sha256Of,
  storeDerivedAsset,
  storeOriginal,
  updateJob,
} from "@/lib/content-catalog";
import { getHomesteadDb, homesteadDataDir } from "@/lib/service-requests";
import { nextBatchPublicId } from "@/lib/content-photo-batch";
import { applyHomesteadWatermark, enhanceDeterministic, metadataOf, toJpeg } from "@/lib/content-images";
import { isolatedCopyFallback } from "@/lib/control-isolation";
import { MAX_CONTENT_PHOTO_BYTES, MAX_CONTENT_PHOTOS } from "@/lib/content-types";
import { sniffImage } from "@/lib/photos";

export type ControlIntakeFile = {
  filename: string;
  bytes: Buffer;
  declaredType?: string;
};

export type ControlIntakeItemResult = {
  filename: string;
  ok: boolean;
  publicId: string;
  duplicate: boolean;
  error: string;
  status: string;
};

function intakeRoot() {
  return resolve(join(homesteadDataDir(), "content", "control-intake"));
}

function writeStaged(batchKey: string, hash: string, ext: string, bytes: Buffer) {
  const relative = join("control-intake", batchKey.replace(/[^a-zA-Z0-9_-]/g, "_"), `${hash.slice(0, 16)}.${ext}`);
  const abs = resolve(join(homesteadDataDir(), "content", relative));
  const root = resolve(join(homesteadDataDir(), "content"));
  if (!abs.startsWith(root)) throw new Error("path");
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, bytes);
  return relative.replaceAll("\\", "/");
}

export async function brandControlJob(publicId: string, bytes: Buffer) {
  const job = getJobByPublicId(publicId);
  if (!job) return { ok: false as const, error: "missing" };
  const jpeg = await toJpeg(bytes);
  const enhanced = await enhanceDeterministic(jpeg);
  let branded = enhanced;
  let width: number | null = null;
  let height: number | null = null;
  try {
    const marked = await applyHomesteadWatermark(enhanced);
    branded = marked.bytes;
    width = marked.width;
    height = marked.height;
  } catch {
    branded = enhanced;
  }
  const meta = width && height ? { width, height } : await metadataOf(branded);
  const version = latestVersion(publicId)?.version || 1;
  storeDerivedAsset({
    job,
    version,
    assetType: "BRANDED",
    role: "PRIMARY",
    bytes: branded,
    mime: "image/jpeg",
    ext: "jpg",
    folder: "branded",
    filename: `branded-v${version}-001-feed.jpg`,
    width: meta.width,
    height: meta.height,
  });
  const copy = isolatedCopyFallback(publicId);
  if (!latestVersion(publicId)) {
    saveVersion({
      job,
      version: 1,
      kind: "full",
      copy: copy.copy.full,
      cta: copy.copy.cta,
      hashtags: copy.copy.hashtags.join(" "),
      prompt: "control-local",
      privacyNote: copy.privacy.warning,
    });
  }
  updateJob(publicId, {
    status: "AWAITING_APPROVAL",
    selectedCaption: copy.copy.full,
    captionsJson: JSON.stringify(copy.copy),
    lastError: null,
  });
  recordContentEvent(publicId, "CONTENT_READY", "control-intake");
  return { ok: true as const };
}

function actorOwnsOriginal(publicId: string, actor: string) {
  const job = getJobByPublicId(publicId);
  if (!job) return false;
  return job.telegramChatId === `control:${actor}` || job.telegramUserId === actor;
}

function findActorOriginal(hash: string, actor: string) {
  const row = getHomesteadDb()
    .prepare(
      `SELECT i.public_id as public_id FROM control_intake_items i
       WHERE i.sha256 = ? AND i.actor = ? AND i.public_id != '' AND i.status IN ('ready','duplicate')
       ORDER BY i.id ASC LIMIT 1`,
    )
    .get(hash, actor) as { public_id: string } | undefined;
  if (row?.public_id) return row.public_id;
  const global = findOriginalBySha256(hash);
  if (global && actorOwnsOriginal(global, actor)) return global;
  return null;
}

function upsertItem(input: {
  batchKey: string;
  filename: string;
  sha256: string;
  actor: string;
  status: string;
  publicId?: string;
  relativePath?: string;
  error?: string;
}) {
  const now = new Date().toISOString();
  const existing = getHomesteadDb()
    .prepare(
      `SELECT id FROM control_intake_items WHERE batch_key = ? AND sha256 = ? AND filename = ? LIMIT 1`,
    )
    .get(input.batchKey, input.sha256, input.filename) as { id: number } | undefined;
  if (existing) {
    getHomesteadDb()
      .prepare(
        `UPDATE control_intake_items SET status = ?, public_id = ?, relative_path = ?, error = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        input.status,
        input.publicId || "",
        input.relativePath || "",
        input.error || "",
        now,
        existing.id,
      );
    return existing.id;
  }
  const info = getHomesteadDb()
    .prepare(
      `INSERT INTO control_intake_items
        (batch_key, filename, sha256, actor, status, public_id, relative_path, error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.batchKey,
      input.filename,
      input.sha256,
      input.actor,
      input.status,
      input.publicId || "",
      input.relativePath || "",
      input.error || "",
      now,
      now,
    );
  return Number(info.lastInsertRowid);
}

async function processReceivedItem(row: {
  id: number;
  filename: string;
  sha256: string;
  actor: string;
  batch_key: string;
  relative_path: string;
  public_id: string;
}, note: string) {
  const existing = findActorOriginal(row.sha256, row.actor);
  if (existing) {
    upsertItem({
      batchKey: row.batch_key,
      filename: row.filename,
      sha256: row.sha256,
      actor: row.actor,
      status: "duplicate",
      publicId: existing,
      relativePath: row.relative_path,
    });
    return { filename: row.filename, ok: true, publicId: existing, duplicate: true, error: "", status: "duplicate" };
  }
  const abs = resolve(join(homesteadDataDir(), "content", row.relative_path));
  if (!existsSync(abs)) {
    upsertItem({
      batchKey: row.batch_key,
      filename: row.filename,
      sha256: row.sha256,
      actor: row.actor,
      status: "failed",
      error: "missing_file",
    });
    return { filename: row.filename, ok: false, publicId: "", duplicate: false, error: "missing_file", status: "failed" };
  }
  const bytes = readFileSync(abs);
  upsertItem({
    batchKey: row.batch_key,
    filename: row.filename,
    sha256: row.sha256,
    actor: row.actor,
    status: "processing",
    relativePath: row.relative_path,
  });
  const job = row.public_id ? getJobByPublicId(row.public_id) : createContentJob({ chatId: `control:${row.actor}`, userId: row.actor });
  if (!job) {
    upsertItem({
      batchKey: row.batch_key,
      filename: row.filename,
      sha256: row.sha256,
      actor: row.actor,
      status: "failed",
      error: "missing",
    });
    return { filename: row.filename, ok: false, publicId: "", duplicate: false, error: "missing", status: "failed" };
  }
  const sniffed = sniffImage(bytes, MAX_CONTENT_PHOTO_BYTES);
  if (!sniffed) {
    upsertItem({
      batchKey: row.batch_key,
      filename: row.filename,
      sha256: row.sha256,
      actor: row.actor,
      status: "failed",
      publicId: job.publicId,
      error: "invalid_image",
    });
    return { filename: row.filename, ok: false, publicId: job.publicId, duplicate: false, error: "invalid_image", status: "failed" };
  }
  if (!listAssets(job.publicId, "ORIGINAL", 0).length) {
    const stored = storeOriginal({ job, bytes, mime: sniffed.mime, ext: sniffed.ext });
    if (!stored.ok) {
      updateJob(job.publicId, { status: "FAILED", lastError: stored.error });
      upsertItem({
        batchKey: row.batch_key,
        filename: row.filename,
        sha256: row.sha256,
        actor: row.actor,
        status: "failed",
        publicId: job.publicId,
        error: stored.error,
      });
      return { filename: row.filename, ok: false, publicId: job.publicId, duplicate: false, error: stored.error, status: "failed" };
    }
  }
  updateJob(job.publicId, {
    status: "RECEIVING",
    description: note.slice(0, 2000),
    format: "SINGLE_IMAGE",
  });
  try {
    const branded = await brandControlJob(job.publicId, bytes);
    if (!branded.ok) throw new Error(branded.error);
  } catch {
    updateJob(job.publicId, { status: "FAILED", lastError: "process_failed" });
    upsertItem({
      batchKey: row.batch_key,
      filename: row.filename,
      sha256: row.sha256,
      actor: row.actor,
      status: "failed",
      publicId: job.publicId,
      relativePath: row.relative_path,
      error: "process_failed",
    });
    return { filename: row.filename, ok: false, publicId: job.publicId, duplicate: false, error: "process_failed", status: "failed" };
  }
  upsertItem({
    batchKey: row.batch_key,
    filename: row.filename,
    sha256: row.sha256,
    actor: row.actor,
    status: "ready",
    publicId: job.publicId,
    relativePath: row.relative_path,
  });
  return { filename: row.filename, ok: true, publicId: job.publicId, duplicate: false, error: "", status: "ready" };
}

function attachBatch(okIds: string[]) {
  if (!okIds.length) return "";
  const unique = [...new Set(okIds)];
  const existing = unique.map((id) => getJobByPublicId(id)?.photoBatchId).find(Boolean);
  const batchId = existing || nextBatchPublicId();
  const now = new Date().toISOString();
  const members = unique.map((publicId) => ({
    publicId,
    version: latestVersion(publicId)?.version || 1,
    telegramFileId: "",
    sha256: listAssets(publicId, "ORIGINAL", 0)[0]?.sha256 || "",
  }));
  const found = getHomesteadDb()
    .prepare("SELECT public_id FROM content_photo_batches WHERE public_id = ?")
    .get(batchId) as { public_id: string } | undefined;
  if (!found) {
    getHomesteadDb()
      .prepare(
        `INSERT INTO content_photo_batches
          (public_id, group_key, media_group_id, chat_id, member_json, status, created_at, updated_at)
         VALUES (?, ?, '', ?, ?, 'proposed', ?, ?)`,
      )
      .run(batchId, `control:${batchId}`, "control:admin-web", JSON.stringify(members), now, now);
  }
  for (const publicId of unique) updateJob(publicId, { photoBatchId: batchId });
  return batchId;
}

export async function ingestControlPhotos(input: {
  files: ControlIntakeFile[];
  note?: string;
  actor: string;
  batchKey?: string;
}) {
  if (input.files.length > MAX_CONTENT_PHOTOS) {
    return { ok: false as const, error: "too_many", items: [] as ControlIntakeItemResult[], batchId: "", batchKey: "" };
  }
  const batchKey = input.batchKey || `cu-${randomUUID()}`;
  const note = input.note || "";
  mkdirSync(intakeRoot(), { recursive: true });

  for (const file of input.files) {
    const sniffed = sniffImage(file.bytes, MAX_CONTENT_PHOTO_BYTES);
    if (!sniffed) {
      upsertItem({
        batchKey,
        filename: file.filename,
        sha256: sha256Of(file.bytes),
        actor: input.actor,
        status: "failed",
        error: file.bytes.length > MAX_CONTENT_PHOTO_BYTES ? "too_large" : "invalid_image",
      });
      continue;
    }
    const hash = sha256Of(file.bytes);
    const relativePath = writeStaged(batchKey, hash, sniffed.ext, file.bytes);
    upsertItem({
      batchKey,
      filename: file.filename,
      sha256: hash,
      actor: input.actor,
      status: "received",
      relativePath,
    });
  }

  const processed = await recoverControlIntake(batchKey, note, input.actor);
  return {
    ok: processed.items.some((item) => item.ok),
    batchId: processed.batchId,
    batchKey,
    items: processed.items,
    later: {
      video: "No hay almacenamiento ni publicador de video/reels.",
      carousel: "El publicador no envía carruseles. Cada archivo es una pieza HC- independiente.",
    },
  };
}

function claimControlIntakeItem(id: number, staleMs = 15 * 60 * 1000) {
  const now = new Date().toISOString();
  const stale = new Date(Date.now() - staleMs).toISOString();
  const result = getHomesteadDb()
    .prepare(
      `UPDATE control_intake_items
       SET status = 'processing', updated_at = ?
       WHERE id = ? AND (
         status = 'received'
         OR (status = 'processing' AND updated_at <= ?)
       )`,
    )
    .run(now, id, stale);
  return result.changes === 1;
}

export async function recoverControlIntake(batchKey?: string, note = "", actor = "admin-web") {
  const clauses = ["status IN ('received','processing')"];
  const params: string[] = [];
  if (batchKey) {
    clauses.push("batch_key = ?");
    params.push(batchKey);
  }
  const rows = getHomesteadDb()
    .prepare(
      `SELECT id, filename, sha256, actor, batch_key, relative_path, public_id, status
       FROM control_intake_items WHERE ${clauses.join(" AND ")} ORDER BY id ASC`,
    )
    .all(...params) as Array<{
    id: number;
    filename: string;
    sha256: string;
    actor: string;
    batch_key: string;
    relative_path: string;
    public_id: string;
    status: string;
  }>;
  const items: ControlIntakeItemResult[] = [];
  const okIds: string[] = [];
  for (const row of rows) {
    if (!claimControlIntakeItem(row.id)) continue;
    const result = await processReceivedItem(row, note);
    items.push(result);
    if (result.ok && result.publicId) okIds.push(result.publicId);
  }
  if (batchKey) {
    const ready = getHomesteadDb()
      .prepare(
        `SELECT filename, public_id, status, error FROM control_intake_items WHERE batch_key = ? ORDER BY id ASC`,
      )
      .all(batchKey) as Array<{ filename: string; public_id: string; status: string; error: string }>;
    const mapped = ready.map((row) => ({
      filename: row.filename,
      ok: row.status === "ready" || row.status === "duplicate",
      publicId: row.public_id,
      duplicate: row.status === "duplicate",
      error: row.error,
      status: row.status,
    }));
    const ids = mapped.filter((item) => item.ok && item.publicId).map((item) => item.publicId);
    return { items: mapped, batchId: attachBatch(ids), recovered: rows.length };
  }
  return { items, batchId: attachBatch(okIds), recovered: rows.length };
}

export function listControlIntake(batchKey: string) {
  return getHomesteadDb()
    .prepare(
      `SELECT filename, sha256, status, public_id, error, updated_at FROM control_intake_items
       WHERE batch_key = ? ORDER BY id ASC`,
    )
    .all(batchKey) as Array<{
    filename: string;
    sha256: string;
    status: string;
    public_id: string;
    error: string;
    updated_at: string;
  }>;
}

export async function recoverControlJob(publicId: string) {
  const job = getJobByPublicId(publicId);
  if (!job) return { ok: false as const, error: "missing" as const };
  const original = listAssets(publicId, "ORIGINAL", 0)[0];
  if (!original) return { ok: false as const, error: "no_original" as const };
  const { readAssetBytes } = await import("@/lib/content-catalog");
  const bytes = readAssetBytes(original);
  if (!bytes) return { ok: false as const, error: "missing_file" as const };
  return brandControlJob(publicId, bytes);
}

export function controlIntakeFingerprint(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}
