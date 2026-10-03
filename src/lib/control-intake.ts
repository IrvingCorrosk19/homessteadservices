import { createHash, randomUUID } from "crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { dirname, join, resolve } from "path";
import {
  createContentJob,
  findOriginalBySha256,
  getJobByPublicId,
  latestVersion,
  listAssets,
  overwriteBrandedFeed,
  readAssetBytes,
  recordContentEvent,
  saveVersion,
  sha256Of,
  storeDerivedAsset,
  storeOriginal,
  updateJob,
} from "@/lib/content-catalog";
import { getHomesteadDb, homesteadDataDir } from "@/lib/service-requests";
import { nextBatchPublicId } from "@/lib/content-photo-batch";
import { brandedSocialSet, metadataOf, toJpeg } from "@/lib/content-images";
import { isControlIsolated, isolatedCopyFallback } from "@/lib/control-isolation";
import { validatePublishImage } from "@/lib/content-media-url";
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

function sanitizeAiContext(note: string) {
  return note.replace(/\s+/g, " ").trim().slice(0, 800);
}

/**
 * Text for Control pieces. Uses the operator note as orientation only —
 * does not invent work, locations, prices, or features beyond that note.
 * Control intake does not run vision models on the photos.
 */
function controlCopyFromContext(publicId: string, note: string) {
  const context = sanitizeAiContext(note);
  const isolated = isControlIsolated();
  if (!context) {
    if (isolated) return isolatedCopyFallback(publicId);
    return {
      serviceGuess: "servicio del hogar",
      ratings: [{ index: 1, label: "PRIMARY" as const, notes: "Imagen recibida." }],
      privacy: { people: false, plates: false, documents: false, warning: "" },
      copy: {
        full: `Trabajo documentado por Homestead. Folio ${publicId}. Revisa la foto y el texto antes de publicar.`,
        commercial: `Homestead Services. Folio ${publicId}. Confirma el texto antes de publicar.`,
        warm: `Así llegó este trabajo a Homestead. Folio ${publicId}.`,
        educational: `Mantenimiento y reparaciones en Panamá. Folio ${publicId}.`,
        cta: "Agenda en homestead.lat",
        hashtags: ["#HomesteadServices", "#Panama"],
      },
    };
  }
  const body = context;
  return {
    serviceGuess: "servicio del hogar",
    ratings: [{ index: 1, label: "PRIMARY" as const, notes: "Texto orientado por contexto del operador (sin visión de IA)." }],
    privacy: { people: false, plates: false, documents: false, warning: "" },
    copy: {
      full: `${body}\n\nFolio ${publicId}. Homestead Services — agenda en homestead.lat`,
      commercial: `${body}\n\nHomestead Services. Folio ${publicId}.`,
      warm: `${body}\n\nFolio ${publicId}.`,
      educational: `${body}\n\nMantenimiento y reparaciones en Panamá. Folio ${publicId}.`,
      cta: "Agenda en homestead.lat",
      hashtags: ["#HomesteadServices", "#Panama"],
    },
  };
}

function controlCopyFallback(publicId: string, note = "") {
  return controlCopyFromContext(publicId, note);
}

/**
 * Brands a Control photo for Meta feed publish:
 * cover-crop to 1080×1350 (4:5) + watermark. Plain enhance-only is not enough —
 * tall phone photos (e.g. 1200×1600 = 0.75) fail Meta aspect validation.
 */
