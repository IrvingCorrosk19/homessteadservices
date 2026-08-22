import { NextResponse } from "next/server";
import { outboxSnapshot } from "@/lib/automation-outbox";
import { inspectTelegramWebhook } from "@/lib/content-telegram";

export const runtime = "nodejs";

export async function GET() {
  const box = outboxSnapshot();
  const webhook = await inspectTelegramWebhook({ repair: false }).catch(() => null);
  return NextResponse.json({
    ok: true,
    outbox: {
      pending: box.pending,
      failed: box.failed,
      delivered: box.delivered,
      oldestPendingAt: box.oldestPendingAt,
      oldestPendingAgeMs: box.oldestPendingAgeMs,
      lastDispatchOkAt: box.lastDispatchOkAt,
      lastSchedulerAt: box.lastSchedulerAt,
    },
    telegram: webhook
      ? {
          match: webhook.match,
          expectedHost: "n8n.autonomousflow.lat",
          pending: webhook.pending,
          lastError: webhook.lastError,
        }
      : { match: false },
  });
}
