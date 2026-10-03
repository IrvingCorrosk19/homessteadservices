import {
  getContentSettings,
  getContentVersion,
  getJobByPublicId,
  latestVersion,
  listAllContentJobIds,
  listAssets,
  listContentEvents,
  listPublicationsForJob,
  recordContentEvent,
  tryApproveContentJob,
  tryRejectContentJob,
  setContentPaused,
  updateJob,
} from "@/lib/content-catalog";
import { getHomesteadDb } from "@/lib/service-requests";
import { assignStaggeredSlots, formatPanama, recommendPublishAt } from "@/lib/content-queue";
import { publishJob } from "@/lib/content-publish";
import { listOrderedBrandedFeeds, parseMediaOrderJson } from "@/lib/content-multi-photo";
import {
  getCampaignByPublicId,
  listAllCampaigns,
  listCampaignPieces,
} from "@/lib/campaign-store";
import { getPhotoBatch } from "@/lib/content-photo-batch";
import { createHash } from "crypto";
import { pauseCampaign, resumeCampaign } from "@/lib/campaign-engine";
import {
  controlDisplayLabel,
  deriveControlDisplayState,
  humanPublicationError,
  type ControlDisplayState,
  type PlatformPublicationView,
} from "@/lib/control-status";
import type { ContentStatus } from "@/lib/content-types";

export type ControlJobAction =
  | "approve"
  | "approve_and_schedule"
  | "reschedule"
  | "reject"
  | "publish_now"
  | "retry_platform"
  | "reprocess_media"
  | "regenerate_copy"
  | "save_copy"
  | "update_ai_context";

function assessPublishImage(publicId: string) {
  const feeds = listAssets(publicId, "BRANDED").filter((asset) => asset.storedFilename.includes("-feed"));
  const job = getJobByPublicId(publicId);
  const orderIds = job ? parseMediaOrderJson(job.mediaOrderJson) : [];
  const branded =
    (orderIds.length
      ? orderIds.map((id) => feeds.find((a) => a.id === id)).find(Boolean)
      : null) ||
    feeds[0] ||
    feeds.at(-1) ||
    null;
  const original = listAssets(publicId, "ORIGINAL", 0)[0];
  if (!branded) {
    return { ready: false as const, cause: "image_missing", branded: null, original };
  }
  const width = branded.width || 0;
  const height = branded.height || 0;
  if (width < 320 || height < 320) {
    return { ready: false as const, cause: "image_too_small", branded, original };
  }
  const ratio = width / height;
  if (ratio < 0.8 - 0.01 || ratio > 1.91 + 0.01) {
    return { ready: false as const, cause: "image_aspect_unsupported", branded, original };
  }
  return { ready: true as const, cause: "", branded, original };
}

const PENDING_RECEIPT_LEASE_MS = 5 * 60 * 1000;

function receiptHash(input: {
  key: string;
  publicId: string;
  action: string;
  actor: string;
  version: number;
  confirm?: boolean;
  copy?: string;
  note?: string;
}) {
  return createHash("sha256")
    .update(
      [
        input.key,
        input.publicId,
        input.action,
        input.actor,
        String(input.version),
        input.confirm ? "1" : "0",
        String(input.copy ?? ""),
        String(input.note ?? ""),
      ].join("|"),
    )
    .digest("hex");
}

type PendingReceiptMeta = {
  __pending: true;
  owner: string;
  leaseUntil: string;
  state: "active" | "abandoned" | "uncertain";
};

/** Mark expired active leases abandoned — never DELETE receipts by age alone. */
function reconcilePendingReceipts() {
  const now = Date.now();
  const rows = getHomesteadDb()
    .prepare(`SELECT idempotency_key, result_json FROM control_action_receipts WHERE result_json LIKE '%"__pending":true%'`)
    .all() as Array<{ idempotency_key: string; result_json: string }>;
  for (const row of rows) {
    try {
      const payload = JSON.parse(row.result_json) as PendingReceiptMeta;
      if (!payload?.__pending) continue;
      if (payload.state === "active" && new Date(payload.leaseUntil).getTime() <= now) {
        getHomesteadDb()
          .prepare(`UPDATE control_action_receipts SET result_json = ? WHERE idempotency_key = ?`)
          .run(
            JSON.stringify({ ...payload, state: "abandoned" as const }),
            row.idempotency_key,
          );
      }
    } catch {
      /* ignore corrupt */
    }
  }
}

