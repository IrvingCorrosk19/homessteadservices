import { mkdirSync, writeFileSync, readFileSync } from "fs";
import { dirname, join, resolve, sep } from "path";
import {
  activeJobForChat,
  createContentJob,
  findOriginalBySha256,
  findOriginalByTelegramFileId,
  getJobByPublicId,
  latestVersion,
  listAssets,
  listRecentContentJobs,
  readAssetBytes,
  recordContentEvent,
  sha256Of,
  storeOriginal,
  tryApproveContentJob,
  updateJob,
  getContentSettings,
} from "@/lib/content-catalog";
import { getHomesteadDb, homesteadDataDir } from "@/lib/service-requests";
import { PHOTO_BATCH_ID_PATTERN } from "@/lib/content-types";
import { assignStaggeredSlots, formatPanama } from "@/lib/content-queue";
import { logInfo } from "@/lib/log";

export const ALBUM_WAIT_MS = 1800;
export const CAROUSEL_UNSUPPORTED =
  "El publicador actual no publica carruseles en Facebook ni Instagram. Cada pieza sale como 1 imagen. No cambio tu elección: quedan propuestas independientes.";

const albumTimers = new Map<string, ReturnType<typeof setTimeout>>();

type IntakeRow = {
  id: number;
  group_key: string;
  media_group_id: string;
  chat_id: string;
  user_id: string;
  update_id: number | null;
  message_id: number | null;
  telegram_file_id: string;
  sha256: string;
  caption: string;
  relative_path: string;
  mime_type: string;
  ext: string;
  width: number | null;
  height: number | null;
  public_id: string;
  status: string;
  created_at: string;
};

type BatchMember = {
  publicId: string;
  version: number;
  telegramFileId: string;
  sha256: string;
};

function panamaYear(date = new Date()) {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Panama", year: "numeric" }).format(date),
  );
}

function isInside(root: string, target: string) {
  const prefix = root.endsWith(sep) ? root : root + sep;
  return target === root || target.startsWith(prefix);
}

export function nextBatchPublicId() {
  const database = getHomesteadDb();
  const year = panamaYear();
  const row = database
    .prepare("SELECT last FROM content_batch_counters WHERE year = ?")
    .get(year) as { last: number } | undefined;
  const last = row ? row.last + 1 : 1;
  if (row) {
    database.prepare("UPDATE content_batch_counters SET last = ? WHERE year = ?").run(last, year);
  } else {
    database.prepare("INSERT INTO content_batch_counters (year, last) VALUES (?, ?)").run(year, last);
  }
  return `HB-${year}-${String(last).padStart(6, "0")}`;
}

export function albumGroupKey(chatId: string, mediaGroupId?: string | null) {
  const group = (mediaGroupId || "").trim();
  return group ? `album:${chatId}:${group}` : "";
}

function intakeRoot() {
  return join(homesteadDataDir(), "content", "intake");
}

function writeIntakeFile(groupKey: string, hash: string, ext: string, bytes: Buffer) {
  const relativePath = join("intake", groupKey.replace(/[^a-zA-Z0-9_-]/g, "_"), `${hash.slice(0, 16)}.${ext}`);
  const abs = resolve(join(homesteadDataDir(), "content", relativePath));
  const root = resolve(join(homesteadDataDir(), "content"));
  if (!isInside(root, abs)) return null;
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, bytes);
  return relativePath.replaceAll("\\", "/");
}

function readIntakeBytes(relativePath: string) {
  const abs = resolve(join(homesteadDataDir(), "content", relativePath));
  const root = resolve(join(homesteadDataDir(), "content"));
  if (!isInside(root, abs)) return null;
  try {
    return readFileSync(abs);
  } catch {
    return null;
  }
}

export function getPhotoBatch(publicId: string) {
  if (!PHOTO_BATCH_ID_PATTERN.test(publicId)) return null;
  const row = getHomesteadDb()
    .prepare("SELECT * FROM content_photo_batches WHERE public_id = ?")
    .get(publicId) as
    | {
        public_id: string;
        group_key: string;
        media_group_id: string;
        chat_id: string;
        member_json: string;
        status: string;
        created_at: string;
        updated_at: string;
      }
    | undefined;
  if (!row) return null;
  let members: BatchMember[] = [];
  try {
    members = JSON.parse(row.member_json) as BatchMember[];
  } catch {
    members = [];
  }
  return { ...row, members };
}

