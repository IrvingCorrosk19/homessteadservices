import { readFileSync } from "fs";
import { createContentJob, storeOriginal, updateJob } from "@/lib/content-catalog";
import { sniffImage } from "@/lib/photos";
import { getHomesteadDb } from "@/lib/service-requests";
import { JOB_ID_PATTERN } from "@/lib/job-config";
import { attachContentJob, getServiceJob } from "@/lib/job-store";
import { absoluteJobPhotoPath, jobHasBeforeAfter, listJobPhotos } from "@/lib/job-photos";

function sanitizeContentContext(input: { serviceLabel: string; zone: string; notes: string }) {
  const zone = input.zone.replace(/\d{2,}/g, " ").replace(/\s+/g, " ").trim();
  const notes = input.notes
    .replace(/\b[\w.+-]+@[\w.-]+\.\w+\b/g, "")
    .replace(/\+?\d[\d\s\-()]{7,}\d/g, "")
    .replace(/\b(HS|HA|HJ)-\d{4}-\d{6}\b/g, "")
    .replace(/\b(apto|apartamento|casa|#)\s*\d+[a-z]?\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
  return {
    description: [
      `Trabajo de ${input.serviceLabel.toLowerCase()} completado.`,
      zone ? `Zona general: ${zone}.` : "",
      notes,
      "No incluir nombre, teléfono, dirección exacta ni datos del cliente.",
    ]
      .filter(Boolean)
      .join(" "),
    zone,
  };
}

export function createContentFromJob(input: { jobId: string; chatId: string; userId: string; actor?: string }) {
  if (!JOB_ID_PATTERN.test(input.jobId)) return { ok: false as const, reason: "invalid_job", contentId: "" };
  const job = getServiceJob(input.jobId);
  if (!job) return { ok: false as const, reason: "missing_job", contentId: "" };
  if (job.status !== "COMPLETED") return { ok: false as const, reason: "not_completed", contentId: "" };
  if (job.photoCount < 1) return { ok: false as const, reason: "no_photos", contentId: "" };
  if (!job.marketingUsageApproved) return { ok: false as const, reason: "marketing_not_approved", contentId: "" };
  if (job.sourceContentId) return { ok: true as const, reason: "existing", contentId: job.sourceContentId };
  const photos = listJobPhotos(job.jobId);
  if (!photos.length) return { ok: false as const, reason: "no_photos", contentId: "" };
  const content = createContentJob({ chatId: input.chatId, userId: input.userId });
  const ctx = sanitizeContentContext({
    serviceLabel: job.serviceLabel,
    zone: job.zone,
    notes: job.scope,
  });
  const beforeAfter = jobHasBeforeAfter(job.jobId);
  updateJob(content.publicId, {
    description: ctx.description,
    serviceType: job.service,
    status: "RECEIVING",
    mixType: "trabajo",
    contentType: "COMPLETED_WORK",
    format: beforeAfter ? "BEFORE_AFTER" : "SINGLE_IMAGE",
  });
  getHomesteadDb().prepare("UPDATE content_jobs SET source_job_id = ? WHERE public_id = ?").run(job.jobId, content.publicId);
  let stored = 0;
  for (const photo of photos) {
    const bytes = readFileSync(absoluteJobPhotoPath(photo));
    const sniffed = sniffImage(bytes, bytes.length);
    if (!sniffed) continue;
    const result = storeOriginal({
      job: content,
      bytes,
      mime: sniffed.mime,
      ext: sniffed.ext,
    });
    if (result.ok) stored += 1;
  }
  if (!stored) return { ok: false as const, reason: "copy_failed", contentId: content.publicId };
  attachContentJob(job.jobId, content.publicId);
  getHomesteadDb()
    .prepare(
      "INSERT INTO ops_audit (action, actor, entity_type, entity_id, detail, created_at) VALUES ('JOB_CONTENT_REQUESTED', ?, 'job', ?, ?, ?)",
    )
    .run((input.actor || "telegram").slice(0, 40), job.jobId, content.publicId, new Date().toISOString());
  return { ok: true as const, reason: "created", contentId: content.publicId, photoCount: stored };
}
