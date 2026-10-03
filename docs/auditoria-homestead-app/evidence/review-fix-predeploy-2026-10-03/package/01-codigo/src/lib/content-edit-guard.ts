import { getJobByPublicId, listPublicationsForJob, latestVersion } from "@/lib/content-catalog";

/**
 * Server-side gate for media reorder/remove and copy/context edits.
 * UI hiding buttons is not sufficient — callers must enforce this.
 */
export function assertContentJobEditable(publicId: string): {
  ok: true;
  version: number;
} | {
  ok: false;
  error:
    | "missing"
    | "publishing_in_progress"
    | "uncertain_pending"
    | "already_published"
    | "not_editable";
  version: number;
} {
  const job = getJobByPublicId(publicId);
  const version = latestVersion(publicId)?.version || 0;
  if (!job) return { ok: false, error: "missing", version };
  if (job.status === "PUBLISHING") {
    return { ok: false, error: "publishing_in_progress", version };
  }
  if (job.status === "PUBLISHED" || job.status === "SIMULATED") {
    return { ok: false, error: "already_published", version };
  }
  const pubs = listPublicationsForJob(publicId);
  if (pubs.some((row) => row.status === "PUBLISHING")) {
    return { ok: false, error: "publishing_in_progress", version };
  }
  if (pubs.some((row) => row.status === "UNCERTAIN")) {
    return { ok: false, error: "uncertain_pending", version };
  }
  if (pubs.some((row) => row.status === "PUBLISHED" && !row.dry_run)) {
    // Partial live success: do not allow silent media/copy rewrite of what may already be out.
    return { ok: false, error: "already_published", version };
  }
  const editableStatuses = new Set([
    "DRAFT",
    "RECEIVING",
    "PROCESSING",
    "AWAITING_APPROVAL",
    "APPROVED",
    "SCHEDULED",
    "NEEDS_REVIEW",
    "FAILED",
  ]);
  if (!editableStatuses.has(job.status)) {
    return { ok: false, error: "not_editable", version };
  }
  return { ok: true, version };
}

export function assertExpectedContentVersion(publicId: string, expectedVersion: number | undefined) {
  const current = latestVersion(publicId)?.version || 0;
  if (expectedVersion === undefined || expectedVersion === null) {
    return { ok: false as const, error: "version_required" as const, current };
  }
  if (Number(expectedVersion) !== current) {
    return { ok: false as const, error: "stale_version" as const, current };
  }
  return { ok: true as const, current };
}