export async function brandControlJob(
  publicId: string,
  bytes: Buffer,
  options?: { index?: number; skipCopy?: boolean; role?: "PRIMARY" | "SECONDARY"; note?: string },
) {
  const job = getJobByPublicId(publicId);
  if (!job) return { ok: false as const, error: "missing", assetId: 0 };
  const jpeg = await toJpeg(bytes);
  let branded: Buffer;
  let width: number | null = null;
  let height: number | null = null;
  try {
    const set = await brandedSocialSet(jpeg);
    branded = set.feed.bytes;
    width = set.feed.width;
    height = set.feed.height;
  } catch (err) {
    const message = err instanceof Error ? err.message : "process_failed";
    return { ok: false as const, error: message.slice(0, 120) || "process_failed", assetId: 0 };
  }
  const meta = width && height ? { width, height } : await metadataOf(branded);
  const valid = validatePublishImage({
    bytes: branded,
    mime: "image/jpeg",
    width: meta.width,
    height: meta.height,
  });
  if (!valid.ok) {
    return { ok: false as const, error: valid.cause, assetId: 0 };
  }
  const version = latestVersion(publicId)?.version || 1;
  const index = options?.index ?? 1;
  const role = options?.role || (index === 1 ? "PRIMARY" : "SECONDARY");
  storeDerivedAsset({
    job,
    version,
    assetType: "BRANDED",
    role,
    bytes: branded,
    mime: "image/jpeg",
    ext: "jpg",
    folder: "branded",
    filename: `branded-v${version}-${String(index).padStart(3, "0")}-feed.jpg`,
    width: meta.width,
    height: meta.height,
  });
  const asset = listAssets(publicId, "BRANDED", version).find((a) =>
    a.storedFilename.includes(`-${String(index).padStart(3, "0")}-feed`),
  );
  if (!options?.skipCopy) {
    const note = options?.note || job.description || "";
    const copy = controlCopyFallback(publicId, note);
    if (!latestVersion(publicId)) {
      saveVersion({
        job,
        version: 1,
        kind: "full",
        copy: copy.copy.full,
        cta: copy.copy.cta,
        hashtags: copy.copy.hashtags.join(" "),
        prompt: isControlIsolated() ? "control-isolated" : "control-local",
        privacyNote: copy.privacy.warning,
      });
    }
    updateJob(publicId, {
      status: "AWAITING_APPROVAL",
      description: note.slice(0, 2000),
      selectedCaption: copy.copy.full,
      captionsJson: JSON.stringify(copy.copy),
      lastError: null,
    });
    recordContentEvent(publicId, "CONTENT_READY", "control-intake");
  }
  return { ok: true as const, assetId: asset?.id || 0 };
}

/** Re-brand from ORIGINAL for pieces processed without feed crop (e.g. aspect 0.75). */
export async function reprocessControlBrand(publicId: string) {
  const job = getJobByPublicId(publicId);
  if (!job) return { ok: false as const, error: "missing" as const };
  const original = listAssets(publicId, "ORIGINAL", 0)[0];
  if (!original) return { ok: false as const, error: "original_missing" as const };
  const bytes = readAssetBytes(original);
  if (!bytes) return { ok: false as const, error: "original_unreadable" as const };

  updateJob(publicId, { status: "PROCESSING", lastError: null, approvedVersion: null });
  try {
    const jpeg = await toJpeg(bytes);
    const set = await brandedSocialSet(jpeg);
    const valid = validatePublishImage({
      bytes: set.feed.bytes,
      mime: "image/jpeg",
      width: set.feed.width,
      height: set.feed.height,
    });
    if (!valid.ok) {
      updateJob(publicId, { status: "FAILED", lastError: valid.cause });
      return { ok: false as const, error: valid.cause };
    }
    const existing = listAssets(publicId, "BRANDED").filter((a) => a.storedFilename.includes("-feed")).at(-1);
    if (existing) {
      overwriteBrandedFeed(publicId, set.feed.bytes, set.feed.width, set.feed.height);
    } else {
      const branded = await brandControlJob(publicId, bytes, { skipCopy: true, index: 1 });
      if (!branded.ok) {
        updateJob(publicId, { status: "FAILED", lastError: branded.error });
        return { ok: false as const, error: branded.error };
      }
    }
    updateJob(publicId, {
      status: "AWAITING_APPROVAL",
      lastError: null,
      approvedVersion: null,
    });
    recordContentEvent(publicId, "CONTENT_READY", "reprocess-brand");
    return {
      ok: true as const,
      width: set.feed.width,
      height: set.feed.height,
      invalidatedApproval: true as const,
    };
  } catch {
    updateJob(publicId, { status: "FAILED", lastError: "process_failed" });
    return { ok: false as const, error: "process_failed" as const };
  }
}

/** Rebuild caption from stored AI context (job.description). Invalidates approval. */
export function regenerateControlCopy(publicId: string, noteOverride?: string) {
  const job = getJobByPublicId(publicId);
  if (!job) return { ok: false as const, error: "missing" as const };
  const note = (noteOverride ?? job.description ?? "").trim();
  const copy = controlCopyFromContext(publicId, note);
  const nextStatus =
    job.status === "APPROVED" || job.status === "SCHEDULED" || job.status === "NEEDS_REVIEW"
      ? ("AWAITING_APPROVAL" as const)
      : job.status;
  updateJob(publicId, {
    description: note.slice(0, 2000),
    selectedCaption: copy.copy.full,
    captionsJson: JSON.stringify(copy.copy),
    approvedVersion: null,
    status: nextStatus,
    lastError: null,
  });
  recordContentEvent(publicId, "CONTENT_READY", "regenerate-copy");
  return { ok: true as const, copy: copy.copy.full, invalidatedApproval: true as const };
}

