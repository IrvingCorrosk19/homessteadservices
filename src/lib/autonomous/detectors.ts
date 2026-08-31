import { businessYmd } from "@/lib/appointment-time";
import { outboxSnapshot } from "@/lib/automation-outbox";
import { getHomesteadDb } from "@/lib/service-requests";
import { listAgenda, listSlaDue, panamaToday } from "@/lib/ops-store";
import { getServiceRequirements } from "@/lib/service-requirements";
import { countPhotosJson } from "@/lib/concierge/playbook-engine";
import { listActiveSignals, resolveSignal } from "@/lib/autonomous/signal-store";
import { autonomousConfig } from "@/lib/autonomous/config";
import { autonomousNow } from "@/lib/autonomous/clock";
import type { SignalCandidate } from "@/lib/autonomous/types";

function hoursOpen(createdAt: string): number {
  const ms = autonomousNow().getTime() - Date.parse(createdAt);
  return Math.max(0, Math.round(ms / 3600000));
}

function openStatusesSql() {
  return `('NEW','OPEN','PENDING','IN_PROGRESS','CONTACTED')`;
}

export function detectRequestAging(includeTest = false): SignalCandidate[] {
  const cfg = autonomousConfig();
  const db = getHomesteadDb();
  const testFilter = includeTest ? "" : "AND COALESCE(l.is_test, 0) = 0";
  const rows = db
    .prepare(
      `SELECT r.public_id, r.name, r.service, r.property, r.status, r.created_at, r.message
       FROM service_requests r
       LEFT JOIN revenue_leads l ON l.lead_id = r.public_id
       WHERE r.status IN ${openStatusesSql()}
         ${testFilter}
         AND datetime(r.created_at) < datetime('now', ?)
         AND NOT EXISTS (
           SELECT 1 FROM revenue_appointments a
           JOIN revenue_leads rl ON rl.lead_id = r.public_id
           WHERE a.lead_id = rl.lead_id
             AND a.status IN ('REQUESTED','PROPOSED','CONFIRMED','RESCHEDULED')
             AND a.date >= date('now')
         )
       ORDER BY r.created_at ASC
       LIMIT ?`,
    )
    .all(`-${cfg.requestAgingHours} hours`, cfg.maxSignalsPerScan) as Array<{
    public_id: string;
    name: string;
    service: string;
    property: string;
    status: string;
    created_at: string;
    message: string;
  }>;

  const now = autonomousNow().toISOString();
  return rows.map((r) => {
    const ageH = hoursOpen(r.created_at);
    return {
      signalType: "REQUEST_AGING" as const,
      source: "database:service_requests",
      entityType: "request",
      entityId: r.public_id,
      requestId: r.public_id,
      detectedAt: now,
      businessTime: r.created_at,
      severity: ageH >= cfg.requestAgingHours * 2 ? "HIGH" : "NORMAL",
      priority: Math.max(10, 100 - ageH),
      facts: {
        requestId: r.public_id,
        ageHours: ageH,
        status: r.status,
        service: r.service,
        location: r.property || "",
        customerName: r.name,
      },
      evidence: { createdAt: r.created_at, messagePreview: (r.message || "").slice(0, 200) },
      deduplicationKey: `REQUEST_AGING:${r.public_id}`,
      stateVersion: `${r.status}:day${Math.floor(ageH / 24)}`,
      recommendedAction: "Revisar solicitud y definir siguiente paso",
      reasoningSummary: `Solicitud abierta ${ageH} h sin próxima visita agendada`,
      deliveryMode: ageH >= cfg.requestAgingHours * 2 ? "IMMEDIATE" : "DIGEST",
    };
  });
}

