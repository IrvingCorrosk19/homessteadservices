import { COPILOT_MAX_TOOL_CALLS, COPILOT_TIMEOUT_MS, recordCopilotUsage } from "@/lib/copilot/schema";
import { BUSINESS_COPILOT_SYSTEM } from "@/lib/copilot/prompt";
import { COPILOT_OPENAI_TOOLS, executeCopilotTool } from "@/lib/copilot/tools";
import type { TelegramOperator } from "@/lib/telegram-operators";
import type { CopilotContext } from "@/lib/copilot/session";

function apiKey() {
  return process.env.OPENAI_API_KEY?.trim() || "";
}

export function copilotTextModel() {
  return process.env.OPENAI_COPILOT_MODEL?.trim() || process.env.OPENAI_TEXT_MODEL?.trim() || "gpt-4o";
}

export function isCopilotOpenAiConfigured() {
  return Boolean(apiKey());
}

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
};

export async function runCopilotOpenAi(input: {
  operator: TelegramOperator;
  userText: string;
  context: CopilotContext;
}): Promise<{
  text: string;
  sessionPatch?: Partial<CopilotContext>;
  confirmation?: { token: string; summary: string };
  toolCalls: number;
  failed?: boolean;
}> {
  if (!apiKey()) {
    return { text: "", toolCalls: 0, failed: true };
  }

  const model = copilotTextModel();
  const started = Date.now();
  let promptTokens = 0;
  let completionTokens = 0;
  let toolCalls = 0;
  let sessionPatch: Partial<CopilotContext> | undefined;
  let confirmation: { token: string; summary: string } | undefined;

  const contextHint = [
    input.context.customerId
      ? `Sesión: cliente enfocado id=${input.context.customerId} (${input.context.customerLabel || ""}) — vuelve a consultar tools; no inventes.`
      : "Sesión: sin cliente enfocado.",
    input.context.pendingDisambiguation?.length
      ? `Candidatos pendientes: ${input.context.pendingDisambiguation.map((d) => `#${d.id} ${d.label}`).join("; ")}`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const messages: ChatMessage[] = [
    { role: "system", content: BUSINESS_COPILOT_SYSTEM },
    {
      role: "user",
      content: `${contextHint}\n\nOperador (${input.operator.role}): ${input.userText}`,
    },
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COPILOT_TIMEOUT_MS);

  try {
    for (let round = 0; round < COPILOT_MAX_TOOL_CALLS + 1; round++) {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: 700,
          tools: COPILOT_OPENAI_TOOLS,
          tool_choice: "auto",
          messages,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        return { text: "", toolCalls, failed: true };
      }
      const json = (await response.json()) as {
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        choices?: Array<{ message?: ChatMessage }>;
      };
      promptTokens += json.usage?.prompt_tokens || 0;
      completionTokens += json.usage?.completion_tokens || 0;
      const msg = json.choices?.[0]?.message;
      if (!msg) {
        return { text: "", toolCalls, failed: true };
      }

      if (msg.tool_calls?.length) {
        messages.push({
          role: "assistant",
          content: msg.content || null,
          tool_calls: msg.tool_calls,
        });
        for (const call of msg.tool_calls) {
          if (toolCalls >= COPILOT_MAX_TOOL_CALLS) {
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify({ error: "tool_limit", message: "Límite de tools alcanzado." }),
            });
            continue;
          }
          toolCalls += 1;
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
          } catch {
            args = {};
          }
          const result = executeCopilotTool({
            operator: input.operator,
            name: call.function.name,
            args,
          });
          if (result.sessionPatch) sessionPatch = { ...sessionPatch, ...result.sessionPatch };
          if (result.confirmation) confirmation = result.confirmation;
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(result.data).slice(0, 6000),
          });
        }
        continue;
      }

      const text = (msg.content || "").trim();
      recordCopilotUsage({
        operatorId: input.operator.id,
        promptTokens,
        completionTokens,
        toolCalls,
        latencyMs: Date.now() - started,
        model,
      });
      return {
        text:
          text ||
          (confirmation
            ? `${confirmation.summary}\n\n¿Confirmas?`
            : "No pude formular una respuesta clara. Intenta reformular."),
        sessionPatch,
        confirmation,
        toolCalls,
      };
    }
    return {
      text: "Necesito una aclaración para continuar (límite de consultas internas).",
      sessionPatch,
      confirmation,
      toolCalls,
    };
  } catch {
    return { text: "", toolCalls, failed: true };
  } finally {
    clearTimeout(timer);
  }
}