function publicationsView(publicId: string): PlatformPublicationView[] {
  return listPublicationsForJob(publicId).map((row) => ({
    platform: row.platform,
    status: row.status,
    dryRun: row.dry_run === 1,
    error: row.error || "",
    permalink: row.permalink || "",
  }));
}

function readReceipt(key: string, hash: string) {
  if (!key) return null;
  const row = getHomesteadDb()
    .prepare("SELECT result_json, request_hash FROM control_action_receipts WHERE idempotency_key = ?")
    .get(key) as { result_json: string; request_hash?: string } | undefined;
  if (!row) return null;
  if (row.request_hash && row.request_hash !== hash) {
    return { conflict: true as const };
  }
  try {
    const payload = JSON.parse(row.result_json) as Record<string, unknown> & Partial<PendingReceiptMeta>;
    if (payload && payload.__pending === true) {
      if (payload.state === "abandoned") {
        return { abandoned: true as const, payload };
      }
      if (payload.state === "uncertain") {
        return { uncertain: true as const, payload };
      }
      return { inflight: true as const, owner: String(payload.owner || ""), leaseUntil: String(payload.leaseUntil || "") };
    }
    return { payload };
  } catch {
    return { payload: { ok: true, replayed: true } };
  }
}

function claimReceipt(input: {
  key: string;
  publicId: string;
  action: string;
  actor: string;
  hash: string;
}):
  | { ok: true; owner: string }
  | { conflict: true }
  | { inflight: true }
  | { uncertain: true }
  | { payload: Record<string, unknown> } {
  if (!input.key) return { ok: true, owner: "" };
  reconcilePendingReceipts();

  const rawRow = getHomesteadDb()
    .prepare("SELECT result_json, request_hash FROM control_action_receipts WHERE idempotency_key = ?")
    .get(input.key) as { result_json: string; request_hash?: string } | undefined;

  // Same key + different payload is always a conflict — including after lease expiry/abandon.
  if (rawRow?.request_hash && rawRow.request_hash !== input.hash) {
    return { conflict: true };
  }

  let abandonedPayload: PendingReceiptMeta | null = null;
  if (rawRow) {
    try {
      const parsed = JSON.parse(rawRow.result_json) as PendingReceiptMeta;
      if (parsed?.__pending === true && parsed.state === "abandoned") abandonedPayload = parsed;
      if (parsed?.__pending === true && parsed.state === "uncertain") return { uncertain: true };
    } catch {
      /* ignore */
    }
  }

  const existing = readReceipt(input.key, input.hash);
  if (existing?.conflict) return { conflict: true };
  if (existing && "uncertain" in existing && existing.uncertain) return { uncertain: true };
  if (existing?.inflight) return { inflight: true };
  if (existing?.payload && !("abandoned" in existing) && !abandonedPayload) return { payload: existing.payload };

  const owner = createHash("sha256").update(`${input.key}:${input.actor}:${Date.now()}:${Math.random()}`).digest("hex").slice(0, 24);
  const leaseUntil = new Date(Date.now() + PENDING_RECEIPT_LEASE_MS).toISOString();
  const pending: PendingReceiptMeta = { __pending: true, owner, leaseUntil, state: "active" };

  if (abandonedPayload || (existing && "abandoned" in existing && existing.abandoned)) {
    // Reclaim abandoned lease only with the SAME request hash — do not delete the row.
    const info = getHomesteadDb()
      .prepare(
        `UPDATE control_action_receipts
         SET result_json = ?, actor = ?, created_at = ?
         WHERE idempotency_key = ?
           AND request_hash = ?
           AND result_json LIKE '%"state":"abandoned"%'`,
      )
      .run(JSON.stringify(pending), input.actor.slice(0, 80), new Date().toISOString(), input.key, input.hash);
    if (info.changes !== 1) {
      const again = readReceipt(input.key, input.hash);
      if (again?.conflict) return { conflict: true };
      if (again?.payload) return { payload: again.payload };
      if (again?.inflight) return { inflight: true };
      return { inflight: true };
    }
    const check = readReceipt(input.key, input.hash);
    if (check?.inflight && "owner" in check && check.owner === owner) return { ok: true, owner };
    if (check?.payload) return { payload: check.payload };
    return { inflight: true };
  }

  const info = getHomesteadDb()
    .prepare(
      `INSERT OR IGNORE INTO control_action_receipts
        (idempotency_key, public_id, action, actor, result_json, request_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.key,
      input.publicId,
      input.action,
      input.actor.slice(0, 80),
      JSON.stringify(pending),
      input.hash,
      new Date().toISOString(),
    );
  if (info.changes === 0) {
    const again = readReceipt(input.key, input.hash);
    if (again?.conflict) return { conflict: true };
    if (again && "uncertain" in again && again.uncertain) return { uncertain: true };
    if (again?.inflight) return { inflight: true };
    if (again?.payload) return { payload: again.payload };
    return { inflight: true };
  }
  return { ok: true, owner };
}

/** Finish receipt only if this executor still owns an active pending lease. */
function writeReceipt(input: {
  key: string;
  publicId: string;
  action: string;
  actor: string;
  hash: string;
  result: Record<string, unknown>;
  owner?: string;
}): boolean {
  if (!input.key) return true;
  const now = new Date().toISOString();
  const resultJson = JSON.stringify(input.result);
  if (input.owner) {
    // Conditional atomic finish: owner + active pending + matching hash. Never overwrite a finished/newer result.
    const ownerNeedle = `"owner":"${input.owner}"`;
    const info = getHomesteadDb()
      .prepare(
        `UPDATE control_action_receipts
         SET result_json = ?, actor = ?, created_at = ?
         WHERE idempotency_key = ?
           AND request_hash = ?
           AND result_json LIKE '%"__pending":true%'
           AND result_json LIKE '%"state":"active"%'
           AND result_json LIKE ?`,
      )
      .run(resultJson, input.actor.slice(0, 80), now, input.key, input.hash, `%${ownerNeedle}%`);
    return info.changes === 1;
  }
  getHomesteadDb()
    .prepare(
      `INSERT INTO control_action_receipts
        (idempotency_key, public_id, action, actor, result_json, request_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(idempotency_key) DO UPDATE SET
         result_json = excluded.result_json,
         request_hash = excluded.request_hash`,
    )
    .run(input.key, input.publicId, input.action, input.actor.slice(0, 80), resultJson, input.hash, now);
  return true;
}

function assertVersion(publicId: string, version: number) {
  const current = latestVersion(publicId)?.version || 0;
  if (!version || current !== version) {
    return { ok: false as const, error: "stale_version" as const, current };
  }
  return { ok: true as const, current };
}

export function toControlJobCard(publicId: string) {
  const job = getJobByPublicId(publicId);
  if (!job) return null;
  const publications = publicationsView(publicId);
  const displayState = deriveControlDisplayState({
    status: job.status,
    publications,
  });
  const version = latestVersion(publicId);
  const settings = getContentSettings();
  const image = assessPublishImage(publicId);
  const branded = image.branded;
  const original = image.original;
  const processingPhase =
    job.status === "PROCESSING" || job.status === "RECEIVING"
      ? "processing"
      : job.status === "FAILED" && !image.ready
        ? "error"
        : image.ready
          ? "ready"
          : job.status === "DRAFT"
            ? "uploading"
            : "error";
  return {
    publicId: job.publicId,
    status: job.status,
    displayState,
    displayLabel: controlDisplayLabel(displayState),
    version: version?.version || 0,
    approvedVersion: job.approvedVersion,
    copy: job.selectedCaption || version?.copy || "",
    serviceType: job.serviceType,
    batchId: job.photoBatchId || "",
    campaignId: job.campaignPublicId || "",
    recommendedPublishAt: job.recommendedPublishAt,
    recommendedPublishLabel: job.recommendedPublishAt
      ? formatPanama(job.recommendedPublishAt, settings)
      : "",
    lastError: job.lastError || "",
    lastErrorLabel: job.lastError ? humanPublicationError(job.lastError) : "",
    publications: publications.map((row) => ({
      ...row,
      errorLabel: row.error ? humanPublicationError(row.error) : "",
    })),
    previewAssetId: branded?.id || null,
    originalAssetId: original?.id || null,
    brandedAssetId: branded?.id || null,
    publishImageReady: image.ready,
    publishImageIssue: image.cause,
    publishImageIssueLabel: image.cause ? humanPublicationError(image.cause) : "",
    processingPhase,
    brandedWidth: branded?.width || null,
    brandedHeight: branded?.height || null,
    originalWidth: original?.width || null,
    originalHeight: original?.height || null,
    updatedAt: job.updatedAt,
    createdAt: job.createdAt,
    paused: settings.paused,
    dryRun: settings.dryRun,
  };
}

export function availableControlActions(job: NonNullable<ReturnType<typeof toControlJobCard>>) {
  const pending = job.publications.some((row) => !row.dryRun && row.status !== "PUBLISHED");
  const uncertain = job.publications.some((row) => row.status === "UNCERTAIN" || row.status === "PUBLISHING");
  const imageOk = job.publishImageReady === true;
  return {
    approve: imageOk && ["pending_approval", "needs_review"].includes(job.displayState) && !job.paused,
    approveAndSchedule:
      imageOk &&
      ["pending_approval", "needs_review", "approved_unscheduled"].includes(job.displayState) &&
      !job.paused,
    reschedule: job.status === "SCHEDULED" && !job.paused,
    reject: ["pending_approval", "approved_unscheduled", "scheduled", "needs_review"].includes(job.displayState),
    publishNow:
      imageOk &&
      ["scheduled", "approved_unscheduled", "partially_published"].includes(job.displayState) &&
      !job.paused,
    retryPlatform: imageOk && (job.displayState === "partially_published" || pending) && !uncertain && !job.paused,
    retryBlockedByUncertain: uncertain,
    reprocessMedia: Boolean(job.originalAssetId) && (!imageOk || job.displayState === "needs_review"),
    regenerateCopy: ["pending_approval", "needs_review", "approved_unscheduled", "scheduled"].includes(
      job.displayState,
    ),
    saveCopy: ["pending_approval", "needs_review", "approved_unscheduled", "scheduled"].includes(
      job.displayState,
    ),
    updateAiContext: ["pending_approval", "needs_review", "approved_unscheduled", "scheduled"].includes(
      job.displayState,
    ),
    blockedByIncompleteImage: !imageOk,
  };
}

export function listControlJobs(filters: {
  state?: ControlDisplayState | "all";
  platform?: string;
  batchId?: string;
  campaignId?: string;
  q?: string;
}) {
  const q = (filters.q || "").trim().toUpperCase();
  return listAllContentJobIds()
    .map((id) => toControlJobCard(id))
    .filter((job): job is NonNullable<ReturnType<typeof toControlJobCard>> => Boolean(job))
    .filter((job) => {
      if (filters.state && filters.state !== "all" && job.displayState !== filters.state) return false;
      if (filters.batchId && job.batchId !== filters.batchId) return false;
      if (filters.campaignId && job.campaignId !== filters.campaignId) return false;
      if (q && !job.publicId.includes(q) && !job.batchId.toUpperCase().includes(q) && !job.campaignId.toUpperCase().includes(q)) {
        return false;
      }
      if (filters.platform) {
        const hit = job.publications.some((row) => row.platform === filters.platform);
        if (!hit && job.publications.length) return false;
      }
      return true;
    });
}

export function paginateControlJobs<T>(items: T[], page = 1, pageSize = 20) {
  const size = Math.min(50, Math.max(1, pageSize));
  const current = Math.max(1, page);
  const start = (current - 1) * size;
  return {
    items: items.slice(start, start + size),
    total: items.length,
    page: current,
    pageSize: size,
    pages: Math.max(1, Math.ceil(items.length / size)),
  };
}

export function getControlJobDetail(publicId: string) {
  const card = toControlJobCard(publicId);
  if (!card) return null;
  const job = getJobByPublicId(publicId)!;
  const version = latestVersion(publicId);
  const history = listContentEvents(publicId).map((row) => ({
    event: row.event,
    detail: row.detail,
    createdAt: row.created_at,
  }));
  const mediaVersion = job.approvedVersion || version?.version || 1;
  let mediaItems = listOrderedBrandedFeeds(publicId, mediaVersion, job.mediaOrderJson).map((asset, index) => ({
    assetId: asset.id,
    index,
    width: asset.width,
    height: asset.height,
    size: asset.size,
    role: asset.role,
  }));
  if (!mediaItems.length) {
    const fallback = listAssets(publicId, "BRANDED")
      .filter((a) => a.storedFilename.includes("-feed"))
      .sort((a, b) => a.id - b.id);
    const orderIds = parseMediaOrderJson(job.mediaOrderJson);
    const ordered =
      orderIds.length > 0
        ? orderIds
            .map((id) => fallback.find((a) => a.id === id))
            .filter((a): a is NonNullable<typeof a> => Boolean(a))
            .concat(fallback.filter((a) => !orderIds.includes(a.id)))
        : fallback;
    mediaItems = ordered.map((asset, index) => ({
      assetId: asset.id,
      index,
      width: asset.width,
      height: asset.height,
      size: asset.size,
      role: asset.role,
    }));
  }
  const isAlbum = job.format === "CAROUSEL" || job.publishMode === "album" || mediaItems.length > 1;
  return {
    ...card,
    description: job.description,
    cta: version?.cta || "",
    hashtags: version?.hashtags || "",
    history,
    format: job.format,
    publishMode: job.publishMode || (isAlbum ? "album" : "separate"),
    mediaItems,
    videoSupported: false,
    carouselSupported: true,
    laterNote: isAlbum
      ? "Álbum: Instagram publica carrusel oficial; Facebook usa multi-foto orgánica (fotos no publicadas + attached_media). Video/Reels no soportados."
      : "Una imagen por publicación. Elige modo álbum al subir varias fotos para carrusel/multi-foto. Video/Reels no soportados.",
    actions: availableControlActions(card),
  };
}

export function controlHomeSummary() {
  const jobs = listControlJobs({});
  const processingBatches = getHomesteadDb()
    .prepare(
      `SELECT COUNT(DISTINCT batch_key) as n FROM control_intake_items WHERE status IN ('received','processing')`,
    )
    .get() as { n: number };
  const counts = {
    pendingApproval: jobs.filter((job) => job.displayState === "pending_approval").length,
    approvedUnscheduled: jobs.filter((job) => job.displayState === "approved_unscheduled").length,
    scheduled: jobs.filter((job) => job.displayState === "scheduled").length,
    needsReview: jobs.filter((job) => job.displayState === "needs_review").length,
    partial: jobs.filter((job) => job.displayState === "partially_published").length,
    processingBatches: processingBatches.n,
  };
  return {
    counts,
    upcoming: jobs
      .filter((job) => job.displayState === "scheduled")
      .slice(0, 6),
    priority: jobs
      .filter((job) =>
        ["needs_review", "partially_published", "pending_approval", "approved_unscheduled"].includes(
          job.displayState,
        ),
      )
      .slice(0, 8),
    settings: getContentSettings(),
  };
}

export function classifyControlFailure(job: NonNullable<ReturnType<typeof toControlJobCard>>) {
  const uncertain = job.publications.some((row) => row.status === "UNCERTAIN" || row.status === "PUBLISHING");
  if (uncertain) return "uncertain";
  if (job.displayState === "partially_published") return "partial";
  return "failed";
}

export function listControlErrors() {
  return listControlJobs({})
    .filter(
      (job) =>
        job.displayState === "needs_review" ||
        job.displayState === "partially_published" ||
        job.publications.some((row) => row.status === "FAILED" || row.status === "UNCERTAIN") ||
        Boolean(job.lastError),
    )
    .map((job) => ({
      ...job,
      failureKind: classifyControlFailure(job),
      actionHint: classifyControlFailure(job) === "uncertain"
        ? "Resultado pendiente de conciliación. No republicar a ciegas."
        : classifyControlFailure(job) === "partial"
          ? "Reintenta solo la red pendiente."
          : "Revisa el error y reintenta si el fallo es definitivo.",
    }));
}

export function listControlCampaigns() {
  return listAllCampaigns().map((campaign) => {
    const pieces = listCampaignPieces(campaign.publicId);
    const jobs = pieces
      .map((piece) => (piece.contentJobId ? toControlJobCard(piece.contentJobId) : null))
      .filter(Boolean);
    return {
      publicId: campaign.publicId,
      status: campaign.status,
      service: campaign.service,
      zone: campaign.zone,
      startsAt: campaign.startsAt,
      endsAt: campaign.endsAt,
      pieceCount: pieces.length,
      failures: jobs.filter((job) => job && (job.displayState === "needs_review" || job.displayState === "partially_published"))
        .length,
      pieces: pieces.map((piece) => ({
        publicId: piece.publicId,
        status: piece.status,
        contentJobId: piece.contentJobId,
        scheduledAt: piece.scheduledAt,
        job: piece.contentJobId ? toControlJobCard(piece.contentJobId) : null,
      })),
    };
  });
}

export function getControlCampaign(publicId: string) {
  const campaign = getCampaignByPublicId(publicId);
  if (!campaign) return null;
  return listControlCampaigns().find((item) => item.publicId === publicId) || null;
}

export function getControlBatch(publicId: string) {
  const batch = getPhotoBatch(publicId);
  if (!batch) return null;
  const members = batch.members.map((member) => ({
    ...member,
    job: toControlJobCard(member.publicId),
  }));
  return {
    publicId: batch.public_id,
    status: batch.status,
    members,
    carouselSupported: true,
  };
}

function scheduleJob(publicId: string) {
  const job = getJobByPublicId(publicId);
  if (!job) return { ok: false as const, error: "missing" as const };
  const slot = recommendPublishAt(job);
  updateJob(publicId, {
    status: "SCHEDULED",
    approvedAt: job.approvedAt || new Date().toISOString(),
    recommendedPublishAt: slot.at,
    recommendationReason: slot.reason,
  });
  recordContentEvent(publicId, "CONTENT_SCHEDULED", `control:${slot.at}`);
  return { ok: true as const, slot };
}

export function previewPublishNow(publicId: string) {
  const job = getJobByPublicId(publicId);
  if (!job) return { ok: false as const, error: "missing" as const };
  const settings = getContentSettings();
  const version = latestVersion(publicId);
  const publications = publicationsView(publicId);
  return {
    ok: true as const,
    publicId,
    version: version?.version || 0,
    copy: job.selectedCaption || version?.copy || "",
    platforms: settings.platforms,
    dryRun: settings.dryRun,
    paused: settings.paused,
    liveEffect: settings.dryRun
      ? "Simulación: no sale en Instagram ni Facebook."
      : "Efecto real (o proveedor simulado si HOMESTEAD_CONTROL_ISOLATED=true): intenta publicar en las redes pendientes.",
    alreadyPublished: publications.filter((row) => !row.dryRun && row.status === "PUBLISHED"),
    pendingPlatforms: settings.platforms.filter((platform) => {
      const row = publications.find((item) => item.platform === platform && !item.dryRun);
      return !row || row.status !== "PUBLISHED";
    }),
    cadenceNote:
      "Publicar ahora es una acción explícita. No convierte otras piezas APPROVED a SCHEDULED. La cadencia 1/día y 36 h sigue aplicándose al programador automático.",
  };
}

export function setStudioPaused(paused: boolean, actor: string) {
  const current = getContentSettings();
  setContentPaused(paused);
  recordContentEvent("STUDIO", paused ? "STUDIO_PAUSED" : "STUDIO_RESUMED", actor);
  return {
    ok: true as const,
    paused,
    dryRunUnchanged: current.dryRun,
    effect: paused
      ? "No se aprueba ni se publica contenido hasta reanudar. DRY RUN no cambia."
      : "El estudio volvió a aceptar aprobaciones y publicaciones según las políticas vigentes.",
  };
}

export function setControlCampaignPaused(campaignId: string, paused: boolean, actor: string) {
  const campaign = getCampaignByPublicId(campaignId);
  if (!campaign) return { ok: false as const, error: "missing" as const };
  if (paused) {
    const result = pauseCampaign(campaignId, actor);
    return { ok: result.ok, error: result.ok ? "" : result.reason, status: "PAUSED" };
  }
  const resumed = resumeCampaign(campaignId, actor);
  return { ok: resumed.ok, error: resumed.ok ? "" : resumed.reason, status: resumed.ok ? "SCHEDULED" : campaign.status };
}

export async function runControlJobAction(input: {
  publicId: string;
  action: ControlJobAction;
  version: number;
  actor: string;
  confirm?: boolean;
  idempotencyKey?: string;
  copy?: string;
  note?: string;
}) {
  const hash = receiptHash({
    key: input.idempotencyKey || "",
    publicId: input.publicId,
    action: input.action,
    actor: input.actor,
    version: input.version,
    confirm: input.confirm,
    copy: input.copy,
    note: input.note,
  });
  const claimed = claimReceipt({
    key: input.idempotencyKey || "",
    publicId: input.publicId,
    action: input.action,
    actor: input.actor,
    hash,
  });
  if ("conflict" in claimed && claimed.conflict) return { ok: false as const, error: "idempotency_conflict" as const };
  if ("uncertain" in claimed && claimed.uncertain) {
    return { ok: false as const, error: "idempotency_uncertain" as const };
  }
  if ("inflight" in claimed && claimed.inflight) {
    return { ok: false as const, error: "idempotency_inflight" as const };
  }
  if ("payload" in claimed && claimed.payload) return { ...claimed.payload, replayed: true };

  const receiptOwner = "owner" in claimed ? claimed.owner : "";

  const finish = (payload: Record<string, unknown>) => {
    writeReceipt({
      key: input.idempotencyKey || "",
      publicId: input.publicId,
      action: input.action,
      actor: input.actor,
      hash,
      result: payload,
      owner: receiptOwner,
    });
    return payload;
  };

  const job = getJobByPublicId(input.publicId);
  if (!job) return finish({ ok: false, error: "missing" });

  const versionGate = assertVersion(input.publicId, input.version);
  const editActions = new Set([
    "reprocess_media",
    "regenerate_copy",
    "save_copy",
    "update_ai_context",
  ]);
  if (!versionGate.ok && !editActions.has(input.action) && input.action !== "reschedule") {
    return finish({ ok: false, error: versionGate.error, current: versionGate.current });
  }

  if (editActions.has(input.action)) {
    const { assertContentJobEditable, assertExpectedContentVersion } = await import("@/lib/content-edit-guard");
    const editable = assertContentJobEditable(input.publicId);
    if (!editable.ok) {
      return finish({ ok: false, error: editable.error, version: editable.version });
    }
    const expected = assertExpectedContentVersion(input.publicId, input.version);
    if (!expected.ok) {
      return finish({ ok: false, error: expected.error, current: expected.current });
    }
  }

  if (input.action === "reject") {
    const result = tryRejectContentJob(input.publicId, input.actor);
    return finish({ ok: result.ok, already: result.already, error: result.ok ? "" : result.reason });
  }

  if (input.action === "reprocess_media") {
    const { reprocessControlBrand } = await import("@/lib/control-intake");
    const result = await reprocessControlBrand(input.publicId, input.version);
    return finish({
      ok: result.ok,
      error: result.ok ? "" : result.error,
      invalidatedApproval: result.ok ? true : false,
      version: result.ok ? result.version : undefined,
      job: toControlJobCard(input.publicId),
    });
  }

  if (input.action === "regenerate_copy") {
    const { regenerateControlCopy } = await import("@/lib/control-intake");
    const result = await regenerateControlCopy(input.publicId, input.note, input.version);
    return finish({
      ok: result.ok,
      error: result.ok ? "" : result.error,
      invalidatedApproval: result.ok ? true : false,
      usedFallback: result.ok ? result.usedFallback : false,
      needsReview: result.ok ? result.needsReview : false,
      version: result.ok ? result.version : undefined,
      mediaOrderJson: result.ok ? result.mediaOrderJson : undefined,
      job: getControlJobDetail(input.publicId),
    });
  }

  if (input.action === "update_ai_context") {
    const jobNow = getJobByPublicId(input.publicId);
    if (!jobNow) return finish({ ok: false, error: "missing" });
    const note = String(input.note ?? "").trim().slice(0, 2000);
    const nextStatus =
      jobNow.status === "APPROVED" || jobNow.status === "SCHEDULED" || jobNow.status === "NEEDS_REVIEW"
        ? ("AWAITING_APPROVAL" as const)
        : jobNow.status;
    const { applyContentEditAtomic } = await import("@/lib/content-edit-guard");
    const applied = applyContentEditAtomic({
      publicId: input.publicId,
      expectedVersion: input.version,
      kind: "copy",
      actor: input.actor,
      event: "CONTENT_AI_CONTEXT_UPDATED",
      copy: jobNow.selectedCaption || "",
      mediaOrderJson: jobNow.mediaOrderJson || "",
      jobPatch: {
        description: note,
        approvedVersion: null,
        status: nextStatus,
      },
    });
    if (!applied.ok) {
      return finish({ ok: false, error: applied.error, current: applied.current });
    }
    return finish({
      ok: true,
      error: "",
      invalidatedApproval: true,
      regeneratedCopy: false,
      version: applied.version,
      job: getControlJobDetail(input.publicId),
    });
  }

  if (input.action === "save_copy") {
    const { saveControlCopy } = await import("@/lib/control-intake");
    const result = saveControlCopy(input.publicId, input.copy || "", input.version);
    return finish({
      ok: result.ok,
      error: result.ok ? "" : result.error,
      invalidatedApproval: result.ok ? true : false,
      version: result.ok ? result.version : undefined,
      current: result.ok ? undefined : "current" in result ? result.current : undefined,
      job: getControlJobDetail(input.publicId),
    });
  }

  if (input.action === "approve" || input.action === "approve_and_schedule") {
    const image = assessPublishImage(input.publicId);
    if (!image.ready) {
      return { ok: false as const, error: image.cause || "image_missing" };
    }
    if (job.status === "NEEDS_REVIEW") {
      updateJob(input.publicId, { status: "AWAITING_APPROVAL" });
    }
    const approved = tryApproveContentJob(input.publicId, input.actor);
    if (!approved.ok && !approved.already) {
      return { ok: false as const, error: approved.reason };
    }
    updateJob(input.publicId, { approvedVersion: versionGate.current });
    let slot: { at: string; reason: string } | undefined;
    if (input.action === "approve_and_schedule") {
      const current = getJobByPublicId(input.publicId);
      if (current?.status === "SCHEDULED" && current.recommendedPublishAt) {
        slot = { at: current.recommendedPublishAt, reason: current.recommendationReason || "already" };
      } else {
        const scheduled = scheduleJob(input.publicId);
        if (!scheduled.ok) return scheduled;
        slot = scheduled.slot;
      }
    } else {
      recordContentEvent(input.publicId, "CONTENT_APPROVED", "control:approve_only");
    }
    return finish({
      ok: true,
      already: approved.already,
      scheduled: input.action === "approve_and_schedule",
      slot,
      job: toControlJobCard(input.publicId),
    });
  }

  if (input.action === "reschedule") {
    const current = getJobByPublicId(input.publicId);
    if (!current) return finish({ ok: false, error: "missing" });
    if (current.status !== "SCHEDULED") {
      return finish({ ok: false, error: "not_scheduled" });
    }
    const slots = assignStaggeredSlots([input.publicId]);
    const slot = slots[0];
    if (slot) {
      updateJob(input.publicId, {
        status: "SCHEDULED",
        recommendedPublishAt: slot.at,
        recommendationReason: slot.reason,
      });
    }
    return finish({ ok: true, slot, job: toControlJobCard(input.publicId) });
  }

  if (input.action === "publish_now" || input.action === "retry_platform") {
    const card = toControlJobCard(input.publicId);
    const image = assessPublishImage(input.publicId);
    if (!image.ready) {
      return finish({ ok: false, error: image.cause || "image_missing" });
    }
    if (card?.publications.some((row) => row.status === "UNCERTAIN" || row.status === "PUBLISHING")) {
      return finish({
        ok: false,
        error: "uncertain_pending",
        hint: "Hay un resultado incierto o publicación en curso. Conciliar o revisar el estado antes de reintentar; no se repite a ciegas.",
        job: card,
      });
    }
    if (!input.confirm) {
      return finish({
        ok: false,
        error: "confirm_required",
        preview: previewPublishNow(input.publicId),
      });
    }
    const published = await publishJob(input.publicId, "now");
    return finish({
      ok: published.ok,
      error: published.ok ? "" : "cause" in published ? published.cause : "publish_failed",
      results: "results" in published ? published.results : undefined,
      job: toControlJobCard(input.publicId),
    });
  }

  return finish({ ok: false, error: "unknown_action" });
}

export function assertDisplayState(status: ContentStatus, publications: PlatformPublicationView[]) {
  return deriveControlDisplayState({ status, publications });
}