function saveBatchMembers(publicId: string, members: BatchMember[], status?: string) {
  const now = new Date().toISOString();
  getHomesteadDb()
    .prepare(
      `UPDATE content_photo_batches SET member_json = ?, status = COALESCE(?, status), updated_at = ?
       WHERE public_id = ?`,
    )
    .run(JSON.stringify(members), status ?? null, now, publicId);
}

export function bufferIncomingPhoto(input: {
  chatId: string;
  userId: string;
  updateId: number;
  messageId?: number;
  mediaGroupId?: string;
  telegramFileId: string;
  caption?: string;
  bytes: Buffer;
  mime: string;
  ext: string;
  width?: number | null;
  height?: number | null;
}) {
  const hash = sha256Of(input.bytes);
  const existingJob =
    findOriginalByTelegramFileId(input.telegramFileId) || findOriginalBySha256(hash);
  const groupKey =
    albumGroupKey(input.chatId, input.mediaGroupId) ||
    (existingJob ? `solo:${existingJob}` : `solo:${input.chatId}:${input.updateId}`);

  const database = getHomesteadDb();
  const prior = database
    .prepare(
      `SELECT * FROM content_photo_intake
       WHERE telegram_file_id = ? OR sha256 = ? OR update_id = ?
       ORDER BY id ASC LIMIT 1`,
    )
    .get(input.telegramFileId, hash, input.updateId) as IntakeRow | undefined;
  if (prior) {
    return {
      ok: true as const,
      duplicate: true,
      buffered: prior.status === "buffered",
      groupKey: prior.group_key,
      publicId: prior.public_id || existingJob || "",
    };
  }
  if (existingJob) {
    return {
      ok: true as const,
      duplicate: true,
      buffered: false,
      groupKey,
      publicId: existingJob,
    };
  }

  const relativePath = writeIntakeFile(groupKey, hash, input.ext, input.bytes);
  if (!relativePath) return { ok: false as const, error: "path" as const };

  mkdirSync(intakeRoot(), { recursive: true });
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO content_photo_intake
        (group_key, media_group_id, chat_id, user_id, update_id, message_id, telegram_file_id, sha256,
         caption, relative_path, mime_type, ext, width, height, public_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'buffered', ?)`,
    )
    .run(
      groupKey,
      input.mediaGroupId || "",
      input.chatId,
      input.userId,
      input.updateId,
      input.messageId ?? null,
      input.telegramFileId,
      hash,
      (input.caption || "").slice(0, 2000),
      relativePath,
      input.mime,
      input.ext,
      input.width ?? null,
      input.height ?? null,
      now,
    );
  logInfo("TelegramPhotoReceived", { contentJobId: groupKey, stage: "buffered" });
  return {
    ok: true as const,
    duplicate: false,
    buffered: true,
    groupKey,
    publicId: "",
    intakeCount: countIntake(groupKey),
  };
}

export function countIntake(groupKey: string) {
  const row = getHomesteadDb()
    .prepare("SELECT COUNT(*) as n FROM content_photo_intake WHERE group_key = ?")
    .get(groupKey) as { n: number };
  return row.n;
}

function listBuffered(groupKey: string) {
  return getHomesteadDb()
    .prepare(
      `SELECT * FROM content_photo_intake WHERE group_key = ? AND status = 'buffered' ORDER BY id ASC`,
    )
    .all(groupKey) as IntakeRow[];
}

function createJobFromIntake(row: IntakeRow) {
  const bytes = readIntakeBytes(row.relative_path);
  if (!bytes) return { ok: false as const, error: "missing_file" as const, sha256: row.sha256 };
  const existing =
    findOriginalByTelegramFileId(row.telegram_file_id) || findOriginalBySha256(row.sha256);
  if (existing) {
    getHomesteadDb()
      .prepare("UPDATE content_photo_intake SET public_id = ?, status = 'duplicate' WHERE id = ?")
      .run(existing, row.id);
    return { ok: true as const, publicId: existing, duplicate: true, sha256: row.sha256 };
  }
  const job = createContentJob({ chatId: row.chat_id, userId: row.user_id });
  const stored = storeOriginal({
    job,
    bytes,
    mime: row.mime_type,
    ext: row.ext,
    telegramFileId: row.telegram_file_id,
    width: row.width,
    height: row.height,
  });
  if (!stored.ok) {
    updateJob(job.publicId, { status: "FAILED", lastError: "store_original" });
    return { ok: false as const, error: "store" as const, sha256: row.sha256 };
  }
  updateJob(job.publicId, {
    status: "RECEIVING",
    description: row.caption || "",
    mediaGroupId: row.media_group_id,
    format: "SINGLE_IMAGE",
  });
  recordContentEvent(job.publicId, "CONTENT_RECEIVED", row.media_group_id ? "album" : "photo");
  getHomesteadDb()
    .prepare("UPDATE content_photo_intake SET public_id = ?, status = 'assigned' WHERE id = ?")
    .run(job.publicId, row.id);
  return { ok: true as const, publicId: job.publicId, duplicate: false, sha256: row.sha256 };
}

export function flushPhotoGroup(
  groupKey: string,
  options: { process?: boolean } = {},
) {
  void options.process;
  const database = getHomesteadDb();
  const claimed = database.transaction(() => {
    const rows = listBuffered(groupKey);
    if (!rows.length) return [] as IntakeRow[];
    database
      .prepare("UPDATE content_photo_intake SET status = 'flushing' WHERE group_key = ? AND status = 'buffered'")
      .run(groupKey);
    return rows.map((row) => ({ ...row, status: "flushing" }));
  })();
  if (!claimed.length) {
    return { ok: true as const, publicIds: [] as string[], batchId: "", missing: [] as string[], duplicate: true };
  }

  const created: string[] = [];
  const missing: string[] = [];
  for (const row of claimed) {
    const result = createJobFromIntake(row);
    if (result.ok) {
      if (!created.includes(result.publicId)) created.push(result.publicId);
    } else {
      missing.push(result.sha256.slice(0, 12));
      database.prepare("UPDATE content_photo_intake SET status = 'failed' WHERE id = ?").run(row.id);
    }
  }

  const first = claimed[0];
  const members: BatchMember[] = created.map((publicId) => ({
    publicId,
    version: latestVersion(publicId)?.version || 0,
    telegramFileId:
      listAssets(publicId, "ORIGINAL", 0)[0]?.telegramFileId || "",
    sha256: listAssets(publicId, "ORIGINAL", 0)[0]?.sha256 || "",
  }));
  const batchId = created.length ? nextBatchPublicId() : "";
  if (batchId) {
    const now = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO content_photo_batches
          (public_id, group_key, media_group_id, chat_id, member_json, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'proposed', ?, ?)`,
      )
      .run(
        batchId,
        groupKey,
        first?.media_group_id || "",
        first?.chat_id || "",
        JSON.stringify(members),
        now,
        now,
      );
    for (const publicId of created) {
      updateJob(publicId, { photoBatchId: batchId });
    }
    assignStaggeredSlots(created);
  }
  logInfo("ContentJobCreated", { contentJobId: batchId || groupKey, stage: `split-${created.length}` });
  return { ok: true as const, publicIds: created, batchId, missing, duplicate: false };
}

