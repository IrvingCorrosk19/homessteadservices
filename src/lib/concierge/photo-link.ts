import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { getHomesteadDb, homesteadDataDir, type BufferedPhoto } from "@/lib/service-requests";
import { sniffImage, storedPhotoName } from "@/lib/photos";

export function listConciergePhotoFiles(conversationId: string) {
  const dir = join(homesteadDataDir(), "concierge", conversationId);
  if (!existsSync(dir)) return [] as Array<{ storedAs: string; abs: string }>;
  const rows = getHomesteadDb()
    .prepare("SELECT stored_as FROM concierge_photos WHERE conversation_id = ? ORDER BY id ASC")
    .all(conversationId) as Array<{ stored_as: string }>;
  if (rows.length) {
    return rows
      .map((row) => ({ storedAs: row.stored_as, abs: join(dir, row.stored_as) }))
      .filter((item) => existsSync(item.abs));
  }
  return readdirSync(dir)
    .filter((name) => /^photo-/.test(name))
    .map((name) => ({ storedAs: name, abs: join(dir, name) }));
}

export function copyConciergePhotosToRequest(conversationId: string, publicId: string) {
  const files = listConciergePhotoFiles(conversationId).slice(0, 6);
  if (!files.length) return [] as Array<{ name: string; size: number; type: string; storedAs: string }>;
  const photoDir = join(homesteadDataDir(), "photos", publicId);
  mkdirSync(photoDir, { recursive: true });
  const existing = getHomesteadDb()
    .prepare("SELECT photos_json FROM service_requests WHERE public_id = ?")
    .get(publicId) as { photos_json: string } | undefined;
  const photos: Array<{ name: string; size: number; type: string; storedAs: string }> = JSON.parse(
    existing?.photos_json || "[]",
  );
  const seen = new Set(photos.map((item) => `${item.size}:${item.type}`));
  for (const file of files) {
    const bytes = readFileSync(file.abs);
    const sniffed = sniffImage(bytes);
    if (!sniffed) continue;
    const key = `${bytes.length}:${sniffed.mime}`;
    if (seen.has(key)) continue;
    if (photos.length >= 6) break;
    const storedAs = storedPhotoName(photos.length, sniffed.ext);
    copyFileSync(file.abs, join(photoDir, storedAs));
    photos.push({ name: storedAs, size: bytes.length, type: sniffed.mime, storedAs });
    seen.add(key);
  }
  getHomesteadDb()
    .prepare("UPDATE service_requests SET photos_json = ?, updated_at = ? WHERE public_id = ?")
    .run(JSON.stringify(photos), new Date().toISOString(), publicId);
  getHomesteadDb()
    .prepare("UPDATE concierge_photos SET lead_id = ? WHERE conversation_id = ? AND (lead_id IS NULL OR lead_id = '')")
    .run(publicId, conversationId);
  return photos;
}

export function conciergePhotoBuffers(conversationId: string): BufferedPhoto[] {
  const out: BufferedPhoto[] = [];
  for (const file of listConciergePhotoFiles(conversationId).slice(0, 6)) {
    const bytes = readFileSync(file.abs);
    const sniffed = sniffImage(bytes);
    if (!sniffed) continue;
    out.push({ name: file.storedAs, type: sniffed.mime, bytes, size: bytes.length, sniffed });
  }
  return out;
}