export function detectRequestWithoutNextStep(includeTest = false): SignalCandidate[] {
  const db = getHomesteadDb();
  const testFilter = includeTest ? "" : "AND COALESCE(l.is_test, 0) = 0";
  const rows = db
    .prepare(
      `SELECT r.public_id, r.name, r.service, r.property, r.status, r.created_at
       FROM service_requests r
       LEFT JOIN revenue_leads l ON l.lead_id = r.public_id
       WHERE r.status IN ('NEW','OPEN','PENDING','IN_PROGRESS')
         ${testFilter}
         AND NOT EXISTS (
           SELECT 1 FROM revenue_appointments a
           JOIN revenue_leads rl ON rl.lead_id = r.public_id
           WHERE a.lead_id = rl.lead_id
             AND a.status IN ('REQUESTED','PROPOSED','CONFIRMED','RESCHEDULED')
         )
         AND COALESCE(l.pipeline_stage, '') NOT IN ('WAITING_CUSTOMER','SNOOZED','DISMISSED')
       LIMIT 100`,
    )
    .all() as Array<{
    public_id: string;
    name: string;
    service: string;
    property: string;
    status: string;
    created_at: string;
  }>;

  const now = autonomousNow().toISOString();
  return rows.map((r) => ({
    signalType: "REQUEST_WITHOUT_NEXT_STEP" as const,
    source: "database:service_requests",
    entityType: "request",
    entityId: r.public_id,
    requestId: r.public_id,
    detectedAt: now,
    severity: "NORMAL" as const,
    priority: 60,
    facts: {
      requestId: r.public_id,
      status: r.status,
      service: r.service,
      location: r.property || "",
    },
    evidence: { createdAt: r.created_at },
    deduplicationKey: `REQUEST_WITHOUT_NEXT_STEP:${r.public_id}`,
    stateVersion: r.status,
    recommendedAction: "Agendar visita, contactar cliente o revisar estado",
    reasoningSummary: "Solicitud activa sin cita ni siguiente paso definido",
    deliveryMode: "DIGEST" as const,
  }));
}

export function detectUpcomingAppointments(includeTest = false): SignalCandidate[] {
  const cfg = autonomousConfig();
  const tomorrow = businessYmd(autonomousNow(), 1);
  const today = panamaToday().ymd;
  const agendaTomorrow = listAgenda(tomorrow, includeTest);
  const agendaToday = listAgenda(today, includeTest);
  const now = autonomousNow().toISOString();
  const out: SignalCandidate[] = [];

  for (const appt of agendaTomorrow) {
    out.push({
      signalType: "APPOINTMENT_UPCOMING",
      source: "calendar:revenue_appointments",
      entityType: "appointment",
      entityId: appt.appointmentId,
      appointmentId: appt.appointmentId,
      requestId: appt.leadId || undefined,
      detectedAt: now,
      businessTime: `${tomorrow}T${appt.startTime}`,
      severity: "NORMAL",
      priority: 40,
      facts: {
        appointmentId: appt.appointmentId,
        date: tomorrow,
        time: appt.startTime,
        service: appt.serviceLabel || appt.service || "",
        customerName: appt.customerName || "",
        location: appt.zone || "",
      },
      evidence: { leadId: appt.leadId },
      deduplicationKey: `APPOINTMENT_UPCOMING:${appt.appointmentId}:${tomorrow}`,
      stateVersion: `${appt.date}:${appt.startTime}:${appt.status}`,
      recommendedAction: "Preparar visita de mañana",
      reasoningSummary: `Visita mañana ${appt.startTime}`,
      deliveryMode: "DIGEST",
    });
  }

  for (const appt of agendaToday) {
    out.push({
      signalType: "APPOINTMENT_TODAY",
      source: "calendar:revenue_appointments",
      entityType: "appointment",
      entityId: appt.appointmentId,
      appointmentId: appt.appointmentId,
      requestId: appt.leadId || undefined,
      detectedAt: now,
      businessTime: `${today}T${appt.startTime}`,
      severity: "HIGH",
      priority: 20,
      facts: {
        appointmentId: appt.appointmentId,
        date: today,
        time: appt.startTime,
        service: appt.serviceLabel || appt.service || "",
        customerName: appt.customerName || "",
      },
      evidence: { leadId: appt.leadId },
      deduplicationKey: `APPOINTMENT_TODAY:${appt.appointmentId}:${today}`,
      stateVersion: `${appt.date}:${appt.startTime}:${appt.status}`,
      recommendedAction: "Confirmar preparación para visita de hoy",
      reasoningSummary: `Visita hoy ${appt.startTime}`,
      deliveryMode: "IMMEDIATE",
    });
  }

  void cfg.upcomingWindowHours;
  return out;
}