export function scheduleAlbumFlush(
  groupKey: string,
  waitMs = ALBUM_WAIT_MS,
  onFlush?: (result: ReturnType<typeof flushPhotoGroup>) => void | Promise<void>,
) {
  const previous = albumTimers.get(groupKey);
  if (previous) clearTimeout(previous);
  if (waitMs <= 0) {
    const result = flushPhotoGroup(groupKey);
    void onFlush?.(result);
    return result;
  }
  const timer = setTimeout(() => {
    albumTimers.delete(groupKey);
    const result = flushPhotoGroup(groupKey);
    void onFlush?.(result);
  }, waitMs);
  albumTimers.set(groupKey, timer);
  return null;
}

export function flushDuePhotoGroups(maxAgeMs = ALBUM_WAIT_MS) {
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  const rows = getHomesteadDb()
    .prepare(
      `SELECT DISTINCT group_key FROM content_photo_intake
       WHERE status = 'buffered' AND created_at <= ?`,
    )
    .all(cutoff) as Array<{ group_key: string }>;
  return rows.map((row) => flushPhotoGroup(row.group_key));
}

export function batchReceivedText(input: {
  publicIds: string[];
  batchId: string;
  album: boolean;
  missing?: string[];
}) {
  const settings = getContentSettings();
  const lines = [
    "🏠 HOMESTEAD CONTENT STUDIO",
    "",
    `Recibí ${input.publicIds.length} ${input.publicIds.length === 1 ? "fotografía" : "fotografías"}${input.album ? " (álbum de Telegram)" : ""}.`,
    "Cada foto es una propuesta independiente, con imagen, texto y aprobación propia.",
    "",
    ...input.publicIds.map((id, index) => {
      const job = getJobByPublicId(id);
      const when = job?.recommendedPublishAt
        ? formatPanama(job.recommendedPublishAt, settings)
        : "horario por asignar";
      return `${index + 1}. ${id}\n   ${when}`;
    }),
  ];
  if (input.missing?.length) {
    lines.push("", `No pude recuperar ${input.missing.length} archivo(s).`);
  }
  if (input.publicIds.length >= 2) {
    lines.push(
      "",
      "Si parecen del mismo trabajo, puedes pedir carrusel. No lo haré por mi cuenta.",
      CAROUSEL_UNSUPPORTED,
    );
  }
  lines.push(
    "",
    "Puedes aprobar una por una o el lote de estas versiones.",
    "Publicar ahora es una acción explícita sobre UNA pieza.",
  );
  return lines.join("\n");
}

