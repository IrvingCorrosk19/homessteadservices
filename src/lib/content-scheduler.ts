import {
  getContentSettings,
  listJobsByStatus,
  recordContentEvent,
} from "@/lib/content-catalog";
import { publishJob } from "@/lib/content-publish";
import { campaignJobPaused } from "@/lib/campaign-store";
import { logInfo } from "@/lib/log";

export async function runContentScheduler() {
  const settings = getContentSettings();
  if (settings.paused) {
    return { ok: true, skipped: "paused", published: [] as string[] };
  }
  if (settings.mode === "MANUAL") {
    return { ok: true, skipped: "manual", published: [] as string[] };
  }
  const now = Date.now();
  const due = listJobsByStatus(["SCHEDULED"]).filter((job) => {
    if (!job.recommendedPublishAt) return false;
    if (campaignJobPaused(job.publicId)) return false;
    return Date.parse(job.recommendedPublishAt) <= now;
  });
  const published: string[] = [];
  const failed: string[] = [];
  for (const job of due) {
    recordContentEvent(job.publicId, "CONTENT_PUBLISHING", "scheduler");
    const result = await publishJob(job.publicId, "scheduler");
    if (result.ok) published.push(job.publicId);
    else if (!("cause" in result && result.cause === "locked")) failed.push(job.publicId);
    logInfo("ContentSchedulerTick", {
      contentJobId: job.publicId,
      stage: result.ok ? "published" : "skipped",
    });
  }
  return { ok: failed.length === 0, published, failed };
}
