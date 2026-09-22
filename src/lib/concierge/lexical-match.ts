/**
 * Trade-alias matching.
 *
 * Retrieved tokens like "activa" must not count as the 2-letter alias "ac".
 * Intentional stems ("plom" → plomería, "aire" → aires) still match as prefixes.
 */
export function foldLex(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function aliasHits(blob: string, alias: string) {
  const needle = foldLex(alias);
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (needle.length <= 2) {
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`).test(blob);
  }
  if (needle.length <= 4) {
    return new RegExp(`(?:^|[^a-z0-9])${escaped}`).test(blob);
  }
  return blob.includes(needle);
}