export function batchKeyboard(batchId: string, publicIds: string[]) {
  const rows: Array<Array<{ text: string; callback_data: string }>> = [
    [{ text: "✅ APROBAR LOTE", callback_data: `cs:bt:${batchId}:ok` }],
  ];
  if (publicIds[0]) {
    rows.push([{ text: "PUBLICAR UNA AHORA", callback_data: `cs:bt:${batchId}:nowpick` }]);
  }
  if (publicIds.length >= 2) {
    rows.push([{ text: "AGRUPAR CARRUSEL (no publicable)", callback_data: `cs:bt:${batchId}:car` }]);
  }
  return rows;
}

export function pickOneNowText(batchId: string) {
  const batch = getPhotoBatch(batchId);
  if (!batch) return "No encuentro ese lote.";
  const lines = [
    "Elige UNA pieza para publicar ahora. El resto sigue programado.",
    "No publicaré el lote completo a la vez.",
    "",
  ];
  for (const member of batch.members) {
    const job = getJobByPublicId(member.publicId);
    if (!job) continue;
    if (job.status === "PUBLISHED") {
      lines.push(`${member.publicId} — ya publicada. No la vuelvo a publicar.`);
    } else {
      lines.push(`${member.publicId} — toca PUBLICAR AHORA en su propuesta.`);
    }
  }
  return lines.join("\n");
}

export function pickOneNowKeyboard(batchId: string) {
  const batch = getPhotoBatch(batchId);
  if (!batch) return [];
  return batch.members
    .map((member) => {
      const job = getJobByPublicId(member.publicId);
      if (!job || job.status === "PUBLISHED") return null;
      const version = latestVersion(member.publicId)?.version || member.version || 1;
      return [{ text: `AHORA ${member.publicId}`, callback_data: `cs:${member.publicId}:now:v${version}` }];
    })
    .filter(Boolean) as Array<Array<{ text: string; callback_data: string }>>;
}

export function snapshotBatchVersions(batchId: string) {
  const batch = getPhotoBatch(batchId);
  if (!batch) return [];
  const members = batch.members.map((member) => ({
    ...member,
    version: latestVersion(member.publicId)?.version || member.version,
  }));
  saveBatchMembers(batchId, members);
  return members;
}

