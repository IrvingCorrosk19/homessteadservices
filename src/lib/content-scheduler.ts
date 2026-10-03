import {
  getContentSettings,
  listJobsByStatus,
  recordContentEvent,
} from "@/lib/content-catalog";
import { getHomesteadDb } from "@/lib/service-requests";
import { publishJob } from "@/lib/content-publish";
import { campaignJobExcludedFromAutoPublish, campaignJobPaused } from "@/lib/campaign-store";
import { logInfo } from "@/lib/log";

function panamaYmd(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Panama",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function panamaDayStartIso(date = new Date()) {
  return new Date(`${panamaYmd(date)}T00:00:00-05:00`).toISOString();
}

function livePublicationCount(sinceIso: string) {
  const row = getHomesteadDb()
    .prepare(
      `SELECT COUNT(DISTINCT public_id) as n FROM content_publications
       WHERE dry_run = 0 AND status = 'PUBLISHED'
         AND COALESCE(published_at, created_at) >= ?`,
    )
    .get(sinceIso) as { n: number };
  return row.n;
}

function liveCadenceBlocked() {
  const settings = getContentSettings();
  if (settings.dryRun) return "";
  if (livePublicationCount(panamaDayStartIso()) >= settings.maxPostsPerDay) {
    return "max_posts_per_day";
  }
  const minAgo = new Date(Date.now() - settings.minHoursBetweenPosts * 3600_000).toISOString();
  if (livePublicationCount(minAgo) >= 1) return "min_hours_between_posts";
  return "";
}

export async function runContentScheduler() {
  const settings = getContentSettings();
  if (settings.paused) {
    return { ok: true, skipped: "paused", published: [] as string[] };
  }
  try {
    const { flushDuePhotoGroups, batchReceivedText, batchKeyboard, snapshotBatchVersions } =
      await import("@/lib/content-photo-batch");
    const { beginProcessLock, getJobByPublicId } = await import("@/lib/content-catalog");
    const { processContentJob } = await import("@/lib/content-process");
    const { sendTelegramMessage } = await import("@/lib/content-telegram");
    const leftovers = flushDuePhotoGroups();
    for (const flushed of leftovers) {
      if (!flushed.publicIds.length) continue;
      const first = getJobByPublicId(flushed.publicIds[0]);
      if (first?.telegramChatId) {
        await sendTelegramMessage({
          chatId: first.telegramChatId,
          text: batchReceivedText({
            publicIds: flushed.publicIds,
            batchId: flushed.batchId,
            album: true,
            missing: flushed.missing,
          }),
          keyboard: flushed.batchId ? batchKeyboard(flushed.batchId, flushed.publicIds) : undefined,
        });
      }
      for (const id of flushed.publicIds) {
        if (!beginProcessLock(id)) continue;
        await processContentJob(id, "full");
      }
      if (flushed.batchId) snapshotBatchVersions(flushed.batchId);
    }
  } catch {
    // album leftovers must not block the publish tick
  }
  if (settings.mode === "MANUAL") {
    return { ok: true, skipped: "manual", published: [] as string[] };
  }
  const now = Date.now();
  const due = listJobsByStatus(["SCHEDULED"]).filter((job) => {
    if (!job.recommendedPublishAt) return false;
    if (Date.parse(job.recommendedPublishAt) > now) return false;
    if (campaignJobPaused(job.publicId)) return false;
    if (settings.approvalRequired && !job.approvedVersion) return false;
    if (campaignJobExcludedFromAutoPublish(job.publicId)) return false;
    return true;
  });
  const published: string[] = [];
  const failed: string[] = [];
  const held: string[] = [];
  let liveThisTick = 0;
  for (const job of due) {
    if (!settings.dryRun) {
      const cadence = liveCadenceBlocked();
      if (cadence || liveThisTick >= settings.maxPostsPerDay) {
        held.push(job.publicId);
        logInfo("ContentSchedulerTick", { contentJobId: job.publicId, stage: cadence || "held_cadence" });
        continue;
      }
    }
    recordContentEvent(job.publicId, "CONTENT_PUBLISHING", "scheduler");
    const result = await publishJob(job.publicId, "scheduler");
    if (result.ok) {
      published.push(job.publicId);
      if (!settings.dryRun && !result.dryRun) liveThisTick += 1;
    } else if (!("cause" in result && result.cause === "locked")) {
      failed.push(job.publicId);
    }
    logInfo("ContentSchedulerTick", {
      contentJobId: job.publicId,
      stage: result.ok ? "published" : "skipped",
    });
  }
  return { ok: failed.length === 0, published, failed, held };
}