/** Persist operator-edited caption. Invalidates approval. */
export function saveControlCopy(publicId: string, copyText: string) {
  const job = getJobByPublicId(publicId);
  if (!job) return { ok: false as const, error: "missing" as const };
  const text = copyText.trim().slice(0, 2200);
  if (!text) return { ok: false as const, error: "empty_copy" as const };
  const nextStatus =
    job.status === "APPROVED" || job.status === "SCHEDULED" || job.status === "NEEDS_REVIEW"
      ? ("AWAITING_APPROVAL" as const)
      : job.status;
  updateJob(publicId, {
    selectedCaption: text,
    approvedVersion: null,
    status: nextStatus,
  });
  recordContentEvent(publicId, "CONTENT_READY", "save-copy");
  return { ok: true as const, copy: text, invalidatedApproval: true as const };
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
    const originalMeta = await metadataOf(bytes).catch(() => ({ width: null, height: null }));
    const stored = storeOriginal({
      job,
      bytes,
      mime: sniffed.mime,
      ext: sniffed.ext,
      width: originalMeta.width,
      height: originalMeta.height,
    });
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
    status: "PROCESSING",
    description: note.slice(0, 2000),
    format: "SINGLE_IMAGE",
  });
  try {
    const branded = await brandControlJob(job.publicId, bytes, { note });
    if (!branded.ok) throw new Error(branded.error);
  } catch (error) {
    const cause = error instanceof Error && error.message ? error.message : "process_failed";
    updateJob(job.publicId, { status: "FAILED", lastError: cause });
    upsertItem({
      batchKey: row.batch_key,
      filename: row.filename,
      sha256: row.sha256,
      actor: row.actor,
      status: "failed",
      publicId: job.publicId,
      relativePath: row.relative_path,
      error: cause,
    });
    return { filename: row.filename, ok: false, publicId: job.publicId, duplicate: false, error: cause, status: "failed" };
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
  /** separate = one HC per photo (default); album = one CAROUSEL HC with ordered photos */
  publishMode?: "separate" | "album";
}) {
  if (input.files.length > MAX_CONTENT_PHOTOS) {
    return { ok: false as const, error: "too_many", items: [] as ControlIntakeItemResult[], batchId: "", batchKey: "", publicId: "" };
  }
  const mode = input.publishMode === "album" ? "album" : "separate";
  if (mode === "album" && input.files.length < 2) {
    return { ok: false as const, error: "album_needs_two", items: [] as ControlIntakeItemResult[], batchId: "", batchKey: "", publicId: "" };
  }
  const batchKey = input.batchKey || `cu-${randomUUID()}`;
  const note = input.note || "";
  mkdirSync(intakeRoot(), { recursive: true });

  if (mode === "album") {
    return ingestControlAlbum({ files: input.files, note, actor: input.actor, batchKey });
  }

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
    publicId: "",
    publishMode: "separate" as const,
    items: processed.items,
    later: {
      video: "No hay almacenamiento ni publicador de video/reels.",
      carousel: "Modo separado: cada archivo es una pieza HC- independiente. Usa publishMode=album para una publicación con varias fotos.",
    },
  };
}

function findAlbumPublicIdByBatchKey(batchKey: string) {
  const row = getHomesteadDb()
    .prepare(
      `SELECT public_id, status FROM control_intake_items
       WHERE batch_key = ? AND filename != '__album_claim__' AND public_id != ''
       ORDER BY id ASC LIMIT 1`,
    )
    .get(batchKey) as { public_id: string; status: string } | undefined;
  return row || null;
}

function findReadyAlbumByBatchKey(batchKey: string) {
  const row = findAlbumPublicIdByBatchKey(batchKey);
  if (!row?.public_id) return null;
  const job = getJobByPublicId(row.public_id);
  if (!job) return null;
  if (job.publishMode !== "album" && job.format !== "CAROUSEL") return null;
  if (job.status === "FAILED" || job.status === "DRAFT" || job.status === "RECEIVING" || job.status === "PROCESSING") {
    return null;
  }
  return job;
}