export function detectCustomerWaiting(includeTest = false): SignalCandidate[] {
  const now = autonomousNow().toISOString();
  const out: SignalCandidate[] = [];
  for (const row of listSlaDue("first")) {
    if (!includeTest && row.is_test) continue;
    const minutesWaiting = Math.round((autonomousNow().getTime() - Date.parse(row.created_at)) / 60000);
    out.push({
      signalType: "CUSTOMER_WAITING",
      source: "database:sla",
      entityType: "request",
      entityId: row.public_id,
      requestId: row.public_id,
      detectedAt: now,
      severity: "HIGH",
      priority: 15,
      facts: {
        requestId: row.public_id,
        slaMinutes: minutesWaiting,
        service: row.service,
      },
      evidence: { createdAt: row.created_at, phone: row.phone ? "***" : "" },
      deduplicationKey: `CUSTOMER_WAITING:${row.public_id}`,
      stateVersion: `${row.public_id}:sla${Math.floor(minutesWaiting / 15)}`,
      recommendedAction: "Contactar cliente — SLA de primera respuesta",
      reasoningSummary: `${minutesWaiting} min sin atención humana registrada`,
      deliveryMode: "IMMEDIATE",
    });
  }
  return out;
}

export function detectAutomationFailures(): SignalCandidate[] {
  const snap = outboxSnapshot();
  if (snap.failed <= 0) return [];
  const db = getHomesteadDb();
  const rows = db
    .prepare(
      `SELECT event_id, event_type, correlation_id, last_error, attempts, updated_at
       FROM automation_outbox WHERE status = 'FAILED'
       ORDER BY updated_at DESC LIMIT 20`,
    )
    .all() as Array<{
    event_id: string;
    event_type: string;
    correlation_id: string;
    last_error: string;
    attempts: number;
    updated_at: string;
  }>;

  const now = autonomousNow().toISOString();
  return rows.map((r) => ({
    signalType: "AUTOMATION_FAILURE" as const,
    source: "outbox:automation_outbox",
    entityType: "outbox_event",
    entityId: r.event_id,
    detectedAt: now,
    severity: r.attempts >= 5 ? "CRITICAL" : "HIGH",
    priority: 5,
    facts: {
      eventType: r.event_type,
      correlationId: r.correlation_id,
      attempts: r.attempts,
      failedCount: snap.failed,
    },
    evidence: { lastError: (r.last_error || "").slice(0, 300), updatedAt: r.updated_at },
    deduplicationKey: `AUTOMATION_FAILURE:${r.event_id}`,
    stateVersion: `${r.attempts}:${r.updated_at}`,
    recommendedAction: "Revisar automatización fallida y reintentar o corregir",
    reasoningSummary: `Automatización ${r.event_type} falló (${r.attempts} intentos)`,
    deliveryMode: "IMMEDIATE" as const,
  }));
}

export function detectCalendarConflicts(includeTest = false): SignalCandidate[] {
  const db = getHomesteadDb();
  const testJoin = includeTest
    ? ""
    : `AND NOT EXISTS (SELECT 1 FROM revenue_leads l WHERE l.lead_id = a.lead_id AND l.is_test = 1)`;
  const rows = db
    .prepare(
      `SELECT a.date, a.start_time, COUNT(*) AS cnt,
              GROUP_CONCAT(a.appointment_id) AS ids
       FROM revenue_appointments a
       WHERE a.status IN ('REQUESTED','PROPOSED','CONFIRMED','RESCHEDULED')
         AND a.date >= date('now')
         ${testJoin}
       GROUP BY a.date, a.start_time
       HAVING cnt > 1
       LIMIT 20`,
    )
    .all() as Array<{ date: string; start_time: string; cnt: number; ids: string }>;

  const now = autonomousNow().toISOString();
  return rows.map((r) => ({
    signalType: "APPOINTMENT_CONFLICT" as const,
    source: "calendar:overlap_detection",
    entityType: "calendar_slot",
    entityId: `${r.date}:${r.start_time}`,
    detectedAt: now,
    businessTime: `${r.date}T${r.start_time}`,
    severity: "CRITICAL",
    priority: 1,
    facts: { date: r.date, time: r.start_time, overlapCount: r.cnt },
    evidence: { appointmentIds: r.ids },
    deduplicationKey: `APPOINTMENT_CONFLICT:${r.date}:${r.start_time}`,
    stateVersion: String(r.cnt),
    recommendedAction: "Revisar doble reserva en calendario — no reprogramar automáticamente",
    reasoningSummary: `${r.cnt} citas activas en ${r.date} ${r.start_time}`,
    deliveryMode: "IMMEDIATE" as const,
  }));
}

