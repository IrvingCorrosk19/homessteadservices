import { NextResponse } from "next/server";
import { verifyInternalHomesteadRequest } from "@/lib/internal-auth";
import {
  beginProcessLock,
  getJobByPublicId,
  latestVersion,
} from "@/lib/content-catalog";
import {
  recoverLastMultiPhotoJob,
  snapshotBatchVersions,
  batchReceivedText,
  batchKeyboard,
} from "@/lib/content-photo-batch";
import { processContentJob } from "@/lib/content-process";
import { sendTelegramMessage } from "@/lib/content-telegram";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (!verifyInternalHomesteadRequest(request, payload)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (payload.confirm !== "RECOVER" || payload.source === "live") {
    return NextResponse.json({ ok: false, error: "recover_confirm_required" }, { status: 403 });
  }
  const recovered = recoverLastMultiPhotoJob();
  if (!recovered.ok) {
    return NextResponse.json({ ok: false, error: recovered.reason }, { status: 409 });
  }
  const process = payload.process !== false;
  const ids = recovered.recovered;
  if (process) {
    void (async () => {
      for (const id of ids) {
        const job = getJobByPublicId(id);
        if (!job || job.status === "PUBLISHED" || job.status === "SCHEDULED") continue;
        if (latestVersion(id) && job.status === "AWAITING_APPROVAL") continue;
        if (!beginProcessLock(id)) continue;
        await processContentJob(id, "full");
      }
      const first = ids[0] ? getJobByPublicId(ids[0]) : null;
      const batchId = recovered.batchId || first?.photoBatchId || "";
      if (batchId) snapshotBatchVersions(batchId);
      if (first?.telegramChatId && ids.length) {
        await sendTelegramMessage({
          chatId: first.telegramChatId,
          text: batchReceivedText({
            publicIds: ids,
            batchId: batchId || "",
            album: true,
            missing: recovered.missing,
          }),
          keyboard: batchId ? batchKeyboard(batchId, ids) : undefined,
        });
      }
    })();
  }
  return NextResponse.json({
    ok: true,
    published: recovered.published,
    recovered: ids,
    missing: recovered.missing,
    source: recovered.source,
    processed: process,
    batchId: recovered.batchId || "",
  });
}