function claimAlbumBatchKey(batchKey: string, actor: string): { ok: true } | { ok: false; error: string; publicId?: string } {
  const db = getHomesteadDb();
  return db.transaction(() => {
    const ready = findReadyAlbumByBatchKey(batchKey);
    if (ready) {
      return { ok: false as const, error: "album_replay", publicId: ready.publicId };
    }
    const claim = db
      .prepare(
        `SELECT status, public_id FROM control_intake_items
         WHERE batch_key = ? AND filename = '__album_claim__' LIMIT 1`,
      )
      .get(batchKey) as { status: string; public_id: string } | undefined;
    if (claim && (claim.status === "processing" || claim.status === "ready")) {
      if (claim.public_id) {
        const job = getJobByPublicId(claim.public_id);
        if (job && job.status !== "FAILED") {
          return { ok: false as const, error: "album_inflight", publicId: claim.public_id };
        }
      } else {
        return { ok: false as const, error: "album_inflight" };
      }
    }
    const now = new Date().toISOString();
    if (claim) {
      db.prepare(
        `UPDATE control_intake_items SET status = 'processing', public_id = '', error = '', updated_at = ? WHERE batch_key = ? AND filename = '__album_claim__'`,
      ).run(now, batchKey);
    } else {
      db.prepare(
        `INSERT INTO control_intake_items
          (batch_key, filename, sha256, actor, status, public_id, relative_path, error, created_at, updated_at)
         VALUES (?, '__album_claim__', ?, ?, 'processing', '', '', '', ?, ?)`,
      ).run(batchKey, sha256Of(Buffer.from(`album:${batchKey}`)), actor, now, now);
    }
    return { ok: true as const };
  })();
}