export function detectMissingRequirementsBeforeVisit(includeTest = false): SignalCandidate[] {
  const cfg = autonomousConfig();
  const db = getHomesteadDb();
  const horizon = businessYmd(autonomousNow(), 1);
  const testFilter = includeTest ? "" : "AND COALESCE(l.is_test, 0) = 0";
  const rows = db
    .prepare(
      `SELECT a.appointment_id, a.date, a.start_time, a.lead_id,
              r.public_id, r.service, r.message, r.photos_json, r.facts_json, r.property
       FROM revenue_appointments a
       JOIN revenue_leads l ON l.lead_id = a.lead_id
       JOIN service_requests r ON r.public_id = l.lead_id
       WHERE a.status IN ('REQUESTED','PROPOSED','CONFIRMED','RESCHEDULED')
         AND a.date <= ?
         AND a.date >= date('now')
         ${testFilter}
       LIMIT 50`,
    )
    .all(horizon) as Array<{
    appointment_id: string;
    date: string;
    start_time: string;
    lead_id: string;
    public_id: string;
    service: string;
    message: string;
    photos_json: string;
    facts_json: string;
    property: string;
  }>;

  const now = autonomousNow().toISOString();
  const out: SignalCandidate[] = [];
  for (const row of rows) {
    const req = getServiceRequirements({
      service: row.service,
      message: row.message,
    });
    if (!req.requiredPhotos || !req.blocksRequestCompletion) continue;
    const photoCount = countPhotosJson(row.photos_json);
    if (photoCount >= req.minimumValidPhotos) continue;
    out.push({
      signalType: "REQUIREMENT_MISSING_BEFORE_VISIT",
      source: "policy:service_requirements",
      entityType: "appointment",
      entityId: row.appointment_id,
      appointmentId: row.appointment_id,
      requestId: row.public_id,
      detectedAt: now,
      businessTime: `${row.date}T${row.start_time}`,
      severity: "HIGH",
      priority: 25,
      facts: {
        requestId: row.public_id,
        appointmentId: row.appointment_id,
        visitDate: row.date,
        visitTime: row.start_time,
        requiredPhotos: req.minimumValidPhotos,
        currentPhotos: photoCount,
        service: req.label,
        location: row.property || "",
      },
      evidence: { intentId: req.intentId, codeIncomplete: req.codeIncomplete },
      deduplicationKey: `REQUIREMENT_MISSING:${row.appointment_id}`,
      stateVersion: `${photoCount}/${req.minimumValidPhotos}`,
      recommendedAction: req.humanGuidance || "Solicitar evidencia faltante antes de la visita",
      reasoningSummary: `Faltan ${req.minimumValidPhotos - photoCount} foto(s) requerida(s) antes de visita`,
      deliveryMode: "IMMEDIATE",
    });
  }
  void cfg.preVisitWindowHours;
  return out;
}

export function runAllSignalDetectors(includeTest = false): SignalCandidate[] {
  return [
    ...detectRequestAging(includeTest),
    ...detectRequestWithoutNextStep(includeTest),
    ...detectUpcomingAppointments(includeTest),
    ...detectCustomerWaiting(includeTest),
    ...detectAutomationFailures(),
    ...detectCalendarConflicts(includeTest),
    ...detectMissingRequirementsBeforeVisit(includeTest),
  ];
}

