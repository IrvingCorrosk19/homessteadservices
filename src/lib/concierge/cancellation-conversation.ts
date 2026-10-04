/**
 * Conversation-side cancellation: grounded replies + state cleanup after backend success.
 */
import type { ConversationState } from "@/lib/concierge-store";
import { bumpStateVersion } from "@/lib/concierge/turn-context-guards";
import { clearServiceScopedState } from "@/lib/concierge/service-transition";
import { serviceAfterNewRequestOperator } from "@/lib/concierge/existing-request-operation";
import type { CancelServiceRequestResult } from "@/lib/service-request-cancellation";

export function applyRequestCancelledConversationState(
  state: ConversationState,
  cancelledRequestId: string,
): ConversationState {
  let next = clearServiceScopedState({
    ...state,
    activeLeadId: "",
    appointmentId: "",
    bookingIntent: false,
    bookingSuspended: false,
    bookingStrategy: "",
    funnelStage: "DISCOVERY",
    awaitingSlotSelection: false,
    offeredSlots: [],
    pendingSlot: null,
    slotOfferToken: "",
    preferredDate: "",
    preferredTime: "",
  });
  next = bumpStateVersion({
    ...next,
    facts: {
      ...(next.facts || {}),
      lastActiveRequestId: cancelledRequestId,
      activeRequestCleared: "1",
      pendingAction: "",
      pendingQuestion: "",
      pendingPhotoRequirement: "",
      lastAskedField: "",
      lastBotQuestion: "",
      slotConfirmed: "",
      slotStatus: "",
      selectedDate: "",
      selectedTime: "",
      selectedSlotLabel: "",
      availabilityState: "NONE",
      digitalLockAbandoned: "1",
    },
  });
  return next;
}

export function applyAppointmentOnlyCancelledState(state: ConversationState): ConversationState {
  return bumpStateVersion({
    ...state,
    appointmentId: "",
    awaitingSlotSelection: false,
    offeredSlots: [],
    pendingSlot: null,
    slotOfferToken: "",
    bookingIntent: false,
    funnelStage: state.activeLeadId ? "HANDOFF" : state.funnelStage,
    facts: {
      ...(state.facts || {}),
      pendingAction: "",
      slotConfirmed: "",
      slotStatus: "",
      selectedDate: "",
      selectedTime: "",
      selectedSlotLabel: "",
      lastAskedField: "",
      lastBotQuestion:
        "Cuando quieras puedo ayudarte a elegir otra fecha para la visita.",
    },
  });
}

export function groundedRequestCancelReply(
  result: CancelServiceRequestResult,
  opts: { explainedAsDelete?: boolean; hadReason: boolean } = { hadReason: false },
) {
  if (!result.success) {
    if (result.errorCode === "NOT_CANCELLABLE") {
      return "Este servicio ya figura como completado. Si hay una corrección, un asesor lo revisa por separado.";
    }
    if (result.errorCode === "NOT_AUTHORIZED" || result.errorCode === "NOT_FOUND") {
      return "No encontré una solicitud activa a tu nombre para cancelar.";
    }
    return "No pude completar la cancelación en este momento. Tu solicitud sigue activa mientras verificamos el problema.";
  }
  if (result.alreadyCancelled) {
    return `Esta solicitud ya estaba cancelada (${result.requestId}).`;
  }
  const deleteNote = opts.explainedAsDelete
    ? " Para conservar la trazabilidad de la atención, la solicitud se cancela en lugar de borrarse."
    : "";
  const visit =
    result.cancelledAppointmentIds.length > 0 ? " y la visita programada" : "";
  const reasonAsk = opts.hadReason
    ? ""
    : " Si quieres, puedes indicarme el motivo; es opcional.";
  return `Entendido.${deleteNote} Cancelé tu solicitud ${result.requestId}${visit}.${reasonAsk}`.replace(
    "Entendido.  ",
    "Entendido. ",
  );
}

export function groundedAppointmentOnlyReply(requestId: string, alreadyCancelled: boolean) {
  if (alreadyCancelled) {
    return "Esa visita ya estaba cancelada. Tu solicitud sigue abierta.";
  }
  const folio = requestId ? ` ${requestId}` : "";
  return `Listo. Cancelé únicamente la visita. Tu solicitud${folio} continúa abierta. Cuando quieras puedo ayudarte a elegir otra fecha.`;
}

export function privacyDataRequestReply() {
  return "Entendido. Esa es una solicitud de datos personales, no una cancelación del servicio. Un asesor autorizado la revisa; no borramos información de forma automática por el chat.";
}

