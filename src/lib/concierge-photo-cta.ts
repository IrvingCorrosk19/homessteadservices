/** Detect when assistant text invites the customer to send a photo. */
export function assistantRequestsPhoto(text: string) {
  const body = text.trim();
  if (!body) return false;
  if (/\b(env[ií]a(me)?|mand(a|ar|me)?|adjunt(a|ar|e)?|compart(e|ir|e)?|mu[eé]str(a|ar|ame)?)\b.*\b(foto|fotograf[ií]a|imagen)\b/i.test(body)) {
    return true;
  }
  if (/\bsi puedes,?\s*env[ií]a(me)?\s+una?\s+foto/i.test(body)) return true;
  if (/\b(foto|fotograf[ií]a)\b.*\b(puerta|cerradura|zona|problema|equipo|da[nñ]o|evidencia)\b/i.test(body)) return true;
  return false;
}

export function photosRemainingFromCount(photoCount: number, maxPhotos = 4) {
  return Math.max(0, maxPhotos - photoCount);
}
