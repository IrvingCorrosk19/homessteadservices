/**
 * Shared contact-form validation — same rules for UI and POST /api/contact.
 * No AI. Min length must stay aligned with the API gate.
 */
import type { FormService } from "@/lib/site";

/** Backend + frontend minimum for `message` (trim). Do not invent another value. */
export const CONTACT_MESSAGE_MIN_LENGTH = 8;

export const CONTACT_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ContactMessageIssue = "empty" | "too_short" | "low_quality" | null;

/**
 * Rejects strings that only meet length via repetition (e.g. "wwwwwwww").
 * Does not score spelling or optional details.
 */
export function isLowQualityContactMessage(raw: string): boolean {
  const compact = raw.trim().replace(/\s+/g, "");
  if (compact.length < CONTACT_MESSAGE_MIN_LENGTH) return false;
  const lower = compact.toLowerCase();
  const unique = new Set(lower).size;
  if (unique <= 2) return true;
  const counts = new Map<string, number>();
  for (const ch of lower) counts.set(ch, (counts.get(ch) || 0) + 1);
  const max = Math.max(...counts.values());
  return max / lower.length >= 0.75;
}

export function assessContactMessage(raw: string): ContactMessageIssue {
  const trimmed = raw.trim();
  if (!trimmed) return "empty";
  if (trimmed.length < CONTACT_MESSAGE_MIN_LENGTH) return "too_short";
  if (isLowQualityContactMessage(trimmed)) return "low_quality";
  return null;
}

export function contactMessageCharsRemaining(raw: string): number {
  const len = raw.trim().length;
  return Math.max(0, CONTACT_MESSAGE_MIN_LENGTH - len);
}

/** Permanent help under “¿Qué necesitas?” */
export const CONTACT_MESSAGE_HELP =
  "Cuéntanos qué ocurre, en qué parte de la propiedad y desde cuándo.";

export const CONTACT_MESSAGE_EXAMPLES: Partial<Record<FormService | "", string>> = {
  ac: "Mi aire de la habitación enciende, pero no enfría desde ayer.",
  plumbing: "Hay una fuga debajo del lavamanos de la cocina desde esta mañana.",
  painting: "Quiero pintar la sala y el pasillo; hay humedad en una esquina.",
  electrical: "Se apaga el breaker de la cocina cuando enciendo el microondas.",
  locksmith: "La chapa de la puerta principal no gira bien desde hace dos días.",
  repairs: "Se aflojó un gabinete de la cocina y una bisagra está suelta.",
  remodeling: "Quiero renovar el baño principal: cambiar piso y grifería.",
  multiple: "Necesito revisar el aire y una fuga en el baño del segundo piso.",
  other: "Necesito ayuda con un problema en mi propiedad; te detallo abajo.",
};

export function contactMessageExample(service: string): string | null {
  const key = String(service || "") as FormService | "";
  return CONTACT_MESSAGE_EXAMPLES[key] || null;
}

export function isValidClientSubmissionId(raw: string): boolean {
  return /^[a-zA-Z0-9_-]{8,80}$/.test(String(raw || "").trim());
}
