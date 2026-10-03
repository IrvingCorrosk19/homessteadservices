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
  | "retry_platform";

function receiptHash(input: {
  key: string;
  publicId: string;
  action: string;
  actor: string;
  version: number;
  confirm?: boolean;
}) {
  return createHash("sha256")
    .update(
      [input.key, input.publicId, input.action, input.actor, String(input.version), input.confirm ? "1" : "0"].join("|"),
    )
    .digest("hex");
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
    return { payload: JSON.parse(row.result_json) as Record<string, unknown> };
  } catch {
    return { payload: { ok: true, replayed: true } };
  }
}

function writeReceipt(input: {
  key: string;
  publicId: string;
  action: string;
  actor: string;
  hash: string;
  result: Record<string, unknown>;
}) {
  if (!input.key) return;
  getHomesteadDb()
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
      JSON.stringify(input.result),
      input.hash,
      new Date().toISOString(),
    );
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
  const branded = listAssets(publicId, "BRANDED").at(-1);
  const original = listAssets(publicId, "ORIGINAL", 0)[0];
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
    previewAssetId: branded?.id || original?.id || null,
    updatedAt: job.updatedAt,
    createdAt: job.createdAt,
    paused: settings.paused,
    dryRun: settings.dryRun,
  };
}

export function availableControlActions(job: NonNullable<ReturnType<typeof toControlJobCard>>) {
  const pending = job.publications.some((row) => !row.dryRun && row.status !== "PUBLISHED");
  const uncertain = job.publications.some((row) => row.status === "UNCERTAIN" || row.status === "PUBLISHING");
  return {
    approve: ["pending_approval", "needs_review"].includes(job.displayState) && !job.paused,
    approveAndSchedule: ["pending_approval", "needs_review", "approved_unscheduled"].includes(job.displayState) && !job.paused,
    reschedule: job.status === "SCHEDULED" && !job.paused,
    reject: ["pending_approval", "approved_unscheduled", "scheduled", "needs_review"].includes(job.displayState),
    publishNow: ["scheduled", "approved_unscheduled", "partially_published"].includes(job.displayState) && !job.paused,
    retryPlatform: (job.displayState === "partially_published" || pending) && !uncertain && !job.paused,
    retryBlockedByUncertain: uncertain,
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
  return {
    ...card,
    description: job.description,
    cta: version?.cta || "",
    hashtags: version?.hashtags || "",
    history,
    videoSupported: false,
    carouselSupported: false,
    laterNote:
      "Video y carrusel quedan para una fase posterior: el publicador solo envía una imagen JPEG por pieza.",
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
    carouselSupported: false,
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
}) {
  const hash = receiptHash({
    key: input.idempotencyKey || "",
    publicId: input.publicId,
    action: input.action,
    actor: input.actor,
    version: input.version,
    confirm: input.confirm,
  });
  const existing = readReceipt(input.idempotencyKey || "", hash);
  if (existing?.conflict) return { ok: false as const, error: "idempotency_conflict" as const };
  if (existing?.payload) return { ...existing.payload, replayed: true };

  const job = getJobByPublicId(input.publicId);
  if (!job) return { ok: false as const, error: "missing" as const };

  const versionGate = assertVersion(input.publicId, input.version);
  if (!versionGate.ok && input.action !== "reschedule") {
    return versionGate;
  }

  if (input.action === "reject") {
    const result = tryRejectContentJob(input.publicId, input.actor);
    const payload = { ok: result.ok, already: result.already, error: result.ok ? "" : result.reason };
    writeReceipt({
      key: input.idempotencyKey || "",
      publicId: input.publicId,
      action: input.action,
      actor: input.actor,
      hash,
      result: payload,
    });
    return payload;
  }

  if (input.action === "approve" || input.action === "approve_and_schedule") {
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
    const payload = {
      ok: true as const,
      already: approved.already,
      scheduled: input.action === "approve_and_schedule",
      slot,
      job: toControlJobCard(input.publicId),
    };
    writeReceipt({
      key: input.idempotencyKey || "",
      publicId: input.publicId,
      action: input.action,
      actor: input.actor,
      hash,
      result: payload,
    });
    return payload;
  }

  if (input.action === "reschedule") {
    const current = getJobByPublicId(input.publicId);
    if (!current) return { ok: false as const, error: "missing" as const };
    if (current.status !== "SCHEDULED") {
      return { ok: false as const, error: "not_scheduled" as const };
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
    const payload = { ok: true as const, slot, job: toControlJobCard(input.publicId) };
    writeReceipt({
      key: input.idempotencyKey || "",
      publicId: input.publicId,
      action: input.action,
      actor: input.actor,
      hash,
      result: payload,
    });
    return payload;
  }

  if (input.action === "publish_now" || input.action === "retry_platform") {
    const card = toControlJobCard(input.publicId);
    if (input.action === "retry_platform" && card?.publications.some((row) => row.status === "UNCERTAIN")) {
      return { ok: false as const, error: "uncertain_pending" as const };
    }
    if (!input.confirm) {
      return { ok: false as const, error: "confirm_required" as const, preview: previewPublishNow(input.publicId) };
    }
    const published = await publishJob(input.publicId, "now");
    const payload = {
      ok: published.ok,
      error: published.ok ? "" : "cause" in published ? published.cause : "publish_failed",
      job: toControlJobCard(input.publicId),
    };
    writeReceipt({
      key: input.idempotencyKey || "",
      publicId: input.publicId,
      action: input.action,
      actor: input.actor,
      hash,
      result: payload,
    });
    return payload;
  }

  return { ok: false as const, error: "unknown_action" as const };
}

export function assertDisplayState(status: ContentStatus, publications: PlatformPublicationView[]) {
  return deriveControlDisplayState({ status, publications });
}
