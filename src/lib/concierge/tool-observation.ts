/**
 * Structured tool observations for the model — never invent results.
 */
export type StructuredToolObservation = {
  tool: string;
  ok: boolean;
  requested?: string;
  requestedAvailable?: boolean;
  alternatives?: string[];
  error?: string;
  instruction?: string;
  raw: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function slotLabel(slot: unknown): string {
  if (!slot || typeof slot !== "object") return "";
  const s = slot as { time?: string; label?: string; date?: string };
  return s.label || [s.date, s.time].filter(Boolean).join(" ");
}

export function formatToolObservation(toolName: string, result: unknown): StructuredToolObservation {
  const rec = asRecord(result);
  const ok = rec.ok !== false && rec.error == null && rec.reason !== "calendar_unavailable";
  const observation: StructuredToolObservation = {
    tool: toolName,
    ok,
    raw: result,
  };

  if (toolName === "check_availability") {
    const requested = rec.requested && typeof rec.requested === "object"
      ? rec.requested as { date?: string; time?: string }
      : {};
    const requestedText = [requested.date, requested.time].filter(Boolean).join(" ");
    const slots = Array.isArray(rec.slots) ? rec.slots : [];
    const alternatives = slots.map(slotLabel).filter(Boolean).slice(0, 4);
    observation.requested = requestedText || undefined;
    observation.requestedAvailable = Boolean(rec.requestedAvailable);
    observation.alternatives = alternatives;
    observation.instruction =
      rec.requestedAvailable
        ? "El horario pedido está libre. No inventes otros. Pregunta confirmación o avanza según RESPONSE_PLAN."
        : rec.requestedSlotBusy
          ? "El horario pedido NO está libre. Comunica ocupado y ofrece SOLO alternatives. No listes el día completo si hay 1–2 alternativas."
          : "Ofrece SOLO alternatives. No inventes horarios.";
    if (rec.reason === "calendar_unavailable" || rec.queryExecuted === false && rec.ok === false) {
      observation.ok = false;
      observation.error = "calendar_unavailable";
      observation.instruction =
        "No inventes horarios. Di con naturalidad que no pudiste consultar la agenda; la solicitud sigue si existe.";
    }
  }

  if (typeof rec.instruction === "string") observation.instruction = rec.instruction;
  if (typeof rec.error === "string") observation.error = rec.error;
  if (typeof rec.reason === "string" && !observation.error) observation.error = rec.reason;

  return observation;
}

export function toolObservationMessage(observation: StructuredToolObservation): string {
  const { raw, ...safe } = observation;
  void raw;
  return JSON.stringify({ ...safe, result: observation.raw });
}
