import { isCopilotOpenAiConfigured } from "@/lib/copilot/openai";
import { autonomousConfig } from "@/lib/autonomous/config";
import { autonomousNow } from "@/lib/autonomous/clock";
import type { OperationalSignal } from "@/lib/autonomous/types";

export type SignalAnalysis = {
  classification: string;
  importance: string;
  reasoningSummary: string;
  recommendedAction: string;
  riskLevel: string;
  openaiUsed: boolean;
};

/** Deterministic fallback — preserves signal when OpenAI unavailable. */
export function deterministicSignalAnalysis(signal: OperationalSignal): SignalAnalysis {
  const facts = Object.entries(signal.facts)
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ");
  return {
    classification: signal.signalType,
    importance: signal.severity,
    reasoningSummary: signal.reasoningSummary || facts,
    recommendedAction: signal.recommendedAction || "Revisar en Centro de Operaciones",
    riskLevel: signal.severity === "CRITICAL" ? "HIGH" : signal.severity,
    openaiUsed: false,
  };
}

export async function enrichSignalWithAi(signal: OperationalSignal): Promise<SignalAnalysis> {
  const cfg = autonomousConfig();
  if (!cfg.aiEnrichmentEnabled || !isCopilotOpenAiConfigured()) {
    return deterministicSignalAnalysis(signal);
  }

  try {
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) return deterministicSignalAnalysis(signal);
    const model =
      process.env.OPENAI_COPILOT_MODEL?.trim() || process.env.OPENAI_TEXT_MODEL?.trim() || "gpt-4o";
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 300,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Analista operativo Homestead. Responde JSON: classification, importance, reasoningSummary, recommendedAction, riskLevel. No inventes datos.",
          },
          {
            role: "user",
            content: `Señal ${signal.signalType}. Hechos: ${JSON.stringify(signal.facts)}`,
          },
        ],
      }),
    });
    if (!response.ok) return deterministicSignalAnalysis(signal);
    const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = json.choices?.[0]?.message?.content || "";
    const parsed = JSON.parse(raw) as Partial<SignalAnalysis>;
    return {
      classification: parsed.classification || signal.signalType,
      importance: parsed.importance || signal.severity,
      reasoningSummary: parsed.reasoningSummary || signal.reasoningSummary || "",
      recommendedAction: parsed.recommendedAction || signal.recommendedAction || "",
      riskLevel: parsed.riskLevel || signal.severity,
      openaiUsed: true,
    };
  } catch {
    return deterministicSignalAnalysis(signal);
  }
}

export function formatPreVisitBrief(signal: OperationalSignal): string {
  if (signal.signalType === "REQUIREMENT_MISSING_BEFORE_VISIT") {
    const f = signal.facts;
    return [
      `VISITA · ${f.visitTime || ""}`,
      String(f.requestId || signal.requestId || ""),
      String(f.service || ""),
      "",
      "PENDIENTE:",
      signal.recommendedAction || "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  if (signal.signalType !== "APPOINTMENT_UPCOMING" && signal.signalType !== "APPOINTMENT_TODAY") {
    return signal.reasoningSummary || "";
  }
  const f = signal.facts;
  const lines = [
    `VISITA ${signal.signalType === "APPOINTMENT_TODAY" ? "HOY" : "MAÑANA"} · ${f.time || ""}`,
    String(f.requestId || signal.requestId || ""),
    String(f.service || ""),
    String(f.location || ""),
  ].filter(Boolean);
  return lines.join("\n");
}

export function analysisTimestamp() {
  return autonomousNow().toISOString();
}
