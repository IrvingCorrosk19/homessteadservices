import { commandCenterSummary, listAgenda } from "@/lib/ops-store";
import { businessYmd } from "@/lib/appointment-time";
import { getBusinessBriefCounts, getAttentionItems } from "@/lib/analytics-service";
import { outboxSnapshot } from "@/lib/automation-outbox";
import { listActiveSignals } from "@/lib/autonomous/signal-store";
import { panamaParts } from "@/lib/ops-config";
import { autonomousNow } from "@/lib/autonomous/clock";
import type { OperationalSignal } from "@/lib/autonomous/types";

export type DailyOperationsBrief = {
  kind: "morning" | "end_of_day" | "daily";
  generatedAt: string;
  timezone: string;
  todayAppointments: number;
  tomorrowAppointments: number;
  openRequests: number;
  needsAttention: number;
  activeSignals: number;
  failedAutomations: number;
  signalHighlights: Array<{ type: string; summary: string; requestId?: string }>;
  lines: string[];
};

export function buildDailyOperationsBrief(kind: DailyOperationsBrief["kind"] = "daily"): DailyOperationsBrief {
  const snap = commandCenterSummary(false);
  const counts = getBusinessBriefCounts(false);
  const attention = getAttentionItems(false, 10);
  const failed = outboxSnapshot().failed;
  const signals = listActiveSignals(20);
  const parts = panamaParts(autonomousNow());
  const tomorrowCount = listAgenda(businessYmd(autonomousNow(), 1), false).length;

  const highlights = signals.slice(0, 5).map((s: OperationalSignal) => ({
    type: s.signalType,
    summary: s.reasoningSummary || s.recommendedAction || s.signalType,
    requestId: s.requestId,
  }));

  const lines =
    kind === "end_of_day"
      ? [
          "🏠 HOMESTEAD AI — FIN DEL DÍA",
          "",
          `Solicitudes nuevas hoy: ${counts.requestsToday}`,
          `Citas hoy: ${counts.appointmentsToday}`,
          `Pendientes: ${counts.pendingRequests}`,
          `Señales activas: ${signals.length}`,
          failed ? `⚠️ Automatizaciones fallidas: ${failed}` : "",
          snap.rescue ? `Oportunidades abiertas: ${snap.rescue}` : "",
        ]
      : [
          "🏠 HOMESTEAD AI — HOY",
          "",
          `Visitas hoy: ${counts.appointmentsToday}`,
          `Solicitudes abiertas: ${counts.pendingRequests}`,
          `Requieren atención: ${attention.length}`,
          failed ? `Automatización fallida: ${failed}` : "",
          highlights.length ? `Alertas IA: ${highlights.length}` : "",
        ];

  return {
    kind,
    generatedAt: autonomousNow().toISOString(),
    timezone: parts.ymd,
    todayAppointments: counts.appointmentsToday,
    tomorrowAppointments: tomorrowCount,
    openRequests: counts.pendingRequests,
    needsAttention: attention.length,
    activeSignals: signals.length,
    failedAutomations: failed,
    signalHighlights: highlights,
    lines: lines.filter(Boolean),
  };
}

export function formatBriefText(brief: DailyOperationsBrief): string {
  return brief.lines.join("\n");
}