async function ingestControlAlbum(input: {
  files: ControlIntakeFile[];
  note: string;
  actor: string;
  batchKey: string;
}) {
  // Same batchKey + already-ready album = replay (lost response / retry), not a new folio.
  // A new intentional album must use a new batchKey even if photo bytes match.
  const existingAlbum = findReadyAlbumByBatchKey(input.batchKey);
  if (existingAlbum) {
    const prior = listControlIntake(input.batchKey).filter((row) => row.filename !== "__album_claim__");
    return {
      ok: true as const,
      batchId: existingAlbum.photoBatchId || "",
      batchKey: input.batchKey,
      publicId: existingAlbum.publicId,
      publishMode: "album" as const,
      replayed: true as const,
      items: prior.map((row) => ({
        filename: row.filename,
        ok: row.status === "ready" || row.status === "duplicate",
        publicId: row.public_id || existingAlbum.publicId,
        duplicate: row.status === "duplicate",
        error: row.error || "",
        status: row.status,
      })),
      later: {
        video: "No hay almacenamiento ni publicador de video/reels.",
        carousel: "Álbum: Instagram usa carrusel oficial; Facebook usa multi-foto orgánica (attached_media).",
      },
    };
  }

  const claim = claimAlbumBatchKey(input.batchKey, input.actor);
  if (!claim.ok) {
    if (claim.error === "album_replay" && claim.publicId) {
      const job = getJobByPublicId(claim.publicId);
      if (job) {
        const prior = listControlIntake(input.batchKey).filter((row) => row.filename !== "__album_claim__");
        return {
          ok: true as const,
          batchId: job.photoBatchId || "",
          batchKey: input.batchKey,
          publicId: job.publicId,
          publishMode: "album" as const,
          replayed: true as const,
          items: prior.map((row) => ({
            filename: row.filename,
            ok: row.status === "ready" || row.status === "duplicate",
            publicId: row.public_id || job.publicId,
            duplicate: row.status === "duplicate",
            error: row.error || "",
            status: row.status,
          })),
          later: {
            video: "No hay almacenamiento ni publicador de video/reels.",
            carousel: "Álbum: Instagram usa carrusel oficial; Facebook usa multi-foto orgánica (attached_media).",
          },
        };
      }
    }
    return {
      ok: false as const,
      error: claim.error,
      batchId: "",
      batchKey: input.batchKey,
      publicId: claim.publicId || "",
      publishMode: "album" as const,
      items: [] as ControlIntakeItemResult[],
    };
  }

  const job = createContentJob({ chatId: `control:${input.actor}`, userId: input.actor });
  getHomesteadDb()
    .prepare(
      `UPDATE control_intake_items SET public_id = ?, updated_at = ? WHERE batch_key = ? AND filename = '__album_claim__'`,
    )
    .run(job.publicId, new Date().toISOString(), input.batchKey);
  const items: ControlIntakeItemResult[] = [];
  const brandedIds: number[] = [];
  let index = 0;
  for (const file of input.files) {
    index += 1;
    const sniffed = sniffImage(file.bytes, MAX_CONTENT_PHOTO_BYTES);
    if (!sniffed) {
      const err = file.bytes.length > MAX_CONTENT_PHOTO_BYTES ? "too_large" : "invalid_image";
      upsertItem({
        batchKey: input.batchKey,
        filename: file.filename,
        sha256: sha256Of(file.bytes),
        actor: input.actor,
        status: "failed",
        publicId: job.publicId,
        error: err,
      });
      items.push({ filename: file.filename, ok: false, publicId: job.publicId, duplicate: false, error: err, status: "failed" });
      continue;
    }
    const hash = sha256Of(file.bytes);
    const relativePath = writeStaged(input.batchKey, hash, sniffed.ext, file.bytes);
    upsertItem({
      batchKey: input.batchKey,
      filename: file.filename,
      sha256: hash,
      actor: input.actor,
      status: "processing",
      publicId: job.publicId,
      relativePath,
    });
    const stored = storeOriginal({ job, bytes: file.bytes, mime: sniffed.mime, ext: sniffed.ext });
    if (!stored.ok) {
      upsertItem({
        batchKey: input.batchKey,
        filename: file.filename,
        sha256: hash,
        actor: input.actor,
        status: "failed",
        publicId: job.publicId,
        error: stored.error,
      });
      items.push({
        filename: file.filename,
        ok: false,
        publicId: job.publicId,
        duplicate: false,
        error: stored.error,
        status: "failed",
      });
      continue;
    }
    try {
      const branded = await brandControlJob(job.publicId, file.bytes, {
        index,
        skipCopy: true,
        role: index === 1 ? "PRIMARY" : "SECONDARY",
      });
      if (!branded.ok) throw new Error(branded.error);
      if (branded.assetId) brandedIds.push(branded.assetId);
      upsertItem({
        batchKey: input.batchKey,
        filename: file.filename,
        sha256: hash,
        actor: input.actor,
        status: "ready",
        publicId: job.publicId,
        relativePath,
      });
      items.push({
        filename: file.filename,
        ok: true,
        publicId: job.publicId,
        duplicate: Boolean(stored.duplicate),
        error: "",
        status: "ready",
      });
    } catch {
      upsertItem({
        batchKey: input.batchKey,
        filename: file.filename,
        sha256: hash,
        actor: input.actor,
        status: "failed",
        publicId: job.publicId,
        error: "process_failed",
      });
      items.push({
        filename: file.filename,
        ok: false,
        publicId: job.publicId,
        duplicate: false,
        error: "process_failed",
        status: "failed",
      });
    }
  }

  const okCount = items.filter((i) => i.ok).length;
  const failedAny = items.some((i) => !i.ok);
  if (failedAny || okCount !== input.files.length || okCount < 2) {
    updateJob(job.publicId, {
      status: "FAILED",
      lastError: failedAny ? "album_photo_not_ready" : "album_incomplete",
      format: "CAROUSEL",
      publishMode: "album",
    });
    return {
      ok: false as const,
      error: failedAny ? "album_photo_not_ready" : "album_incomplete",
      batchId: "",
      batchKey: input.batchKey,
      publicId: job.publicId,
      publishMode: "album" as const,
      items,
    };
  }

  // Resolve branded asset ids if storeDerivedAsset didn't return them reliably.
  const feeds = listAssets(job.publicId, "BRANDED", 1).filter((a) => a.storedFilename.includes("-feed"));
  const order = brandedIds.length ? brandedIds : feeds.map((a) => a.id);
  const copy = controlCopyFallback(job.publicId, input.note);
  if (!latestVersion(job.publicId)) {
    saveVersion({
      job,
      version: 1,
      kind: "full",
      copy: copy.copy.full,
      cta: copy.copy.cta,
      hashtags: copy.copy.hashtags.join(" "),
      prompt: isControlIsolated() ? "control-isolated-album" : "control-local-album",
      privacyNote: copy.privacy.warning,
    });
  }
  updateJob(job.publicId, {
    status: "AWAITING_APPROVAL",
    description: input.note.slice(0, 2000),
    format: "CAROUSEL",
    publishMode: "album",
    mediaOrderJson: JSON.stringify(order),
    selectedCaption: copy.copy.full,
    captionsJson: JSON.stringify(copy.copy),
    lastError: null,
  });
  recordContentEvent(job.publicId, "CONTENT_READY", "control-intake-album");
  getHomesteadDb()
    .prepare(
      `UPDATE control_intake_items SET status = 'ready', public_id = ?, updated_at = ? WHERE batch_key = ? AND filename = '__album_claim__'`,
    )
    .run(job.publicId, new Date().toISOString(), input.batchKey);
  return {
    ok: true as const,
    batchId: "",
    batchKey: input.batchKey,
    publicId: job.publicId,
    publishMode: "album" as const,
    items,
    later: {
      video: "No hay almacenamiento ni publicador de video/reels.",
      carousel: "Álbum: Instagram usa carrusel oficial; Facebook usa multi-foto orgánica (attached_media).",
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