export function approvePhotoBatch(batchId: string, actor: string) {
  const batch = getPhotoBatch(batchId);
  if (!batch) return { ok: false as const, reason: "missing" as const };
  const approved: string[] = [];
  const stale: string[] = [];
  const already: string[] = [];
  const published: string[] = [];
  for (const member of batch.members) {
    const job = getJobByPublicId(member.publicId);
    if (!job) {
      stale.push(member.publicId);
      continue;
    }
    if (job.status === "PUBLISHED" || job.status === "SIMULATED") {
      published.push(member.publicId);
      continue;
    }
    const current = latestVersion(member.publicId)?.version || 0;
    if (member.version && current && member.version !== current) {
      stale.push(member.publicId);
      continue;
    }
    const result = tryApproveContentJob(member.publicId, actor);
    if (result.already) {
      already.push(member.publicId);
      continue;
    }
    if (!result.ok) {
      stale.push(member.publicId);
      continue;
    }
    updateJob(member.publicId, { approvedVersion: current || member.version || 1 });
    approved.push(member.publicId);
  }
  const toSchedule = [...approved, ...already].filter((id) => !published.includes(id));
  const slots = assignStaggeredSlots(toSchedule);
  const now = new Date().toISOString();
  for (const slot of slots) {
    const job = getJobByPublicId(slot.publicId);
    if (!job || job.status === "PUBLISHED") continue;
    updateJob(slot.publicId, {
      status: "SCHEDULED",
      approvedAt: job.approvedAt || now,
      recommendedPublishAt: slot.at,
      recommendationReason: slot.reason,
    });
    recordContentEvent(slot.publicId, "CONTENT_APPROVED", `batch:${batchId}`);
  }
  saveBatchMembers(batch.public_id, batch.members, "approved");
  return { ok: true as const, approved, stale, already, published, slots };
}

export function carouselSuggestionOnly(batchId: string) {
  const batch = getPhotoBatch(batchId);
  const count = batch?.members.length || 0;
  return [
    "Sugerencia: si esas fotos son del mismo trabajo, un carrusel las agruparía.",
    "",
    CAROUSEL_UNSUPPORTED,
    "",
    count
      ? `Mantengo ${count} propuestas independientes. No cambié tu elección.`
      : "No cambié ninguna propuesta.",
  ].join("\n");
}

export function abandonEmptyReceivingJob(chatId: string) {
  const existing = activeJobForChat(chatId);
  if (!existing) return;
  if (existing.status !== "RECEIVING" && existing.status !== "DRAFT") return;
  if (listAssets(existing.publicId, "ORIGINAL", 0).length > 0) return;
  updateJob(existing.publicId, { status: "CANCELLED" });
}

function publishedOriginalIndexes(publicId: string) {
  const published = listAssets(publicId, "PUBLISHED");
  const branded = listAssets(publicId).filter(
    (asset) => asset.assetType === "BRANDED" && asset.storedFilename.includes("-feed."),
  );
  const skip = new Set<number>();
  const mark = (filename: string) => {
    const match = filename.match(/-(\d+)-feed\./i);
    if (match) skip.add(Number(match[1]));
  };
  for (const item of published) {
    const twin = branded.find((asset) => asset.size === item.size || asset.sha256 === item.sha256);
    if (twin) mark(twin.storedFilename);
  }
  if (!skip.size && branded.length) mark(branded[branded.length - 1].storedFilename);
  return skip;
}

