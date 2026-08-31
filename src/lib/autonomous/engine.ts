import { setEngineState } from "@/lib/automation-outbox";
import { panamaParts } from "@/lib/ops-config";
import { autonomousConfig, isAutonomousEnabled } from "@/lib/autonomous/config";
import { autonomousNow } from "@/lib/autonomous/clock";
import { runAllSignalDetectors, resolveStaleSignals, reconcileSignalsWithDetectors } from "@/lib/autonomous/detectors";
import { enrichSignalWithAi } from "@/lib/autonomous/analyzer";
import { routeSignalNotification } from "@/lib/autonomous/notification-router";
import { buildDailyOperationsBrief, formatBriefText } from "@/lib/autonomous/brief";
import {
  upsertOperationalSignal,
  updateSignalAssessment,
  incrementAutonomousMetric,
  listActiveSignals,
} from "@/lib/autonomous/signal-store";
import { enqueueOutbox, getOutboxByIdempotency } from "@/lib/automation-outbox";
import { adminChatIds } from "@/lib/content-telegram";
import { getHomesteadDb } from "@/lib/service-requests";

export type AutonomousScanResult = {
  detected: number;
  upserted: number;
  enriched: number;
  notified: number;
  resolved: number;
  briefEnqueued: number;
  dryRun: boolean;
};

export async function runAutonomousOpsScan(includeTest = false): Promise<AutonomousScanResult> {
  const cfg = autonomousConfig();
  const result: AutonomousScanResult = {
    detected: 0,
    upserted: 0,
    enriched: 0,
    notified: 0,
    resolved: 0,
    briefEnqueued: 0,
    dryRun: cfg.dryRun,
  };

  if (!isAutonomousEnabled()) return result;

  resolveStaleSignals(includeTest);
  reconcileSignalsWithDetectors(includeTest);
  incrementAutonomousMetric("autonomous_scan_runs");

  const candidates = runAllSignalDetectors(includeTest);
  result.detected = candidates.length;

  let enrichBudget = cfg.maxAiEnrichmentsPerScan;
  for (const candidate of candidates) {
    const signal = upsertOperationalSignal(candidate);
    result.upserted += 1;
    incrementAutonomousMetric(`autonomous_signal_${candidate.signalType}`);

    if (enrichBudget > 0) {
      const analysis = await enrichSignalWithAi(signal);
      updateSignalAssessment(signal.signalId, {
        aiAssessment: { ...analysis, enrichedAt: autonomousNow().toISOString() },
        recommendedAction: analysis.recommendedAction,
        reasoningSummary: analysis.reasoningSummary,
        status: "ACTIONABLE",
      });
      enrichBudget -= 1;
      result.enriched += 1;
    } else {
      updateSignalAssessment(signal.signalId, { status: "ACTIONABLE" });
    }

    const refreshed = listActiveSignals(500).find((s) => s.signalId === signal.signalId) || signal;
    const routed = routeSignalNotification(refreshed);
    if (routed.enqueued) result.notified += 1;
  }

  result.briefEnqueued = enqueueScheduledBriefs();
  setEngineState("last_autonomous_scan_at", autonomousNow().toISOString());
  return result;
}

function enqueueScheduledBriefs(): number {
  const cfg = autonomousConfig();
  if (cfg.dryRun || !cfg.notificationsEnabled) return 0;
  const parts = panamaParts(autonomousNow());
  let n = 0;

  if (parts.hour === cfg.morningBriefHour) {
    n += enqueueBriefOutbox("morning", parts.ymd);
  }
  if (parts.hour === cfg.endOfDayBriefHour) {
    n += enqueueBriefOutbox("end_of_day", parts.ymd);
  }
  return n;
}

function enqueueBriefOutbox(kind: "morning" | "end_of_day", ymd: string): number {
  const key = `autonomous.brief.${kind}:${ymd}`;
  if (getOutboxByIdempotency(key)) return 0;
  const chats = adminChatIds("daily_brief");
  if (!chats.length) return 0;
  const brief = buildDailyOperationsBrief(kind === "morning" ? "morning" : "end_of_day");
  enqueueOutbox(getHomesteadDb(), {
    eventType: "autonomous.brief.ready",
    correlationId: ymd,
    idempotencyKey: key,
    data: {
      event: "ops.telegram.alert",
      priority: "INFO",
      text: formatBriefText(brief),
      keyboard: [[{ text: "🏠 Centro de Operaciones", url: `${(process.env.NEXT_PUBLIC_SITE_URL || "https://homestead.lat").replace(/\/$/, "")}/admin` }]],
      chats,
      deliveryKind: "daily_brief",
    },
  });
  incrementAutonomousMetric(`autonomous_brief_${kind}`);
  return 1;
}

export function getAutonomousExecutiveView() {
  const brief = buildDailyOperationsBrief("daily");
  const signals = listActiveSignals(10);
  return {
    visitsToday: brief.todayAppointments,
    openRequests: brief.openRequests,
    needsAttention: brief.needsAttention,
    automationFailures: brief.failedAutomations,
    activeSignals: brief.activeSignals,
    highlights: signals.slice(0, 5).map((s) => ({
      signalId: s.signalId,
      type: s.signalType,
      severity: s.severity,
      summary: s.reasoningSummary,
      requestId: s.requestId,
      href: s.requestId ? `/admin/solicitudes/${s.requestId}` : "/admin",
    })),
  };
}
