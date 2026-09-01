/**
 * Deterministic answers for general operations questions (hours, coverage, pricing).
 */
import type { ConversationState } from "@/lib/concierge-store";

export function answerOperationsQuestion(text: string): { handled: boolean; reply: string } {
  if (/\b(cu[aá]nto cuesta|precio|vale|tarifa|cotiz|costo)\b/i.test(text)) {
    return {
      handled: true,
      reply:
        "El costo depende del diagnóstico en sitio; no hay una tarifa publicada. El técnico te confirma el alcance antes de trabajar.",
    };
  }
  if (!/\b(trabajan|atienden|domingo|s[aá]bado|festivo|horario de atenci[oó]n)\b/i.test(text)) {
    return { handled: false, reply: "" };
  }
  return {
    handled: true,
    reply:
      "Normalmente coordinamos visitas de lunes a sábado; los domingos depende de la disponibilidad del equipo. Si me dices qué día y hora te convienen, reviso el calendario contigo.",
  };
}

export function answerBookingNudge(text: string, state: ConversationState): { handled: boolean; reply: string } {
  if (!/\b(ok\s+agendemos|agendemos|coordinemos|reservemos|s[ií],?\s*agend)\b/i.test(text)) {
    return { handled: false, reply: "" };
  }
  if (state.contactStatus === "VALID" && state.location?.trim()) {
    if (state.preferredDate && state.preferredTime) {
      return {
        handled: true,
        reply: "Perfecto. Con el horario que mencionaste reviso el calendario y te confirmo si sigue disponible.",
      };
    }
    return {
      handled: true,
      reply: "Perfecto. ¿Qué día y hora te convienen? Con eso reviso el calendario y te doy opciones reales.",
    };
  }
  return { handled: false, reply: "" };
}