export function resolveStaleSignals(includeTest = false) {
  const db = getHomesteadDb();
  const testFilter = includeTest ? "" : "AND COALESCE(l.is_test, 0) = 0";

  // Resolve REQUEST_AGING when appointment booked or request closed
  db.prepare(
    `UPDATE operational_signals SET status = 'RESOLVED', resolved_at = datetime('now'), updated_at = datetime('now')
     WHERE signal_type = 'REQUEST_AGING' AND status NOT IN ('RESOLVED','EXPIRED','SUPERSEDED')
       AND (
         request_id NOT IN (SELECT public_id FROM service_requests WHERE status IN ${openStatusesSql()})
         OR EXISTS (
           SELECT 1 FROM revenue_appointments a
           JOIN revenue_leads rl ON rl.lead_id = operational_signals.request_id
           WHERE a.lead_id = rl.lead_id
             AND a.status IN ('REQUESTED','PROPOSED','CONFIRMED','RESCHEDULED')
             AND a.date >= date('now')
         )
       )`,
  ).run();

  db.prepare(
    `UPDATE operational_signals SET status = 'RESOLVED', resolved_at = datetime('now'), updated_at = datetime('now')
     WHERE signal_type = 'REQUEST_WITHOUT_NEXT_STEP' AND status NOT IN ('RESOLVED','EXPIRED','SUPERSEDED')
       AND request_id IN (
         SELECT r.public_id FROM service_requests r
         JOIN revenue_leads rl ON rl.lead_id = r.public_id
         JOIN revenue_appointments a ON a.lead_id = rl.lead_id
         WHERE a.status IN ('REQUESTED','PROPOSED','CONFIRMED','RESCHEDULED')
       )`,
  ).run();

  db.prepare(
    `UPDATE operational_signals SET status = 'RESOLVED', resolved_at = datetime('now'), updated_at = datetime('now')
     WHERE signal_type = 'AUTOMATION_FAILURE' AND status NOT IN ('RESOLVED','EXPIRED','SUPERSEDED')
       AND entity_id NOT IN (SELECT event_id FROM automation_outbox WHERE status = 'FAILED')`,
  ).run();

  db.prepare(
    `UPDATE operational_signals SET status = 'RESOLVED', resolved_at = datetime('now'), updated_at = datetime('now')
     WHERE signal_type = 'APPOINTMENT_CONFLICT' AND status NOT IN ('RESOLVED','EXPIRED','SUPERSEDED')
       AND deduplication_key NOT IN (
         SELECT 'APPOINTMENT_CONFLICT:' || a.date || ':' || a.start_time
         FROM revenue_appointments a
         WHERE a.status IN ('REQUESTED','PROPOSED','CONFIRMED','RESCHEDULED')
         GROUP BY a.date, a.start_time HAVING COUNT(*) > 1
       )`,
  ).run();

  db.prepare(
    `UPDATE operational_signals SET status = 'RESOLVED', resolved_at = datetime('now'), updated_at = datetime('now')
     WHERE signal_type = 'CUSTOMER_WAITING' AND status NOT IN ('RESOLVED','EXPIRED','SUPERSEDED')
       AND request_id IN (
         SELECT public_id FROM service_requests WHERE status NOT IN ('NEW','OPEN')
       )`,
  ).run();

  // Resolve appointment-related signals when appointment cancelled/completed or date changed
  db.prepare(
    `UPDATE operational_signals SET status = 'RESOLVED', resolved_at = datetime('now'), updated_at = datetime('now')
     WHERE signal_type IN ('APPOINTMENT_UPCOMING','APPOINTMENT_TODAY','REQUIREMENT_MISSING_BEFORE_VISIT')
       AND status NOT IN ('RESOLVED','EXPIRED','SUPERSEDED')
       AND appointment_id IS NOT NULL
       AND (
         NOT EXISTS (
           SELECT 1 FROM revenue_appointments a
           WHERE a.appointment_id = operational_signals.appointment_id
             AND a.status IN ('REQUESTED','PROPOSED','CONFIRMED','RESCHEDULED')
         )
         OR NOT EXISTS (
           SELECT 1 FROM revenue_appointments a
           WHERE a.appointment_id = operational_signals.appointment_id
             AND a.status IN ('REQUESTED','PROPOSED','CONFIRMED','RESCHEDULED')
             AND (
               signal_type = 'APPOINTMENT_TODAY' AND a.date = date('now')
               OR signal_type = 'APPOINTMENT_UPCOMING' AND a.date = date('now', '+1 day')
               OR signal_type = 'REQUIREMENT_MISSING_BEFORE_VISIT'
             )
         )
       )`,
  ).run();


  void testFilter;
}

/** Resolve active signals whose deterministic condition no longer holds. */
export function reconcileSignalsWithDetectors(includeTest = false) {
  const active = listActiveSignals(500);
  const currentKeys = new Set(runAllSignalDetectors(includeTest).map((c) => c.deduplicationKey));
  for (const sig of active) {
    if (!currentKeys.has(sig.deduplicationKey)) {
      resolveSignal(sig.signalId, "condition_cleared");
    }
  }
}
