/**
 * Deterministic intent → tools (OpenAI optional for phrasing).
 * Counts always come from tools / Wave F.
 */
import type { TelegramOperator } from "@/lib/telegram-operators";
import { executeCopilotTool } from "@/lib/copilot/tools";
import type { CopilotContext } from "@/lib/copilot/session";
import { getBusinessBriefCounts, getAttentionItems } from "@/lib/analytics-service";

export type DeterministicPlan =
  | { kind: "tool"; name: string; args: Record<string, unknown> }
  | { kind: "brief" }
  | { kind: "select_customer"; customerId: number }
  | { kind: "none" };

export function matchDeterministicIntent(
  text: string,
  ctx: CopilotContext,
): DeterministicPlan {
  const t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim();

  if (/^#?\d+$/.test(t) && ctx.pendingDisambiguation?.length) {
    const n = Number(t.replace("#", ""));
    const pick = ctx.pendingDisambiguation.find((d) => d.id === n) || ctx.pendingDisambiguation[n - 1];
    if (pick) return { kind: "select_customer", customerId: pick.id };
  }

  if (
    /brief ejecutivo|resumen ejecutivo|como vamos hoy|como va homestead|como va el negocio|como estamos hoy/.test(
      t,
    ) ||
    t === "hoy" ||
    /como vamos\??$/.test(t)
  ) {
    return { kind: "brief" };
  }

  if (/que paso hoy|que pas[oó] hoy|resumen de hoy/.test(t)) {
    return { kind: "tool", name: "get_operations_summary", args: { range: "today" } };
  }

  if (
    /que (tenemos|tengo|hay) (pendiente|para manana|manana)|cuantas solicitudes.*(abiert|pendiente)/.test(
      t,
    )
  ) {
    if (/manana/.test(t)) {
      return { kind: "tool", name: "get_appointments", args: { day: "tomorrow" } };
    }
    return { kind: "tool", name: "get_pending_requests", args: { limit: 10 } };
  }

  if (/atrasad|sin atender.*(tiempo|horas)|mas tiempo sin/.test(t)) {
    return { kind: "tool", name: "get_overdue_requests", args: { limit: 10 } };
  }

  if (
    (/(la|el)\s+(primera|segunda|1)\b|cual es la primera/.test(t) || /^(esa|ese)\b/.test(t)) &&
    ctx.lastResultSet?.items?.length
  ) {
    const first = ctx.lastResultSet.items[0] as { appointmentId?: string; publicId?: string };
    if (ctx.lastResultSet.kind === "appointments" && first.appointmentId) {
      return { kind: "tool", name: "get_appointment", args: { appointmentId: first.appointmentId } };
    }
    if (ctx.lastResultSet.kind === "requests" && first.publicId) {
      return { kind: "tool", name: "get_request_detail", args: { publicId: first.publicId } };
    }
    if (ctx.customerId && /cliente|cuentame|historial/.test(t)) {
      return { kind: "tool", name: "get_customer", args: { customerId: ctx.customerId } };
    }
  }

  if (/por que.*(no avanza|atasc|stuck)/.test(t)) {
    const id = text.match(/\b(HS-\d{4}-\d{6})\b/i)?.[1];
    if (id) return { kind: "tool", name: "explain_request_stuck", args: { publicId: id.toUpperCase() } };
  }

  if (
    /que necesita (mi )?atencion|que tengo pendiente|prioridades|atencion primero|que debo (hacer|atender)/.test(
      t,
    )
  ) {
    return { kind: "tool", name: "get_attention_items", args: { limit: 10 } };
  }

  if (/citas (tenemos |hay )?(manana|mañana)/.test(t) || /cuantas citas.*manana/.test(t)) {
    return { kind: "tool", name: "get_appointments", args: { day: "tomorrow" } };
  }
  if (/citas (tenemos |hay )?hoy/.test(t) || /cuantas citas.*hoy/.test(t)) {
    return { kind: "tool", name: "get_appointments", args: { day: "today" } };
  }

  if (/solicitudes.*(pendiente|sin atender)|que solicitudes|leads? (por )?perder|oportunidades/.test(t)) {
    return { kind: "tool", name: "get_pending_requests", args: { limit: 10 } };
  }

  if (/clientes? molest|recovery|atencion urgente|insatisfech/.test(t)) {
    return { kind: "tool", name: "get_recovery_cases", args: { limit: 10 } };
  }

  if (/mantenimiento pendiente|retener|reactivar|a quien (debemos |hay que )?contactar/.test(t)) {
    return { kind: "tool", name: "get_retention_metrics", args: {} };
  }

  if (/de donde (vienen|llegaron)|fuentes?|attribution|atribu/.test(t)) {
    return { kind: "tool", name: "get_source_performance", args: { range: "7d" } };
  }

  if (/que servicio.*(mejor|mas)|servicio.*(solicitudes|funcionando)/.test(t)) {
    return { kind: "tool", name: "get_service_performance", args: { range: "7d" } };
  }

  if (/contenido|publicar|listo para revision/.test(t) && !/publica(r| el)/.test(t)) {
    return { kind: "tool", name: "get_content_pending", args: {} };
  }

  if (/ingresos?|cuanto.*(vend|factur|gan)|revenue|ltv|facturacion/.test(t)) {
    return { kind: "tool", name: "get_business_summary", args: { range: "30d" } };
  }

  const busca = t.match(/busca(?:r)?(?: a| al)?\s+(.+)$/) || t.match(/cliente\s+(.+)$/);
  if (busca) {
    return { kind: "tool", name: "search_customers", args: { query: busca[1].trim() } };
  }

  const hs = text.match(/\b(HS-\d{4}-\d{6})\b/i);
  if (hs) {
    return { kind: "tool", name: "get_request_detail", args: { publicId: hs[1].toUpperCase() } };
  }

  if (
    ctx.customerId &&
    /(ultima cita|cu[aá]ndo.*(cita|vino)|historial|que pas[oó]|muestra(me)? (ese|el) cliente|cuentame|mas del cliente|del cliente)/.test(
      t,
    )
  ) {
    return { kind: "tool", name: "get_customer", args: { customerId: ctx.customerId } };
  }

  if (/mejor que la semana|compar(a|ar) .*semana/.test(t)) {
    return { kind: "tool", name: "get_business_summary", args: { range: "7d" } };
  }

  return { kind: "none" };
}

