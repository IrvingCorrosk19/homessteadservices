import {
  beginPublishLock,
  clearPublishLock,
  findPublication,
  getContentSettings,
  getJobByPublicId,
  latestVersion,
  listAssets,
  readAssetBytes,
  recordContentEvent,
  recordPublication,
  storeDerivedAsset,
  updateJob,
} from "@/lib/content-catalog";
import { logError, logInfo } from "@/lib/log";
import { sendTelegramMessage } from "@/lib/content-telegram";

function metaConfigured() {
  return Boolean(
    process.env.META_PAGE_ACCESS_TOKEN?.trim() &&
      (process.env.INSTAGRAM_ACCOUNT_ID?.trim() || process.env.FACEBOOK_PAGE_ID?.trim()),
  );
}

async function publishInstagram(caption: string, imageBytes: Buffer) {
  const token = process.env.META_PAGE_ACCESS_TOKEN!.trim();
  const ig = process.env.INSTAGRAM_ACCOUNT_ID?.trim();
  if (!ig) return { ok: false as const, cause: "instagram_unconfigured" };
  const uploaded = await fetch(`https://graph.facebook.com/v21.0/${ig}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      caption,
      access_token: token,
    }),
  });
  void imageBytes;
  const json = (await uploaded.json()) as { id?: string; error?: { message?: string } };
  if (!json.id) return { ok: false as const, cause: json.error?.message || "instagram_create_failed" };
  const published = await fetch(`https://graph.facebook.com/v21.0/${ig}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: json.id, access_token: token }),
  });
  const done = (await published.json()) as { id?: string; error?: { message?: string } };
  if (!done.id) return { ok: false as const, cause: done.error?.message || "instagram_publish_failed" };
  return { ok: true as const, id: done.id };
}

export async function publishJob(publicId: string, source: "now" | "scheduler") {
  const job = getJobByPublicId(publicId);
  if (!job) return { ok: false as const, cause: "missing" };
  const settings = getContentSettings();
  if (settings.paused) {
    return { ok: false as const, cause: "paused" };
  }
  if (settings.mode === "MANUAL" && source === "scheduler") {
    return { ok: false as const, cause: "manual_mode" };
  }
  if (!beginPublishLock(publicId)) {
    return { ok: false as const, cause: "locked" };
  }
  const version = latestVersion(publicId);
  const caption = job.selectedCaption || version?.copy || "";
  const platforms = settings.platforms.length ? settings.platforms : ["instagram", "facebook"];
  const dryRun = settings.dryRun || !metaConfigured();
  try {
    updateJob(publicId, { status: "PUBLISHING" });
    recordContentEvent(publicId, "CONTENT_PUBLISHING", source);
    const branded = listAssets(publicId, "BRANDED").filter((asset) =>
      asset.storedFilename.includes("-feed."),
    );
    const first = branded[0] ? readAssetBytes(branded[0]) : null;
    const results: string[] = [];
    for (const platform of platforms) {
      const existing = findPublication(publicId, platform, dryRun);
      if (existing?.status === "PUBLISHED") {
        results.push(`${platform}: already`);
        continue;
      }
      if (dryRun) {
        recordPublication({
          publicId,
          platform,
          dryRun: true,
          status: "PUBLISHED",
          caption,
          externalPostId: `dry-${publicId}-${platform}`,
        });
        results.push(`${platform}: dry-run`);
        continue;
      }
      if (!metaConfigured() || !first) {
        recordPublication({
          publicId,
          platform,
          dryRun: false,
          status: "FAILED",
          caption,
          error: "not_configured",
        });
        results.push(`${platform}: not_configured`);
        continue;
      }
      const published =
        platform === "instagram"
          ? await publishInstagram(caption, first)
          : { ok: false as const, cause: "facebook_uses_page_token_unconfigured" };
      if (!published.ok) {
        recordPublication({
          publicId,
          platform,
          dryRun: false,
          status: "FAILED",
          caption,
          error: published.cause,
        });
        results.push(`${platform}: failed`);
        continue;
      }
      if (branded[0] && first) {
        storeDerivedAsset({
          job,
          version: version?.version || 1,
          assetType: "PUBLISHED",
          role: branded[0].role,
          bytes: first,
          mime: "image/jpeg",
          ext: "jpg",
          folder: "published",
          filename: `published-${platform}.jpg`,
          width: branded[0].width,
          height: branded[0].height,
        });
      }
      recordPublication({
        publicId,
        platform,
        dryRun: false,
        status: "PUBLISHED",
        caption,
        externalPostId: published.id,
      });
      results.push(`${platform}: published`);
    }
    const anyFail = results.some((item) => item.includes("failed") || item.includes("not_configured"));
    const anyOk = results.some((item) => item.includes("published") || item.includes("dry-run") || item.includes("already"));
    if (anyOk && !results.every((item) => item.includes("failed"))) {
      updateJob(publicId, {
        status: dryRun || anyFail ? (anyFail && !anyOk ? "NEEDS_REVIEW" : "PUBLISHED") : "PUBLISHED",
        approvedAt: job.approvedAt || new Date().toISOString(),
      });
      if (dryRun) {
        updateJob(publicId, { status: "PUBLISHED" });
      }
      recordContentEvent(publicId, "CONTENT_PUBLISHED", results.join(","));
      logInfo("ContentPublished", { contentJobId: publicId, stage: dryRun ? "dry-run" : source });
      await sendTelegramMessage({
        chatId: job.telegramChatId,
        text: dryRun
          ? `DRY RUN — publicación simulada.\n\n${publicId}\n\n${results.join("\n")}\n\nNo salió en Instagram ni Facebook.`
          : `Publicado.\n\n${publicId}\n\n${results.join("\n")}`,
      });
      return { ok: true as const, dryRun, results };
    }
    updateJob(publicId, { status: "NEEDS_REVIEW", lastError: results.join(",") });
    recordContentEvent(publicId, "CONTENT_FAILED", results.join(","));
    await sendTelegramMessage({
      chatId: job.telegramChatId,
      text: `⚠️ No pude publicar.\n\n${publicId}\n\nTu contenido está seguro y NO se perdió.\nLo dejé pendiente para revisión.`,
    });
    return { ok: false as const, cause: "publish_failed", results };
  } catch (error) {
    const cause = error instanceof Error ? error.message : "unknown";
    logError("ContentPublishFailed", { contentJobId: publicId, cause: cause.slice(0, 180) });
    updateJob(publicId, { status: "NEEDS_REVIEW", lastError: cause.slice(0, 180) });
    await sendTelegramMessage({
      chatId: job.telegramChatId,
      text: `⚠️ No pude publicar.\n\n${publicId}\n\nTu contenido está seguro y NO se perdió.`,
    });
    return { ok: false as const, cause };
  } finally {
    clearPublishLock(publicId);
  }
}
