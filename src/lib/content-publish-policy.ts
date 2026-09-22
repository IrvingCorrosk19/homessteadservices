import type { ContentJob } from "@/lib/content-types";

export type PublishSource = "now" | "scheduler" | "live";

/** Emergency env kill switch. Pause is the Telegram emergency. */
export function contentPublishGloballyBlocked() {
  return process.env.CONTENT_PUBLISH_ENABLED === "false";
}

/**
 * Dry-run is the default. live_once only authorizes an explicit live confirmation,
 * never PUBLICAR AHORA nor the scheduler. Pause / CONTENT_PUBLISH_ENABLED=false
 * override even that one-shot.
 */
export function jobUsesLiveOverride(
  job: Pick<ContentJob, "liveOnce">,
  settingsDryRun: boolean,
  source: PublishSource,
  paused = false,
) {
  if (paused) return false;
  if (contentPublishGloballyBlocked()) return false;
  if (!settingsDryRun) return true;
  return Boolean(job.liveOnce) && source === "live";
}

export function shouldConsumeLiveOnce(live: boolean, source: PublishSource) {
  return live && source === "live";
}

export type FacebookReconcileDecision =
  | { action: "lookup_stored_id"; postId: string }
  | { action: "cannot_reconcile" }
  | { action: "create_new" };

/** Never match another Page post by caption. Only GET a post id we already stored. */
export function facebookReconcileDecision(input: {
  existingStatus?: string;
  existingPostId?: string;
  source: PublishSource;
}): FacebookReconcileDecision {
  const status = input.existingStatus || "";
  const postId = (input.existingPostId || "").trim();
  if (status === "UNCERTAIN" || status === "PUBLISHING") {
    if (postId) return { action: "lookup_stored_id", postId };
    if (input.source === "live") return { action: "create_new" };
    return { action: "cannot_reconcile" };
  }
  return { action: "create_new" };
}

export function selectRetryPlatforms(
  results: Array<{ platform: string; outcome: string }>,
): string[] {
  return results
    .filter((row) => row.outcome === "failed" || row.outcome === "uncertain")
    .map((row) => row.platform);
}

export function mergeIndependentPlatformResults(
  previous: Array<{ platform: string; outcome: string }>,
  next: Array<{ platform: string; outcome: string }>,
) {
  const map = new Map(previous.map((row) => [row.platform, row]));
  for (const row of next) {
    const current = map.get(row.platform);
    if (current?.outcome === "published" || current?.outcome === "already") continue;
    map.set(row.platform, row);
  }
  return [...map.values()];
}
