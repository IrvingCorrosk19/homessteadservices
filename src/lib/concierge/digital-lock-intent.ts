/**
 * Client-safe digital-lock intent helpers (no fs / sqlite).
 * Vision I/O stays in digital-lock-vision.ts (server only).
 */

export type DigitalLockView = "front" | "inside" | "edge" | "unknown";

const DIGITAL_LOCK_INTENT =
  /\b(cerradura\s+digital|cerradura\s+inteligente|smart\s*lock|huella|fingerprint|teclado|keypad|quiero\s+(comprar|poner|instalar|cambiar).{0,40}cerradura|cerradura.{0,40}(digital|inteligente|huella))\b/i;

/** Tolerate common typos: cerddaura digitapl → cerradura digital */
export function normalizeDigitalLockText(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/cer+d+a+uras?/g, "cerradura")
    .replace(/cer+r?a?d+a?uras?/g, "cerradura")
    .replace(/digit+a+[pl]*|digit+al+/g, "digital")
    .replace(/intelig+ente/g, "inteligente");
}

export function detectDigitalLockPurchaseIntent(text: string) {
  const raw = text || "";
  const n = normalizeDigitalLockText(raw);
  if (DIGITAL_LOCK_INTENT.test(raw) || DIGITAL_LOCK_INTENT.test(n)) return true;
  if (/\bcerradura\b/.test(n) && /\b(digital|inteligente|huella|smart\s*lock|teclado|keypad)\b/.test(n)) return true;
  if (/cer\w{2,8}ura/.test(n) && /digit/.test(n)) return true;
  if (/\b(comprar|instalar|poner|cambiar).{0,30}cer\w{2,8}ura/.test(n) && /digit|intelig|huella|smart/.test(n)) {
    return true;
  }
  return false;
}
