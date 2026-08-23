export function parseConciergePhotoMessage(body: string) {
  const match = body.match(/^\[Foto adjunta: (photo-[^\]]+)\](?:\s+([\s\S]*))?$/);
  if (!match) return null;
  return { photoId: match[1], caption: (match[2] || "").trim() };
}

export function formatConciergePhotoMessage(storedAs: string, caption = "") {
  const marker = `[Foto adjunta: ${storedAs}]`;
  const trimmed = caption.trim();
  return trimmed ? `${marker} ${trimmed}` : marker;
}
