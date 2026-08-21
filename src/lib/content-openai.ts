import { recordUsage } from "@/lib/content-catalog";
import { logError } from "@/lib/log";

function textModel() {
  return process.env.OPENAI_TEXT_MODEL?.trim() || "gpt-4o";
}

function imageModel() {
  return process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-1";
}

function apiKey() {
  return process.env.OPENAI_API_KEY?.trim() || "";
}

export function isOpenAiConfigured() {
  return Boolean(apiKey());
}

export type VisualAnalysis = {
  serviceGuess: string;
  ratings: Array<{
    index: number;
    label: "PRIMARY" | "SECONDARY" | "LOW_QUALITY" | "DUPLICATE";
    notes: string;
  }>;
  privacy: {
    people: boolean;
    plates: boolean;
    documents: boolean;
    warning: string;
  };
  copy: {
    full: string;
    cta: string;
    hashtags: string[];
    commercial?: string;
    warm?: string;
    educational?: string;
  };
};

const SYSTEM = `Eres el editor de contenido de Homestead Services, empresa de mantenimiento y reparaciones en Panamá.
Escribes en español natural, profesional y cercano. No suenas a ChatGPT. Pocos emojis (máximo 2).
NO inventes testimonios, precios, porcentajes, garantías, ubicaciones, problemas ni resultados que no estén en las fotos o en la nota del técnico.
Puedes mejorar claridad comercial, no falsificar el trabajo.
Hashtags: entre 3 y 6, relevantes, incluyendo #HomesteadServices y #Panama cuando aplique.
CTA corto, sin número de teléfono inventado.
Devuelve SOLO JSON válido.`;

export async function analyzeAndWriteCopy(input: {
  publicId: string;
  description: string;
  photos: Array<{ bytes: Buffer; mime: string }>;
}): Promise<VisualAnalysis> {
  if (!apiKey()) throw new Error("openai_unconfigured");
  const images = input.photos.slice(0, 4).map((photo) => ({
    type: "image_url" as const,
    image_url: {
      url: `data:${photo.mime};base64,${photo.bytes.toString("base64")}`,
    },
  }));
  const userText = `Folio ${input.publicId}.
Nota del técnico (puede estar vacía): ${input.description || "(sin nota)"}
Analiza las fotografías de un trabajo REAL. Clasifica cada imagen en orden (1..n) como PRIMARY, SECONDARY, LOW_QUALITY o DUPLICATE.
Marca privacy.people/plates/documents si hay personas identificables, placas o documentos.
Escribe 3 captions cortos (comercial, cercano, educativo). No inventes datos. Hashtags 3–6 con #HomesteadServices y #Panama.
JSON:
{"serviceGuess":"","ratings":[{"index":1,"label":"PRIMARY","notes":""}],"privacy":{"people":false,"plates":false,"documents":false,"warning":""},"copy":{"full":"","commercial":"","warm":"","educational":"","cta":"","hashtags":[]}}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: textModel(),
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: [{ type: "text", text: userText }, ...images],
          },
        ],
      }),
      signal: controller.signal,
    });
    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };
    if (!response.ok) {
      throw new Error(json.error?.message || `openai_${response.status}`);
    }
    recordUsage(input.publicId, "openai", "analysis_copy");
    const parsed = JSON.parse(json.choices?.[0]?.message?.content || "{}") as VisualAnalysis;
    return {
      serviceGuess: String(parsed.serviceGuess || ""),
      ratings: Array.isArray(parsed.ratings) ? parsed.ratings : [],
      privacy: parsed.privacy || { people: false, plates: false, documents: false, warning: "" },
      copy: {
        full: parsed.copy?.full || parsed.copy?.commercial || "",
        commercial: parsed.copy?.commercial || parsed.copy?.full || "",
        warm: parsed.copy?.warm || parsed.copy?.full || "",
        educational: parsed.copy?.educational || parsed.copy?.full || "",
        cta: parsed.copy?.cta || "Agenda tu servicio",
        hashtags: Array.isArray(parsed.copy?.hashtags) ? parsed.copy.hashtags : [],
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function rewriteCopyOnly(input: {
  publicId: string;
  description: string;
  previousCopy: string;
  instruction?: string;
}): Promise<{ full: string; cta: string; hashtags: string[] }> {
  if (!apiKey()) throw new Error("openai_unconfigured");
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: textModel(),
      temperature: 0.6,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: `Reescribe el copy. No contradigas la nota ni inventes datos.
Nota: ${input.description || "(sin nota)"}
Instrucción extra: ${input.instruction || "otra versión, mismo hecho"}
Copy anterior:\n${input.previousCopy}
JSON: {"full":"","cta":"","hashtags":[]}`,
        },
      ],
    }),
  });
  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(json.error?.message || `openai_${response.status}`);
  recordUsage(input.publicId, "openai", "copy_only");
  const parsed = JSON.parse(json.choices?.[0]?.message?.content || "{}") as {
    full?: string;
    cta?: string;
    hashtags?: string[];
  };
  return {
    full: parsed.full || input.previousCopy,
    cta: parsed.cta || "Agenda tu servicio",
    hashtags: parsed.hashtags || ["#HomesteadServices", "#Panama"],
  };
}

const ENHANCE_PROMPT = `Ajusta únicamente presentación fotográfica de un trabajo REAL de mantenimiento/reparación: iluminación, exposición, color, nitidez y ruido. No inventes reparaciones, no reemplaces equipos, no agregues instalaciones, no hagas parecer nuevo algo que no lo está, no alteres la evidencia material del trabajo. Conserva el encuadre esencial.`;

export async function enhanceWithOpenAi(input: {
  publicId: string;
  bytes: Buffer;
}): Promise<Buffer | null> {
  if (!apiKey()) return null;
  const form = new FormData();
  form.set("model", imageModel());
  form.set("prompt", ENHANCE_PROMPT);
  form.set("image", new Blob([new Uint8Array(input.bytes)], { type: "image/jpeg" }), "photo.jpg");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey()}` },
      body: form,
      signal: controller.signal,
    });
    const json = (await response.json()) as {
      data?: Array<{ b64_json?: string; url?: string }>;
      error?: { message?: string };
    };
    if (!response.ok) {
      logError("ImageEnhancementFailed", {
        publicId: input.publicId,
        cause: json.error?.message || `openai_${response.status}`,
      });
      return null;
    }
    recordUsage(input.publicId, "openai", "image_edit");
    const b64 = json.data?.[0]?.b64_json;
    if (b64) return Buffer.from(b64, "base64");
    const url = json.data?.[0]?.url;
    if (!url) return null;
    const downloaded = await fetch(url);
    return Buffer.from(await downloaded.arrayBuffer());
  } catch (error) {
    logError("ImageEnhancementFailed", {
      publicId: input.publicId,
      cause: error instanceof Error ? error.name : "unknown",
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}
