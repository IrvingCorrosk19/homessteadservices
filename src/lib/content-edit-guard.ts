import {
  getJobByPublicId,
  listPublicationsForJob,
  latestVersion,
  nextVersionNumber,
  saveVersion,
  updateJob,
  recordContentEvent,
} from "@/lib/content-catalog";
import { getHomesteadDb } from "@/lib/service-requests";
import type { ContentJob } from "@/lib/content-types";

/**
 * Server-side gate for media reorder/remove and copy/context edits.
 * UI hiding buttons is not sufficient — callers must enforce this.
 */
export function assertContentJobEditable(publicId: string): {
  ok: true;
  version: number;
  job: ContentJob;
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
  return { ok: true, version, job };
}

/** Client must send the exact revision; never substitute the server current version. */
export function assertExpectedContentVersion(publicId: string, expectedVersion: number | undefined | null) {
  const current = latestVersion(publicId)?.version || 0;
  if (expectedVersion === undefined || expectedVersion === null || Number.isNaN(Number(expectedVersion))) {
    return { ok: false as const, error: "version_required" as const, current };
  }
  if (Number(expectedVersion) !== current) {
    return { ok: false as const, error: "stale_version" as const, current };
  }
  return { ok: true as const, current };
}

export type ContentEditJobPatch = {
  status?: ContentJob["status"];
  description?: string;
  selectedCaption?: string;
  captionsJson?: string;
  approvedVersion?: number | null;
  approvedAt?: string | null;
  lastError?: string | null;
  format?: string;
  publishMode?: string;
  mediaOrderJson?: string;
  pendingInput?: string | null;
};

/**
 * Atomically: re-check editable + expected revision, bump content_version, apply job patch.
 * Two concurrent editors with the same expectedVersion: exactly one wins.
 */
export function applyContentEditAtomic(input: {
  publicId: string;
  expectedVersion: number;
  kind: "full" | "copy" | "image";
  actor: string;
  event: string;
  copy: string;
  cta?: string;
  hashtags?: string;
  prompt?: string;
  privacyNote?: string;
  mediaOrderJson?: string;
  jobPatch: ContentEditJobPatch;
}):
  | { ok: true; version: number; job: ContentJob }
  | {
      ok: false;
      error:
        | "missing"
        | "publishing_in_progress"
        | "uncertain_pending"
        | "already_published"
        | "not_editable"
        | "stale_version"
        | "version_required";
      current?: number;
      version?: number;
    } {
  const db = getHomesteadDb();
  let outcome:
    | { ok: true; version: number; job: ContentJob }
    | {
        ok: false;
        error:
          | "missing"
          | "publishing_in_progress"
          | "uncertain_pending"
          | "already_published"
          | "not_editable"
          | "stale_version"
          | "version_required";
        current?: number;
        version?: number;
      } = { ok: false, error: "missing" };

  db.transaction(() => {
    const editable = assertContentJobEditable(input.publicId);
    if (!editable.ok) {
      outcome = { ok: false, error: editable.error, version: editable.version };
      return;
    }
    const gate = assertExpectedContentVersion(input.publicId, input.expectedVersion);
    if (!gate.ok) {
      outcome = { ok: false, error: gate.error, current: gate.current };
      return;
    }
    const job = editable.job;
    const nextVersion = nextVersionNumber(input.publicId);
    const mediaOrder =
      input.mediaOrderJson !== undefined ? input.mediaOrderJson : job.mediaOrderJson || "";
    saveVersion({
      job,
      version: nextVersion,
      kind: input.kind,
      copy: input.copy,
      cta: input.cta || "Agenda en homestead.lat",
      hashtags: input.hashtags || "#HomesteadServices #Panama",
      prompt: input.prompt || input.event,
      privacyNote: input.privacyNote || "",
      mediaOrderJson: mediaOrder,
    });
    updateJob(input.publicId, {
      ...input.jobPatch,
      mediaOrderJson: input.mediaOrderJson !== undefined ? input.mediaOrderJson : input.jobPatch.mediaOrderJson,
    });
    recordContentEvent(input.publicId, input.event, `${input.actor};v${input.expectedVersion}->${nextVersion}`);
    const updated = getJobByPublicId(input.publicId);
    if (!updated) {
      outcome = { ok: false, error: "missing" };
      return;
    }
    outcome = { ok: true, version: nextVersion, job: updated };
  })();

  return outcome;
}