export function ambiguousTomorrowReply() {
  return "¿Quieres cancelar la visita de mañana o prefieres cambiarla para otro día?";
}

export function ambiguousCancelTargetReply() {
  return "¿Quieres cancelar la visita programada o dejar pendiente toda la solicitud? Así lo hago correctamente.";
}

export function uncertainCancelReply() {
  return "¿Quieres cancelar la solicitud, o solo cambiar algo del servicio?";
}

export function confirmCancelRequestReply(input: {
  serviceLabel: string;
  publicId: string;
  when?: string;
}) {
  const service = (input.serviceLabel || "servicio").toLowerCase();
  const when = input.when?.trim() ? `, agendada para ${input.when.trim()}` : "";
  return `¿Confirmas que quieres cancelar la solicitud de ${service} ${input.publicId}${when}?`;
}

export function confirmCancelAllReply(
  rows: Array<{ publicId: string; serviceLabel: string; when?: string }>,
) {
  if (rows.length <= 1 && rows[0]) {
    return confirmCancelRequestReply({
      serviceLabel: rows[0].serviceLabel,
      publicId: rows[0].publicId,
      when: rows[0].when,
    });
  }
  const summary = rows
    .slice(0, 4)
    .map((row) => {
      const when = row.when?.trim() ? ` (${row.when.trim()})` : "";
      return `${row.serviceLabel || "servicio"} ${row.publicId}${when}`;
    })
    .join("; ");
  return `Tienes ${rows.length} solicitudes activas: ${summary}. ¿Confirmas que deseas cancelar todas, o solo alguna?`;
}

export function cancelConfirmationKeptReply() {
  return "De acuerdo, mantengo tu solicitud activa.";
}

export function markPendingCancelConfirmation(
  state: ConversationState,
  requestIds: string[],
  question: string,
  mode: "ONE" | "ALL" | "CHOOSE" = "ONE",
  sourceText = "",
): ConversationState {
  const extraService = sourceText ? serviceAfterNewRequestOperator(sourceText) : "";
  return bumpStateVersion({
    ...state,
    facts: {
      ...(state.facts || {}),
      pendingAction: mode === "CHOOSE" ? "CLARIFY_CANCEL_WHICH" : "CONFIRM_CANCEL_REQUEST",
      pendingCancelRequestIds: requestIds.filter(Boolean).join("|"),
      pendingCancelMode: mode,
      pendingCancelSourceText: sourceText.slice(0, 500),
      pendingCancelNewService: extraService || "",
      lastBotQuestion: question,
      lastAskedField: "cancel_confirmation",
    },
  });
}

export function clearPendingCancelConfirmation(state: ConversationState): ConversationState {
  return bumpStateVersion({
    ...state,
    facts: {
      ...(state.facts || {}),
      pendingAction: "",
      pendingCancelRequestIds: "",
      pendingCancelMode: "",
      pendingCancelSourceText: "",
      pendingCancelNewService: "",
      lastAskedField: "",
    },
  });
}

export function deferredNeedAfterBookingReply(input: {
  serviceLabel: string;
  when: string;
  deferredService: string;
  deferredSummary?: string;
}) {
  const paintish = /pint/i.test(input.serviceLabel);
  const visitLabel = paintish ? "pintura" : input.serviceLabel.toLowerCase() || "servicio";
  const when = input.when || "el horario acordado";
  if (input.deferredService === "plumbing" || /lavamanos|lava\s*manos|lavabo/i.test(input.deferredSummary || "")) {
    return `Tu visita de ${visitLabel} quedó confirmada para ${when}. Sobre el lavamanos, ¿tiene una fuga, está tapado o presenta otro problema?`;
  }
  const other = input.deferredService === "ac" ? "el aire" : "eso nuevo";
  return `Tu visita de ${visitLabel} quedó confirmada para ${when}. Sobre ${other}, ¿quieres agregarlo a la misma visita o prefieres abrir otra solicitud?`;
}

export function markCancelClarification(
  state: ConversationState,
  kind: "TARGET" | "TOMORROW" | "UNCERTAIN",
): ConversationState {
  const question =
    kind === "TOMORROW"
      ? ambiguousTomorrowReply()
      : kind === "UNCERTAIN"
        ? uncertainCancelReply()
        : ambiguousCancelTargetReply();
  return bumpStateVersion({
    ...state,
    facts: {
      ...(state.facts || {}),
      pendingAction: kind === "TOMORROW" ? "CLARIFY_TOMORROW_NO" : "CLARIFY_CANCEL_TARGET",
      lastBotQuestion: question,
      lastAskedField: "cancel_clarification",
    },
  });
}
