import { createHash, randomUUID } from "crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { dirname, join, resolve } from "path";
import {
  createContentJob,
  findOriginalBySha256,
  getJobByPublicId,
  latestVersion,
  listAssets,
  listPublicationsForJob,
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
import { isControlIsolated, awaitSimulatedReprocessHold } from "@/lib/control-isolation";
import { rewriteCopyOnly } from "@/lib/content-openai";
import { applyContentEditAtomic, assertContentJobEditable, assertExpectedContentVersion } from "@/lib/content-edit-guard";
import { validatePublishImage } from "@/lib/content-media-url";
import { listOrderedBrandedFeeds } from "@/lib/content-multi-photo";
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

/** Safe baseline when the copy generator is unavailable — never the operator note verbatim. */
function templateCopyBaseline(publicId: string) {
  return {
    serviceGuess: "servicio del hogar",
    ratings: [{ index: 1, label: "PRIMARY" as const, notes: "Plantilla local; requiere revisión humana." }],
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

/**
 * Builds Control captions via the project copy generator (`rewriteCopyOnly`).
 * Operator note is orientation only — never published as the caption body.
 * Template/isolated fallback is labeled and requires review.
 */
async function controlCopyFromContext(publicId: string, note: string) {
  const context = sanitizeAiContext(note);
  const baseline = templateCopyBaseline(publicId);
  try {
    const rewritten = await rewriteCopyOnly({
      publicId,
      description: context || "(sin nota de contexto)",
      previousCopy: baseline.copy.full,
      instruction:
        "Usa la nota solo como orientación de tono/hecho. No copies las instrucciones del operador literalmente en el caption. No inventes precios, ubicaciones ni resultados no mencionados.",
    });
    // Isolated transport returns local fallback copy; treat as review-required.
    const usedFallback = isControlIsolated();
    return {
      serviceGuess: baseline.serviceGuess,
      ratings: baseline.ratings,
      privacy: baseline.privacy,
      copy: {
        full: rewritten.full,
        commercial: rewritten.full,
        warm: rewritten.full,
        educational: rewritten.full,
        cta: rewritten.cta,
        hashtags: rewritten.hashtags,
      },
      usedFallback: usedFallback as boolean,
      needsReview: usedFallback,
      prompt: usedFallback ? "rewriteCopyOnly:isolated-fallback" : "rewriteCopyOnly",
    };
  } catch {
    return {
      ...baseline,
      usedFallback: true as const,
      needsReview: true as const,
      prompt: "control-template-fallback",
    };
  }
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
    const copy = await controlCopyFromContext(publicId, note);
    if (!latestVersion(publicId)) {
      saveVersion({
        job,
        version: 1,
        kind: "full",
        copy: copy.copy.full,
        cta: copy.copy.cta,
        hashtags: copy.copy.hashtags.join(" "),
        prompt: copy.prompt,
        privacyNote: copy.privacy.warning || (copy.needsReview ? "needs_review:template_fallback" : ""),
      });
    }
    updateJob(publicId, {
      status: "AWAITING_APPROVAL",
      description: note.slice(0, 2000),
      selectedCaption: copy.copy.full,
      captionsJson: JSON.stringify({
        ...copy.copy,
        usedFallback: copy.usedFallback,
        needsReview: copy.needsReview,
        prompt: copy.prompt,
      }),
      lastError: null,
    });
    recordContentEvent(publicId, "CONTENT_READY", copy.usedFallback ? "control-intake-fallback" : "control-intake");
  }
  return { ok: true as const, assetId: asset?.id || 0 };
}

/** Index stamped in original-NNN / branded-vX-NNN filenames. */
function assetIndexFromFilename(filename: string): number | null {
  const branded = filename.match(/branded-v\d+-(\d+)/i);
  if (branded) return Number(branded[1]);
  const original = filename.match(/original-(\d+)/i);
  if (original) return Number(original[1]);
  return null;
}

/**
 * Map current selection (mediaOrderJson branded ids, in order) → ORIGINAL assets.
 * Removed slides are absent from mediaOrderJson and must not be reprocessed.
 */
function resolveSelectedOriginals(publicId: string, mediaOrderJson: string) {
  const originals = listAssets(publicId, "ORIGINAL", 0);
  const byIndex = new Map<number, (typeof originals)[number]>();
  for (const o of originals) {
    const idx = assetIndexFromFilename(o.storedFilename);
    if (idx != null) byIndex.set(idx, o);
  }
  const orderedBranded = listOrderedBrandedFeeds(
    publicId,
    latestVersion(publicId)?.version || 0,
    mediaOrderJson,
  );
  const selected: Array<{ original: (typeof originals)[number]; index: number; previousBrandedId: number }> = [];
  const seenOrig = new Set<number>();
  for (const branded of orderedBranded) {
    const idx = assetIndexFromFilename(branded.storedFilename);
    if (idx == null) continue;
    const original = byIndex.get(idx);
    if (!original || seenOrig.has(original.id)) continue;
    seenOrig.add(original.id);
    selected.push({ original, index: idx, previousBrandedId: branded.id });
  }
  return selected;
}

function claimReprocessOwner(publicId: string, expectedVersion: number, claimToken: string) {
  const now = new Date().toISOString();
  const result = getHomesteadDb()
    .prepare(
      `UPDATE content_jobs
       SET status = 'PROCESSING',
           approved_version = NULL,
           last_error = NULL,
           pending_input = ?,
           updated_at = ?
       WHERE public_id = ?
         AND status NOT IN ('PUBLISHING', 'PUBLISHED', 'SIMULATED')
         AND (
           SELECT COALESCE(MAX(version), 0) FROM content_versions WHERE public_id = ?
         ) = ?`,
    )
    .run(claimToken, now, publicId, publicId, expectedVersion);
  return result.changes === 1;
}

/** Clear our claim marker only — never rewrite status/caption/order/approval left by others. */
function clearReprocessClaimIfOwner(publicId: string, claimToken: string) {
  const now = new Date().toISOString();
  getHomesteadDb()
    .prepare(
      `UPDATE content_jobs
       SET pending_input = '',
           updated_at = ?
       WHERE public_id = ? AND pending_input = ?`,
    )
    .run(now, publicId, claimToken);
}

function stillOwnsReprocess(publicId: string, claimToken: string) {
  const job = getJobByPublicId(publicId);
  return Boolean(job && job.pendingInput === claimToken);
}

/** Re-brand only CURRENTLY SELECTED originals (mediaOrderJson order). Never revive removed slides. */
export async function reprocessControlBrand(publicId: string, expectedVersion?: number) {
  const job = getJobByPublicId(publicId);
  if (!job) return { ok: false as const, error: "missing" as const };
  const before = assertContentJobEditable(publicId);
  if (!before.ok) return { ok: false as const, error: before.error };
  const expected = expectedVersion ?? before.version;
  const gate = assertExpectedContentVersion(publicId, expected);
  if (!gate.ok) return { ok: false as const, error: gate.error, current: gate.current };

  const selected = resolveSelectedOriginals(publicId, job.mediaOrderJson || "");
  if (!selected.length) return { ok: false as const, error: "original_missing" as const };

  const claimToken = `reprocess:${randomUUID()}`;
  if (!claimReprocessOwner(publicId, expected, claimToken)) {
    return { ok: false as const, error: "conflict_during_regen" as const, cause: "claim_lost" as const };
  }

  const conflictNoMutate = (cause: string, current?: number) => {
    // Drop our claim if we still own it; never restore/overwrite foreign status or selection.
    clearReprocessClaimIfOwner(publicId, claimToken);
    return { ok: false as const, error: "conflict_during_regen" as const, cause, current };
  };

  const failOwned = (error: string) => {
    if (!stillOwnsReprocess(publicId, claimToken)) {
      return { ok: false as const, error: "conflict_during_regen" as const, cause: "claim_lost" as const };
    }
    updateJob(publicId, { status: "FAILED", lastError: error, pendingInput: "" });
    return { ok: false as const, error: error as "original_unreadable" | "brand_store_failed" | "process_failed" };
  };

  try {
    // Pause point for concurrency tests (isolated only).
    await awaitSimulatedReprocessHold();

    if (!stillOwnsReprocess(publicId, claimToken)) {
      return { ok: false as const, error: "conflict_during_regen" as const, cause: "claim_lost" as const };
    }
    const afterHoldVer = latestVersion(publicId)?.version || 0;
    if (afterHoldVer !== expected) {
      return conflictNoMutate("stale_version", afterHoldVer);
    }

    const nextVersion = expected + 1;
    const newFeedIds: number[] = [];
    const widths: number[] = [];
    const heights: number[] = [];
    const batchTag = randomUUID().slice(0, 8);

    for (const item of selected) {
      if (!stillOwnsReprocess(publicId, claimToken)) {
        return { ok: false as const, error: "conflict_during_regen" as const, cause: "claim_lost" as const };
      }
      const bytes = readAssetBytes(item.original);
      if (!bytes) return failOwned("original_unreadable");
      const jpeg = await toJpeg(bytes);
      const set = await brandedSocialSet(jpeg);
      const valid = validatePublishImage({
        bytes: set.feed.bytes,
        mime: "image/jpeg",
        width: set.feed.width,
        height: set.feed.height,
      });
      if (!valid.ok) {
        if (!stillOwnsReprocess(publicId, claimToken)) {
          return { ok: false as const, error: "conflict_during_regen" as const, cause: "claim_lost" as const };
        }
        updateJob(publicId, { status: "FAILED", lastError: valid.cause, pendingInput: "" });
        return { ok: false as const, error: valid.cause };
      }

      const index = item.index;
      const role = index === 1 ? "PRIMARY" : "SECONDARY";
      // Unique filename — never overwrite historical branded files. Index keeps original→result link.
      const filename = `branded-v${nextVersion}-${String(index).padStart(3, "0")}-${batchTag}-feed.jpg`;
      storeDerivedAsset({
        job,
        version: nextVersion,
        assetType: "BRANDED",
        role,
        bytes: set.feed.bytes,
        mime: "image/jpeg",
        ext: "jpg",
        folder: "branded",
        filename,
        width: set.feed.width,
        height: set.feed.height,
      });
      const created = listAssets(publicId, "BRANDED", nextVersion).find((a) => a.storedFilename === filename);
      if (!created) return failOwned("brand_store_failed");
      newFeedIds.push(created.id);
      widths.push(set.feed.width);
      heights.push(set.feed.height);
    }

    // Re-check after brand work — concurrent edit/publish wins; leave their state intact.
    if (!stillOwnsReprocess(publicId, claimToken)) {
      return { ok: false as const, error: "conflict_during_regen" as const, cause: "claim_lost" as const };
    }
    const afterVer = latestVersion(publicId)?.version || 0;
    if (afterVer !== expected) {
      return conflictNoMutate("stale_version", afterVer);
    }
    const live = listPublicationsForJob(publicId).some((p) => p.status === "PUBLISHED" && !p.dry_run);
    if (live || getJobByPublicId(publicId)?.status === "PUBLISHING") {
      return conflictNoMutate("already_published");
    }

    const mediaOrderJson = JSON.stringify(newFeedIds);
    const applied = applyContentEditAtomic({
      publicId,
      expectedVersion: expected,
      kind: "image",
      actor: "reprocess-brand",
      event: "CONTENT_REPROCESSED",
      copy: getJobByPublicId(publicId)?.selectedCaption || "",
      mediaOrderJson,
      jobPatch: {
        status: "AWAITING_APPROVAL",
        lastError: null,
        approvedVersion: null,
        pendingInput: "",
        mediaOrderJson,
        format: newFeedIds.length >= 2 ? "CAROUSEL" : "SINGLE_IMAGE",
        publishMode: newFeedIds.length >= 2 ? "album" : getJobByPublicId(publicId)?.publishMode || "separate",
      },
    });
    if (!applied.ok) {
      return conflictNoMutate(applied.error, applied.current);
    }
    return {
      ok: true as const,
      width: widths[0] || 0,
      height: heights[0] || 0,
      feedIds: newFeedIds,
      mediaOrderJson,
      invalidatedApproval: true as const,
      version: applied.version,
    };
  } catch {
    if (!stillOwnsReprocess(publicId, claimToken)) {
      return { ok: false as const, error: "conflict_during_regen" as const, cause: "claim_lost" as const };
    }
    updateJob(publicId, { status: "FAILED", lastError: "process_failed", pendingInput: "" });
    return { ok: false as const, error: "process_failed" as const };
  }
}

/** Rebuild caption via rewriteCopyOnly. Re-validates revision after provider wait. */
export async function regenerateControlCopy(
  publicId: string,
  noteOverride?: string,
  expectedVersion?: number,
) {
  const job = getJobByPublicId(publicId);
  if (!job) return { ok: false as const, error: "missing" as const };
  const before = assertContentJobEditable(publicId);
  if (!before.ok) return { ok: false as const, error: before.error };
  const expected = expectedVersion ?? before.version;
  const gate = assertExpectedContentVersion(publicId, expected);
  if (!gate.ok) return { ok: false as const, error: gate.error, current: gate.current };

  const note = (noteOverride ?? job.description ?? "").trim();
  const copy = await controlCopyFromContext(publicId, note);

  // Re-validate after provider latency — concurrent edit/approve/publish wins.
  const afterEditable = assertContentJobEditable(publicId);
  if (!afterEditable.ok) {
    return { ok: false as const, error: "conflict_during_regen" as const, cause: afterEditable.error };
  }
  const afterGate = assertExpectedContentVersion(publicId, expected);
  if (!afterGate.ok) {
    return { ok: false as const, error: "conflict_during_regen" as const, cause: afterGate.error, current: afterGate.current };
  }

  const nextStatus =
    afterEditable.job.status === "APPROVED" ||
    afterEditable.job.status === "SCHEDULED" ||
    afterEditable.job.status === "NEEDS_REVIEW"
      ? ("AWAITING_APPROVAL" as const)
      : afterEditable.job.status;

  const applied = applyContentEditAtomic({
    publicId,
    expectedVersion: expected,
    kind: "copy",
    actor: "regenerate-copy",
    event: copy.usedFallback ? "CONTENT_COPY_FALLBACK" : "CONTENT_COPY_REGENERATED",
    copy: copy.copy.full,
    cta: copy.copy.cta,
    hashtags: copy.copy.hashtags.join(" "),
    prompt: copy.prompt,
    privacyNote: copy.needsReview ? "needs_review:template_or_isolated_fallback" : "",
    mediaOrderJson: afterEditable.job.mediaOrderJson || "",
    jobPatch: {
      description: note.slice(0, 2000),
      selectedCaption: copy.copy.full,
      captionsJson: JSON.stringify({
        ...copy.copy,
        usedFallback: copy.usedFallback,
        needsReview: copy.needsReview,
        prompt: copy.prompt,
      }),
      approvedVersion: null,
      status: nextStatus,
      lastError: null,
    },
  });
  if (!applied.ok) {
    return { ok: false as const, error: "conflict_during_regen" as const, cause: applied.error, current: applied.current };
  }
  return {
    ok: true as const,
    copy: copy.copy.full,
    invalidatedApproval: true as const,
    usedFallback: copy.usedFallback,
    needsReview: copy.needsReview,
    version: applied.version,
    mediaOrderJson: applied.job.mediaOrderJson,
  };
}

/** Persist operator-edited caption with atomic revision bump. */
export function saveControlCopy(publicId: string, copyText: string, expectedVersion: number) {
  const job = getJobByPublicId(publicId);
  if (!job) return { ok: false as const, error: "missing" as const };
  const text = copyText.trim().slice(0, 2200);
  if (!text) return { ok: false as const, error: "empty_copy" as const };
  const nextStatus =
    job.status === "APPROVED" || job.status === "SCHEDULED" || job.status === "NEEDS_REVIEW"
      ? ("AWAITING_APPROVAL" as const)
      : job.status;
  const applied = applyContentEditAtomic({
    publicId,
    expectedVersion,
    kind: "copy",
    actor: "save-copy",
    event: "CONTENT_COPY_SAVED",
    copy: text,
    mediaOrderJson: job.mediaOrderJson || "",
    jobPatch: {
      selectedCaption: text,
      approvedVersion: null,
      status: nextStatus,
    },
  });
  if (!applied.ok) {
    return { ok: false as const, error: applied.error, current: applied.current };
  }
  return {
    ok: true as const,
    copy: text,
    invalidatedApproval: true as const,
    version: applied.version,
  };
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
  const copy = await controlCopyFromContext(job.publicId, input.note);
  if (!latestVersion(job.publicId)) {
    saveVersion({
      job,
      version: 1,
      kind: "full",
      copy: copy.copy.full,
      cta: copy.copy.cta,
      hashtags: copy.copy.hashtags.join(" "),
      prompt: copy.prompt || (isControlIsolated() ? "control-isolated-album" : "control-local-album"),
      privacyNote: copy.privacy.warning || (copy.needsReview ? "needs_review:template_or_isolated_fallback" : ""),
    });
  }
  updateJob(job.publicId, {
    status: "AWAITING_APPROVAL",
    description: input.note.slice(0, 2000),
    format: "CAROUSEL",
    publishMode: "album",
    mediaOrderJson: JSON.stringify(order),
    selectedCaption: copy.copy.full,
    captionsJson: JSON.stringify({
      ...copy.copy,
      usedFallback: copy.usedFallback,
      needsReview: copy.needsReview,
      prompt: copy.prompt,
    }),
    lastError: null,
  });
  recordContentEvent(job.publicId, "CONTENT_READY", copy.usedFallback ? "control-intake-album-fallback" : "control-intake-album");
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
