import type { TelegramOperator } from "@/lib/telegram-operators";
import { hasTelegramPermission } from "@/lib/telegram-operators";
import type { TelegramButton } from "@/lib/content-telegram";
import {
  incrementCopilotMetric,
  recordCopilotAudit,
  COPILOT_PROMPT_VERSION,
  ensureCopilotSchema,
} from "@/lib/copilot/schema";
import { getCopilotSession, touchCopilotTurn } from "@/lib/copilot/session";
import { isUnsafeOperatorQuery } from "@/lib/copilot/prompt";
import {
  matchDeterministicIntent,
  runDeterministic,
  formatBrief,
} from "@/lib/copilot/deterministic";
import { isCopilotOpenAiConfigured, runCopilotOpenAi } from "@/lib/copilot/openai";
import {
  confirmCopilotAction,
  cancelCopilotAction,
} from "@/lib/copilot/confirmations";

export type CopilotReply = {
  text: string;
  keyboard?: TelegramButton[][];
  openaiUsed: boolean;
  deterministic: boolean;
  confirmation?: { token: string; summary: string };
};

function navKeyboard(extra?: TelegramButton[][]): TelegramButton[][] {
  const rows = extra ? [...extra] : [];
  rows.push([
    { text: "📊 Brief", callback_data: "cc:cop:brief" },
    { text: "⚠️ Atención", callback_data: "cc:cop:attn" },
  ]);
  rows.push([
    { text: "🏠 Inicio", callback_data: "cc:h" },
    { text: "🤖 Copiloto", callback_data: "cc:cop" },
  ]);
  return rows;
}

function confirmKeyboard(token: string): TelegramButton[][] {
  return [
    [
      { text: "✅ Confirmar", callback_data: `cc:cp:ok:${token}` },
      { text: "❌ No", callback_data: `cc:cp:no:${token}` },
    ],
    ...navKeyboard(),
  ];
}

export function copilotWelcome(): CopilotReply {
  return {
    text: [
      "🤖 Copiloto Homestead",
      "",
      "Pregúntame en lenguaje natural, por ejemplo:",
      "• ¿Cómo vamos hoy?",
      "• ¿Qué necesita atención?",
      "• ¿Cuántas citas mañana?",
      "• Busca a Ana",
      "",
      "Los números vienen de Homestead (SQLite), no de memoria inventada.",
      `Prompt: ${COPILOT_PROMPT_VERSION}`,
    ].join("\n"),
    keyboard: navKeyboard(),
    openaiUsed: false,
    deterministic: true,
  };
}