export function formatBrief(): string {
  const b = getBusinessBriefCounts(false);
  const attention = getAttentionItems(false, 5);
  const first = attention[0];
  return [
    "📊 Brief ejecutivo · Homestead",
    `Hoy (${b.ymd})`,
    `• ${b.requestsToday} solicitudes nuevas`,
    `• ${b.appointmentsToday} citas hoy`,
    `• ${b.pendingRequests} solicitudes por atender`,
    `• ${b.rescue} oportunidades (rescue)`,
    `• ${b.recoveryOpen} recovery abiertos`,
    `• ${b.jobsActive} trabajos activos`,
    b.contentPending ? `• ${b.contentPending} contenidos pendientes` : "",
    first ? `\nAtención primero: ${first.title}${first.detail ? ` — ${first.detail}` : ""}` : "\nSin alertas prioritarias.",
    "",
    "Ingresos monetarios: no disponibles (sin dataset confiable).",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export function formatToolResultForTelegram(
  toolName: string,
  data: unknown,
): string {
  const d = data as Record<string, unknown>;
  if (d?.error === "forbidden" || d?.message === "No tienes acceso a esa información.") {
    return "No tienes acceso a esa información.";
  }
  if (d?.error === "tool_failed") {
    return String(d.message || "No pude consultar esa información en este momento.");
  }
  if (d?.error === "export_blocked") {
    return String(d.message);
  }
  if (d?.revenueAvailable === false && toolName === "get_business_summary") {
    const brief = d.brief as {
      requestsToday: number;
      appointmentsToday: number;
      pendingRequests: number;
      rescue: number;
      recoveryOpen: number;
    };
    const attentionTop = (d.attentionTop as Array<{ title: string }> | undefined) || [];
    return [
      "Así va Homestead:",
      `• ${brief.requestsToday} solicitudes hoy`,
      `• ${brief.appointmentsToday} citas hoy`,
      `• ${brief.pendingRequests} por atender`,
      `• ${brief.rescue} oportunidades`,
      `• ${brief.recoveryOpen} recovery`,
      attentionTop[0] ? `\nPriorizaría: ${attentionTop[0].title}` : "",
      "",
      "No tenemos datos financieros suficientes para calcular ingresos.",
    ]
      .filter((l) => l !== "")
      .join("\n");
  }
  if (toolName === "get_attention_items") {
    const items = (d.items as Array<{ kind: string; title: string; detail: string }>) || [];
    if (!items.length) return "No hay ítems de atención prioritarios ahora.";
    return [
      "Qué necesita tu atención:",
      ...items.slice(0, 8).map((i, idx) => `${idx + 1}. [${i.kind}] ${i.title}${i.detail ? ` — ${i.detail}` : ""}`),
    ].join("\n");
  }
  if (toolName === "get_appointments") {
    return `Citas ${d.day}: ${d.count}.\n${
      ((d.appointments as Array<{ startTime: string; customerName: string; service: string }>) || [])
        .slice(0, 12)
        .map((a) => `• ${a.startTime} ${a.customerName} — ${a.service}`)
        .join("\n") || "(ninguna)"
    }`;
  }
  if (toolName === "search_customers") {
    const customers = (d.customers as Array<{ id: number; name: string; phoneLast4: string }>) || [];
    if (!customers.length) return `No encontré clientes para «${d.query}».`;
    if (customers.length === 1) {
      return `Encontré 1 cliente: ${customers[0].name} (${customers[0].phoneLast4}).\nId ${customers[0].id}. Pregunta por su historial si quieres.`;
    }
    return [
      `Encontré ${customers.length} clientes:`,
      ...customers.map((c) => `• #${c.id} ${c.name} · ${c.phoneLast4}`),
      "",
      "Responde con el #id para elegir.",
    ].join("\n");
  }
  if (toolName === "get_customer") {
    if (d.error === "not_found") return "Cliente no encontrado.";
    const tl = ((d.timeline as Array<{ at: string; label: string }>) || []).slice(0, 6);
    const lastAppt = d.lastAppointment as { at?: string; label?: string; id?: string } | null;
    return [
      `${d.name} · segmento ${d.segment}`,
      `Trabajos completados: ${d.jobsCompleted}`,
      `Recovery abiertos: ${d.openRecovery}`,
      `Última actividad: ${d.lastActivityAt || "—"}`,
      lastAppt ? `Última cita: ${lastAppt.label || lastAppt.id} (${lastAppt.at})` : "Sin cita en historial reciente.",
      tl.length ? `\nTimeline:\n${tl.map((e) => `• ${e.at.slice(0, 10)} ${e.label}`).join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  if (toolName === "get_service_performance") {
    const services =
      (d.services as Array<{ service: string; label?: string; requests: number; appointments?: number }>) || [];
    const top = services[0];
    return [
      `Servicios (${d.range}) — por solicitudes:`,
      ...services
        .slice(0, 8)
        .map(
          (s) =>
            `• ${s.label || s.service}: ${s.requests} solicitudes${s.appointments != null ? `, ${s.appointments} citas` : ""}`,
        ),
      top
        ? `\nMás solicitudes: ${top.label || top.service} (${top.requests}). «Mejor» depende de la dimensión (solicitudes vs conversión).`
        : "",
    ].join("\n");
  }
  if (toolName === "get_source_performance") {
    const firstTouch =
      (d.firstTouch as Array<{ source: string; n: number }> | undefined) || [];
    return [
      `Fuentes (${d.range}) — first touch:`,
      ...firstTouch.slice(0, 8).map((s) => `• ${s.source || "(vacío)"}: ${s.n} leads`),
      d.retentionAttributedLeads != null
        ? `Retención atribuida (leads): ${d.retentionAttributedLeads}`
        : "",
      "",
      "Nota: no atribuyo causalidad a redes sin evidencia Wave D certificada.",
    ]
      .filter((l) => l !== "")
      .join("\n");
  }
  if (toolName === "get_recovery_cases") {
    const cases = (d.cases as Array<{ jobNumber: string; priority: string; customerName: string }>) || [];
    if (!cases.length) return "No hay recovery abiertos ahora.";
    return [
      `Recovery abiertos: ${d.count}`,
      ...cases.map((c) => `• ${c.jobNumber} [${c.priority}] ${c.customerName}`),
    ].join("\n");
  }
  if (toolName === "get_retention_metrics") {
    return [
      "Retención (determinista Wave E/F):",
      JSON.stringify(d, null, 0).length > 800
        ? `Métricas disponibles. Repeat customers: ${(d as { repeatCustomers?: number }).repeatCustomers ?? "—"}`
        : Object.entries(d)
            .filter(([k]) => !["waveD"].includes(k))
            .slice(0, 12)
            .map(([k, v]) => `• ${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
            .join("\n"),
    ].join("\n");
  }
  if (toolName === "get_content_pending") {
    return `Contenidos pendientes de revisión: ${d.count}.\nPublicación Meta vía Copilot: no disponible (Wave D no certificado).`;
  }
  if (toolName === "get_pending_requests") {
    const items = (d.items as Array<{ publicId: string; name: string; service: string }>) || [];
    return [
      `Pendientes: ${d.pendingCount} · Rescue: ${d.rescueCount}`,
      ...items.slice(0, 10).map((i) => `• ${i.publicId} ${i.name} — ${i.service}`),
    ].join("\n");
  }
  if (toolName === "get_operations_summary") {
    const brief = d.brief as { pendingRequests?: number; appointmentsToday?: number } | undefined;
    const alerts = (d.importantAlerts as Array<{ title: string; kind: string }>) || [];
    return [
      `Resumen operativo (${(d.range as { label?: string })?.label || "hoy"}):`,
      `• ${d.openRequests ?? brief?.pendingRequests ?? 0} solicitudes abiertas/pendientes`,
      `• ${d.scheduledVisits ?? brief?.appointmentsToday ?? 0} citas hoy`,
      `• ${d.overdue ?? 0} alertas SLA/atraso`,
      `• ${d.failedAutomations ?? 0} automatizaciones fallidas`,
      alerts.length
        ? `\nAtención:\n${alerts.slice(0, 5).map((a) => `• [${a.kind}] ${a.title}`).join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  if (toolName === "get_overdue_requests") {
    const items = (d.items as Array<{ publicId: string; name: string; ageHours?: number }>) || [];
    if (!items.length) return "No hay solicitudes abiertas con más de 24h.";
    return [
      `Solicitudes atrasadas (${d.count}):`,
      ...items.map((i) => `• ${i.publicId} ${i.name} — ${i.ageHours ?? "?"}h`),
    ].join("\n");
  }
  if (toolName === "explain_request_stuck") {
    if (d.error === "not_found") return "No encontré esa solicitud.";
    if (d.insufficientEvidence) return `${d.publicId}: no hay evidencia clara de bloqueo. Estado: ${d.status}.`;
    const reasons = (d.supportedReasons as string[]) || [];
    return [`${d.publicId} (${d.status}):`, ...reasons.map((r) => `• ${r}`)].join("\n");
  }
  if (toolName === "get_request_detail") {
    if ((d as { error?: string }).error === "not_found") return "No encontré esa solicitud.";
    return [
      `${d.publicId} · ${d.name}`,
      `Servicio: ${d.service} · Estado: ${d.status}`,
      d.zone ? `Zona: ${d.zone}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  if (toolName === "get_appointment") {
    if (d.error === "not_found") return "Cita no encontrada.";
    return [
      `Cita ${d.appointmentId}`,
      `${d.date} ${d.startTime} · ${d.customerName || ""}`,
      `Servicio: ${d.service || "—"} · Estado: ${d.status || "—"}`,
      d.leadId ? `Solicitud: ${d.leadId}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  if (d.needsConfirmation) {
    return `${d.summary}\n\n¿Confirmas?`;
  }
  try {
    return JSON.stringify(d).slice(0, 900);
  } catch {
    return "Consulta lista.";
  }
}

export function runDeterministic(
  operator: TelegramOperator,
  plan: DeterministicPlan,
): {
  text: string;
  sessionPatch?: Partial<CopilotContext>;
  confirmation?: { token: string; summary: string };
  toolName?: string;
} {
  if (plan.kind === "brief") {
    return { text: formatBrief(), toolName: "brief" };
  }
  if (plan.kind === "select_customer") {
    const result = executeCopilotTool({
      operator,
      name: "get_customer",
      args: { customerId: plan.customerId },
    });
    return {
      text: formatToolResultForTelegram("get_customer", result.data),
      sessionPatch: result.sessionPatch,
      toolName: "get_customer",
    };
  }
  if (plan.kind === "tool") {
    const result = executeCopilotTool({
      operator,
      name: plan.name,
      args: plan.args,
    });
    return {
      text: formatToolResultForTelegram(plan.name, result.data),
      sessionPatch: result.sessionPatch,
      confirmation: result.confirmation,
      toolName: plan.name,
    };
  }
  return { text: "" };
}
