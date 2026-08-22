import { createHash } from "crypto";
import { mkdirSync, writeFileSync } from "fs";
import { dirname, join, resolve, sep } from "path";
import { getHomesteadDb, homesteadDataDir } from "@/lib/service-requests";
import { JOB_ID_PATTERN } from "@/lib/job-config";
import { bumpPhotoCount, getServiceJob } from "@/lib/job-store";
import type { SniffedImage } from "@/lib/photos";

export const MAX_JOB_PHOTOS = 12;
export const MAX_JOB_PHOTO_BYTES = 8 * 1024 * 1024;

export type JobPhotoRole = "WORK" | "BEFORE" | "AFTER";

export type JobPhoto = {
  id: number;
  jobId: string;
  originalRelpath: string;
  sha256: string;
  byteSize: number;
  mime: string;
  role: JobPhotoRole;
  marketingUsageApproved: boolean;
  createdAt: string;
  createdBy: string;
};

function nowIso() {
  return new Date().toISOString();
}

function sha256Of(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function panamaParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Panama",
    year: "numeric",
    month: "2-digit",
  });
  const parts = fmt.formatToParts(date);
  const read = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return { year: read("year"), month: read("month") };
}

export function jobPhotoRoot(jobId: string, createdAt?: string) {
  const date = createdAt ? new Date(createdAt) : new Date();
  const { year, month } = panamaParts(date);
  return join(homesteadDataDir(), "jobs", year, month, jobId);
}

function isInside(root: string, target: string) {
  const prefix = root.endsWith(sep) ? root : root + sep;
  return target === root || target.startsWith(prefix);
}

function mapPhoto(row: Record<string, unknown>): JobPhoto {
  const role = String(row.role || "WORK");
  return {
    id: Number(row.id),
    jobId: String(row.job_id),
    originalRelpath: String(row.original_relpath),
    sha256: String(row.sha256),
    byteSize: Number(row.byte_size),
    mime: String(row.mime),
    role: role === "BEFORE" || role === "AFTER" ? role : "WORK",
    marketingUsageApproved: Boolean(row.marketing_usage_approved),
    createdAt: String(row.created_at),
    createdBy: String(row.created_by || ""),
  };
}

export function listJobPhotos(jobId: string) {
  if (!JOB_ID_PATTERN.test(jobId)) return [];
  return (
    getHomesteadDb()
      .prepare("SELECT * FROM job_photos WHERE job_id = ? ORDER BY id ASC")
      .all(jobId) as Array<Record<string, unknown>>
  ).map(mapPhoto);
}

export function jobPhotoCount(jobId: string) {
  const row = getHomesteadDb()
    .prepare("SELECT COUNT(*) as n FROM job_photos WHERE job_id = ?")
    .get(jobId) as { n: number };
  return row.n;
}

export function storeJobOriginal(input: {
  jobId: string;
  bytes: Buffer;
  sniffed: SniffedImage;
  actor?: string;
  role?: JobPhotoRole;
}) {
  if (!JOB_ID_PATTERN.test(input.jobId)) return { ok: false as const, error: "invalid_job" };
  const job = getServiceJob(input.jobId);
  if (!job) return { ok: false as const, error: "missing_job" };
  if (input.bytes.length > MAX_JOB_PHOTO_BYTES) return { ok: false as const, error: "too_large" };
  const count = jobPhotoCount(input.jobId);
  if (count >= MAX_JOB_PHOTOS) return { ok: false as const, error: "too_many" };
  const hash = sha256Of(input.bytes);
  const dup = getHomesteadDb()
    .prepare("SELECT * FROM job_photos WHERE job_id = ? AND sha256 = ? LIMIT 1")
    .get(input.jobId, hash) as Record<string, unknown> | undefined;
  if (dup) return { ok: true as const, photo: mapPhoto(dup), duplicate: true };
  const index = count + 1;
  const filename = `original-${String(index).padStart(3, "0")}.${input.sniffed.ext}`;
  const { year, month } = panamaParts(new Date(job.createdAt || Date.now()));
  const relativePath = join("jobs", year, month, input.jobId, "originals", filename).replaceAll("\\", "/");
  const abs = resolve(join(homesteadDataDir(), relativePath));
  const root = resolve(jobPhotoRoot(input.jobId, job.createdAt));
  if (!isInside(root, abs)) return { ok: false as const, error: "path" };
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, input.bytes);
  const now = nowIso();
  const info = getHomesteadDb()
    .prepare(
      `INSERT INTO job_photos
        (job_id, original_relpath, sha256, byte_size, mime, role, marketing_usage_approved, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(
      input.jobId,
      relativePath,
      hash,
      input.bytes.length,
      input.sniffed.mime,
      input.role || "WORK",
      now,
      (input.actor || "telegram").slice(0, 40),
    );
  bumpPhotoCount(input.jobId, count + 1);
  getHomesteadDb()
    .prepare(
      "INSERT INTO ops_audit (action, actor, entity_type, entity_id, detail, created_at) VALUES ('JOB_PHOTO_ADDED', ?, 'job', ?, ?, ?)",
    )
    .run((input.actor || "telegram").slice(0, 40), input.jobId, filename, now);
  const photo = getHomesteadDb()
    .prepare("SELECT * FROM job_photos WHERE id = ?")
    .get(Number(info.lastInsertRowid)) as Record<string, unknown>;
  return { ok: true as const, photo: mapPhoto(photo), duplicate: false };
}

export function absoluteJobPhotoPath(photo: JobPhoto) {
  return resolve(join(homesteadDataDir(), photo.originalRelpath));
}

export function jobHasBeforeAfter(jobId: string) {
  const photos = listJobPhotos(jobId);
  return photos.some((photo) => photo.role === "BEFORE") && photos.some((photo) => photo.role === "AFTER");
}