export async function handleCopilotTurn(input: {
  operator: TelegramOperator;
  telegramUserId: string;
  text: string;
  conversationId?: string;
}): Promise<CopilotReply> {
  ensureCopilotSchema();
  incrementCopilotMetric("copilot_requests");
  recordCopilotAudit({
    operatorId: input.operator.id,
    telegramUserId: input.telegramUserId,
    event: "COPILOT_QUERY",
    result: "start",
    detail: { len: input.text.length },
  });

  if (!hasTelegramPermission(input.operator, "dashboard.read")) {
    incrementCopilotMetric("copilot_unauthorized_query");
    incrementCopilotMetric("copilot_failure");
    return {
      text: "No tienes acceso a esa información.",
      keyboard: navKeyboard(),
      openaiUsed: false,
      deterministic: true,
    };
  }

  const unsafe = isUnsafeOperatorQuery(input.text);
  if (unsafe) {
    incrementCopilotMetric("copilot_prompt_injection_detected");
    recordCopilotAudit({
      operatorId: input.operator.id,
      event: "COPILOT_ACTION_DENIED",
      result: unsafe,
    });
    const messages: Record<string, string> = {
      sql: "No puedo ejecutar SQL. Usa las consultas de negocio del Copiloto.",
      shell: "No puedo ejecutar comandos del sistema.",
      secret: "No puedo revelar secretos ni claves.",
      injection_claim: "Tu rol real no cambia por este chat. Permisos del servidor aplican.",
      mass_pii: "No puedo volcar listados masivos de clientes o teléfonos por chat.",
    };
    const text = messages[unsafe];
    touchCopilotTurn(input.operator.id, input.telegramUserId, input.text, text, { active: true }, input.conversationId);
    incrementCopilotMetric("copilot_success");
    return { text, keyboard: navKeyboard(), openaiUsed: false, deterministic: true };
  }

  const ctx = getCopilotSession(input.operator.id, input.conversationId);
  const plan = matchDeterministicIntent(input.text, ctx);

  if (plan.kind !== "none") {
    const result = runDeterministic(input.operator, plan);
    const text = result.text || formatBrief();
    touchCopilotTurn(input.operator.id, input.telegramUserId, input.text, text, {
      active: true,
      ...result.sessionPatch,
      ...(result.toolName ? { lastToolName: result.toolName } : {}),
      ...(result.confirmation ? { pendingConfirmationToken: result.confirmation.token } : {}),
    }, input.conversationId);
    incrementCopilotMetric("copilot_success");
    return {
      text,
      keyboard: result.confirmation
        ? confirmKeyboard(result.confirmation.token)
        : navKeyboard(),
      openaiUsed: false,
      deterministic: true,
      confirmation: result.confirmation,
    };
  }

  if (isCopilotOpenAiConfigured()) {
    const ai = await runCopilotOpenAi({
      operator: input.operator,
      userText: input.text,
      context: { ...ctx, active: true },
    });
    if (!ai.failed && ai.text) {
      touchCopilotTurn(input.operator.id, input.telegramUserId, input.text, ai.text, {
        active: true,
        ...ai.sessionPatch,
        ...(ai.confirmation ? { pendingConfirmationToken: ai.confirmation.token } : {}),
      }, input.conversationId);
      incrementCopilotMetric("copilot_success");
      return {
        text: ai.text.slice(0, 3500),
        keyboard: ai.confirmation ? confirmKeyboard(ai.confirmation.token) : navKeyboard(),
        openaiUsed: true,
        deterministic: false,
        confirmation: ai.confirmation,
      };
    }
  }

  // OpenAI down or unclear: still offer deterministic brief
  const fallback =
    "No pude interpretar esa pregunta con IA ahora. Prueba:\n• ¿Cómo vamos hoy?\n• ¿Qué necesita atención?\n• ¿Citas mañana?\n• Busca a <nombre>\n\nEl brief determinista sigue disponible.";
  touchCopilotTurn(input.operator.id, input.telegramUserId, input.text, fallback, { active: true }, input.conversationId);
  incrementCopilotMetric("copilot_failure");
  return {
    text: fallback,
    keyboard: navKeyboard([[{ text: "📊 Brief ejecutivo", callback_data: "cc:cop:brief" }]]),
    openaiUsed: false,
    deterministic: true,
  };
}

export function handleCopilotConfirm(input: {
  operator: TelegramOperator;
  token: string;
  accept: boolean;
}): CopilotReply {
  if (input.accept) {
    const result = confirmCopilotAction({ operator: input.operator, token: input.token });
    return {
      text: result.message,
      keyboard: navKeyboard(),
      openaiUsed: false,
      deterministic: true,
    };
  }
  const result = cancelCopilotAction({ operator: input.operator, token: input.token });
  return {
    text: result.message,
    keyboard: navKeyboard(),
    openaiUsed: false,
    deterministic: true,
  };
}

export function looksLikeCopilotQuery(text: string): boolean {
  const t = text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  if (!t || t.startsWith("/")) return false;
  if (
    /como vamos|como va homestead|que tengo pendiente|necesita atencion|citas (hoy|manana)|busca(r)? a |cliente |solicitud|hs-\d|de donde vienen|servicio.*(mejor|mas)|clientes molest|mantenimiento pendiente|brief ejecutivo|cuantas |cuantos /.test(
      t,
    )
  ) {
    return true;
  }
  if (/^\?/.test(text.trim()) || text.includes("¿")) return true;
  return false;
}
