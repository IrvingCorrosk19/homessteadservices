import { enqueueOutbox, getOutboxByIdempotency } from "@/lib/automation-outbox";
import { adminChatIds, type TelegramButton } from "@/lib/content-telegram";
import { getHomesteadDb } from "@/lib/service-requests";
import { isQuietHours, nextQuietEndIso } from "@/lib/ops-config";
import { autonomousConfig } from "@/lib/autonomous/config";
import { autonomousNow } from "@/lib/autonomous/clock";
import { evaluateAutonomousPolicy, policyDecisionAllowsNotify } from "@/lib/autonomous/policy-engine";
import { markSignalNotified, incrementAutonomousMetric } from "@/lib/autonomous/signal-store";
import { createAcknowledgeToken } from "@/lib/autonomous/action-tokens";
import type { OperationalSignal } from "@/lib/autonomous/types";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://homestead.lat").replace(/\/$/, "");

function signalIcon(type: string): string {
  if (type.includes("APPOINTMENT")) return "📅";
  if (type.includes("FAILURE") || type.includes("ERROR")) return "⚠️";
  if (type.includes("CONFLICT")) return "🚨";
  if (type.includes("REQUIREMENT")) return "📷";
  if (type.includes("WAITING")) return "⏱";
  return "🔔";
}

export function formatTelegramSignalMessage(signal: OperationalSignal): string {
  const icon = signalIcon(signal.signalType);
  const req = signal.requestId || signal.facts.requestId || "";
  const svc = signal.facts.service || "";
  const loc = signal.facts.location || "";
  const reason = signal.aiAssessment?.reasoningSummary || signal.reasoningSummary || "";
  const rec = signal.aiAssessment?.recommendedAction || signal.recommendedAction || "";
  return [
    `${icon} HOMESTEAD AI`,
    "",
    humanSignalTitle(signal.signalType),
    "",
    req ? String(req) : signal.entityId || "",
    svc ? String(svc) : "",
    loc ? String(loc) : "",
    "",
    reason ? `Motivo:\n${reason}` : "",
    rec ? `\nRecomendación:\n${rec}` : "",
  ]
    .filter((line, i, arr) => line !== "" || (i > 0 && arr[i - 1] !== ""))
    .join("\n")
    .trim();
}

function humanSignalTitle(type: string): string {
  const map: Record<string, string> = {
    REQUEST_AGING: "Solicitud requiere atención",
    REQUEST_WITHOUT_NEXT_STEP: "Sin siguiente paso definido",
    APPOINTMENT_UPCOMING: "Visita próxima",
    APPOINTMENT_TODAY: "Visita hoy",
    APPOINTMENT_CONFLICT: "Conflicto de calendario",
    CUSTOMER_WAITING: "Cliente esperando respuesta",
    AUTOMATION_FAILURE: "Automatización falló",
    REQUIREMENT_MISSING_BEFORE_VISIT: "Falta evidencia antes de visita",
  };
  return map[type] || "Alerta operativa";
}

export function buildSignalKeyboard(signal: OperationalSignal): TelegramButton[][] {
  const rows: TelegramButton[][] = [];
  if (signal.requestId) {
    rows.push([
      {
        text: "📋 Ver solicitud",
        url: `${SITE}/admin/solicitudes/${signal.requestId}`,
      },
    ]);
  }
  if (signal.appointmentId) {
    rows.push([{ text: "📅 Ver citas", url: `${SITE}/admin/citas` }]);
  }
  const ackToken = createAcknowledgeToken(signal);
  if (ackToken) {
    rows.push([{ text: "✅ Enterado", callback_data: `auto:ack:${ackToken}` }]);
  }
  rows.push([{ text: "🏠 Centro de Operaciones", url: `${SITE}/admin` }]);
  return rows;
}

export function shouldNotifySignal(signal: OperationalSignal): boolean {
  const cfg = autonomousConfig();
  if (!cfg.notificationsEnabled) return false;
  if (signal.cooldownUntil && Date.parse(signal.cooldownUntil) > autonomousNow().getTime()) {
    incrementAutonomousMetric("autonomous_notify_cooldown_skipped");
    return false;
  }
  if (signal.status === "ACKNOWLEDGED" && signal.deliveryMode !== "IMMEDIATE") return false;
  return true;
}

export function routeSignalNotification(signal: OperationalSignal): { enqueued: boolean; reason: string } {
  const cfg = autonomousConfig();
  const policy = evaluateAutonomousPolicy({
    signal,
    autonomyLevel: cfg.defaultAutonomyLevel,
    actionRisk: "READ",
    operatorAuthorized: true,
  });

  if (!policyDecisionAllowsNotify(policy.decision)) {
    return { enqueued: false, reason: policy.reason };
  }

  if (policy.deliveryMode === "LOG_ONLY") {
    return { enqueued: false, reason: "LOG_ONLY" };
  }

  if (!shouldNotifySignal(signal)) {
    return { enqueued: false, reason: "cooldown_or_ack" };
  }

  if (cfg.dryRun) {
    incrementAutonomousMetric("autonomous_notify_dry_run");
    return { enqueued: false, reason: "dry_run" };
  }

  const idempotencyKey = `autonomous.notify:${signal.deduplicationKey}:${signal.stateVersion}`;
  if (getOutboxByIdempotency(idempotencyKey)) {
    incrementAutonomousMetric("autonomous_notify_dedup_prevented");
    return { enqueued: false, reason: "already_enqueued" };
  }

  const chats = adminChatIds("requests");
  if (!chats.length) {
    return { enqueued: false, reason: "no_telegram_chats" };
  }

  const defer = policy.deliveryMode === "DIGEST" || (signal.severity === "LOW" && isQuietHours());
  const nextAttemptAt = defer ? nextQuietEndIso() : undefined;

  enqueueOutbox(getHomesteadDb(), {
    eventType: "autonomous.signal.notify",
    correlationId: signal.signalId,
    idempotencyKey,
    nextAttemptAt,
    data: {
      event: "ops.telegram.alert",
      priority: signal.severity === "CRITICAL" ? "CRITICAL" : signal.severity === "HIGH" ? "WARNING" : "INFO",
      text: formatTelegramSignalMessage(signal),
      keyboard: buildSignalKeyboard(signal),
      chats,
      deliveryKind: "requests",
      signalId: signal.signalId,
    },
  });

  const cooldownMs = cfg.notificationCooldownMinutes * 60_000;
  markSignalNotified(signal.signalId, new Date(autonomousNow().getTime() + cooldownMs).toISOString());
  incrementAutonomousMetric("autonomous_notify_enqueued");
  return { enqueued: true, reason: "enqueued" };
}

export function deliverAutonomousSignalToOpsCenter(signal: OperationalSignal) {
  return {
    signalId: signal.signalId,
    type: signal.signalType,
    severity: signal.severity,
    status: signal.status,
    title: humanSignalTitle(signal.signalType),
    summary: signal.aiAssessment?.reasoningSummary || signal.reasoningSummary,
    recommendation: signal.aiAssessment?.recommendedAction || signal.recommendedAction,
    facts: signal.facts,
    href: signal.requestId
      ? `/admin/solicitudes/${signal.requestId}`
      : signal.appointmentId
        ? "/admin/citas"
        : "/admin",
  };
}