export function splitMultiOriginalJob(publicId: string) {
  const job = getJobByPublicId(publicId);
  if (!job) return { ok: false as const, reason: "missing" as const };
  const originals = listAssets(publicId, "ORIGINAL", 0);
  if (originals.length <= 1) {
    return { ok: true as const, kept: publicId, spawned: [] as string[], missing: [] as string[], alreadyOut: false, batchId: "" };
  }
  const alreadyOut = job.status === "PUBLISHED" || job.status === "SIMULATED";
  const skipIndexes = alreadyOut ? publishedOriginalIndexes(publicId) : new Set<number>();
  if (alreadyOut && skipIndexes.size === 0) skipIndexes.add(originals.length);
  const extras = originals.filter((_, index) => !skipIndexes.has(index + 1));
  const spawned: string[] = [];
  const missing: string[] = [];
  for (const asset of extras) {
    const bytes = readAssetBytes(asset);
    if (!bytes) {
      missing.push(asset.storedFilename);
      continue;
    }
    const byFile = asset.telegramFileId ? findOriginalByTelegramFileId(asset.telegramFileId) : null;
    const byHash = findOriginalBySha256(asset.sha256);
    const dup = (byFile && byFile !== publicId ? byFile : null) || (byHash && byHash !== publicId ? byHash : null);
    if (dup) {
      spawned.push(dup);
      continue;
    }
    const created = createContentJob({
      chatId: job.telegramChatId,
      userId: job.telegramUserId,
    });
    const stored = storeOriginal({
      job: created,
      bytes,
      mime: asset.mimeType,
      ext: asset.storedFilename.split(".").pop() || "jpg",
      telegramFileId: asset.telegramFileId || undefined,
      width: asset.width,
      height: asset.height,
    });
    if (!stored.ok) {
      missing.push(asset.storedFilename);
      continue;
    }
    updateJob(created.publicId, {
      status: "RECEIVING",
      description: job.description,
      mediaGroupId: job.mediaGroupId,
      format: "SINGLE_IMAGE",
    });
    recordContentEvent(created.publicId, "CONTENT_RECEIVED", `split-from:${publicId}`);
    spawned.push(created.publicId);
  }
  if (!alreadyOut && spawned.length) {
    updateJob(publicId, { status: "CANCELLED", lastError: "split_independent_proposals" });
    recordContentEvent(publicId, "CONTENT_CANCELLED", `split:${spawned.join(",")}`);
  }
  const members = spawned.map((id) => ({
    publicId: id,
    version: latestVersion(id)?.version || 0,
    telegramFileId: listAssets(id, "ORIGINAL", 0)[0]?.telegramFileId || "",
    sha256: listAssets(id, "ORIGINAL", 0)[0]?.sha256 || "",
  }));
  let batchId = "";
  if (members.length) {
    batchId = nextBatchPublicId();
    const now = new Date().toISOString();
    getHomesteadDb()
      .prepare(
        `INSERT INTO content_photo_batches
          (public_id, group_key, media_group_id, chat_id, member_json, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'proposed', ?, ?)`,
      )
      .run(
        batchId,
        `split:${publicId}`,
        job.mediaGroupId,
        job.telegramChatId,
        JSON.stringify(members),
        now,
        now,
      );
    for (const id of spawned) {
      updateJob(id, { photoBatchId: batchId, mediaGroupId: job.mediaGroupId });
    }
  }
  const scheduleIds = spawned.filter((id) => getJobByPublicId(id)?.status !== "PUBLISHED");
  if (scheduleIds.length) assignStaggeredSlots(scheduleIds);
  return {
    ok: true as const,
    kept: alreadyOut ? publicId : spawned[0] || publicId,
    spawned,
    missing,
    alreadyOut,
    batchId,
  };
}

export function inspectRecentPhotoSends() {
  const jobs = listRecentContentJobs(30);
  const multi = jobs.filter((job) => listAssets(job.publicId, "ORIGINAL", 0).length >= 2);
  const last = multi[0] || jobs.find((job) => listAssets(job.publicId, "ORIGINAL", 0).length >= 1) || null;
  return { jobs, multi, last };
}

export function recoverLastMultiPhotoJob() {
  const { multi } = inspectRecentPhotoSends();
  const target = multi[0];
  if (!target) return { ok: true as const, recovered: [] as string[], missing: [] as string[], published: [] as string[], source: "" };
  const split = splitMultiOriginalJob(target.publicId);
  if (!split.ok) return { ok: false as const, reason: split.reason };
  const published = [target].filter((job) => job.status === "PUBLISHED" || job.status === "SIMULATED").map((job) => job.publicId);
  return {
    ok: true as const,
    recovered: split.spawned,
    missing: split.missing,
    published,
    source: target.publicId,
    kept: split.kept,
    batchId: split.ok ? split.batchId || "" : "",
  };
}

export function looksLikeSameJobAlbum(count: number, mediaGroupId?: string) {
  return count >= 2 && Boolean(mediaGroupId);
}
