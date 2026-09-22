import {
  beginPublishLock,
  clearPublishLock,
  findPublication,
  getContentSettings,
  getContentVersion,
  getJobByPublicId,
  latestVersion,
  listAssets,
  readAssetBytes,
  recordContentEvent,
  recordPublication,
  storeDerivedAsset,
  updateJob,
  type ContentPublicationRecord,
} from "@/lib/content-catalog";
import { withCanonicalCta } from "@/lib/content-copy";
import {
  buildContentMediaUrl,
  nextPlatformAttempt,
  validatePublishImage,
} from "@/lib/content-media-url";
import {
  createGraphTransport,
  getFacebookPermalink,
  getInstagramPermalink,
  graphErrorMessage,
  instagramAccountId,
  platformConfigured,
  resolveFacebookPageId,
  type GraphTransport,
} from "@/lib/content-meta";
import {
  contentPublishGloballyBlocked,
  facebookReconcileDecision,
  jobUsesLiveOverride,
  shouldConsumeLiveOnce,
} from "@/lib/content-publish-policy";
import { logError, logInfo } from "@/lib/log";
import { sendTelegramMessage } from "@/lib/content-telegram";
import { site } from "@/lib/site";
import type { ContentAsset, ContentJob } from "@/lib/content-types";

const IG_POLL_ATTEMPTS = 12;
const IG_POLL_MS = 2000;

export type PlatformPublishResult = {
  platform: "instagram" | "facebook";
  outcome: "published" | "simulated" | "already" | "failed" | "uncertain" | "skipped";
  id?: string;
  permalink?: string;
  cause?: string;
  action?: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function siteBase() {
  return (process.env.NEXT_PUBLIC_SITE_URL?.trim() || site.url || "https://homestead.lat").replace(
    /\/$/,
    "",
  );
}

export { jobUsesLiveOverride } from "@/lib/content-publish-policy";

function humanCause(cause: string) {
  const map: Record<string, { text: string; action: string }> = {
    instagram_unconfigured:
      { text: "Instagram no está conectado (falta INSTAGRAM_ACCOUNT_ID o el token de Página).", action: "Completa las variables Meta en el servidor." },
    facebook_unconfigured:
      { text: "Facebook no está conectado (falta FACEBOOK_PAGE_ID o el token de Página).", action: "Completa FACEBOOK_PAGE_ID y META_PAGE_ACCESS_TOKEN." },
    meta_token_unconfigured:
      { text: "No hay token de Página de Meta.", action: "Pega META_PAGE_ACCESS_TOKEN en el .env del VPS (no en el chat)." },
    image_missing: { text: "No encontré la imagen aprobada.", action: "Vuelve a generar la pieza y aprueba la versión nueva." },
    image_url_unconfigured: { text: "No pude firmar la URL de la imagen.", action: "Configura CONTENT_MEDIA_SIGNING_SECRET o N8N_HOMESTEAD_WEBHOOK_SECRET." },
    image_not_jpeg: { text: "La imagen no es JPEG válido.", action: "Reprocesa la pieza." },
    image_too_large: { text: "La imagen supera 8 MB.", action: "Reprocesa la pieza." },
    image_too_small: { text: "La imagen es demasiado pequeña para Instagram.", action: "Reprocesa la pieza." },
    image_aspect_unsupported: { text: "La proporción de la imagen no es válida para feed.", action: "Reprocesa a 4:5." },
    stale_version: { text: "La versión aprobada ya no coincide con la actual.", action: "Revisa y aprueba de nuevo." },
    paused: {
      text: "El estudio está en pausa de emergencia. Tampoco salen las piezas autorizadas una a una.",
      action: "Usa /reanudar solo cuando quieras volver a permitir publicaciones.",
    },
    publish_disabled: {
      text: "La publicación está bloqueada (CONTENT_PUBLISH_ENABLED=false).",
      action: "Quita el bloqueo en el servidor cuando sea seguro.",
    },
    locked: { text: "Ya hay una publicación en curso.", action: "Espera un momento y no pulses otra vez." },
    meta_timeout: { text: "Meta no respondió a tiempo.", action: "Reintenta; si ya salió el post, no lo dupliques — el sistema reconcilia." },
    meta_network: { text: "No pude hablar con Graph API.", action: "Reintenta más tarde." },
    facebook_uncertain_unverified: {
      text: "Facebook no confirmó el post y no hay un ID guardado. No asocio otro post por el texto.",
      action: "Revisa la Page. Si no salió, confirma EN VIVO otra vez (puede duplicar si ya estaba publicado).",
    },
  };
  return map[cause] || { text: cause.slice(0, 160), action: "Revisa el Centro de Operaciones o reintenta esta pieza." };
}

async function waitInstagramContainer(containerId: string, transport: GraphTransport) {
  let last = "";
  for (let i = 0; i < IG_POLL_ATTEMPTS; i += 1) {
    const got = await transport.request({
      method: "GET",
      path: `${containerId}?fields=status_code,status`,
    });
    const code = String(got.json.status_code || "").toUpperCase();
    last = code || graphErrorMessage(got.json, "container_status_unknown");
    if (!code && got.json.id) return { ok: true as const, code: "FINISHED" };
    if (code === "FINISHED" || code === "PUBLISHED") return { ok: true as const, code };
    if (code === "ERROR" || code === "EXPIRED") {
      return { ok: false as const, code, cause: graphErrorMessage(got.json, code.toLowerCase()) };
    }
    await sleep(IG_POLL_MS);
  }
  return { ok: false as const, code: last || "IN_PROGRESS", cause: "instagram_container_timeout" };
}

async function publishInstagram(input: {
  caption: string;
  imageUrl: string;
  existing?: ContentPublicationRecord | null;
  transport: GraphTransport;
}): Promise<{
  ok: boolean;
  status: "PUBLISHED" | "FAILED" | "UNCERTAIN";
  id?: string;
  permalink?: string;
  cause?: string;
  containerId?: string;
}> {
  const ig = instagramAccountId();
  if (!ig) return { ok: false, status: "FAILED", cause: "instagram_unconfigured" };
  let containerId = input.existing?.containerId || "";
  if (!containerId) {
    const created = await input.transport.request({
      method: "POST",
      path: `${ig}/media`,
      body: { image_url: input.imageUrl, caption: input.caption },
    });
    containerId = created.json.id || "";
    if (!containerId) {
      const cause = graphErrorMessage(created.json, "instagram_create_failed");
      const uncertain = created.status === 0 || /timeout|network/i.test(cause);
      return { ok: false, status: uncertain ? "UNCERTAIN" : "FAILED", cause };
    }
  }
  const ready = await waitInstagramContainer(containerId, input.transport);
  if (ready.ok && ready.code === "PUBLISHED") {
    const id = containerId;
    const permalink = await getInstagramPermalink(id, input.transport);
    return { ok: true, status: "PUBLISHED", id, permalink, containerId };
  }
  if (!ready.ok && ready.code !== "IN_PROGRESS") {
    return { ok: false, status: "FAILED", cause: ready.cause, containerId };
  }
  const published = await input.transport.request({
    method: "POST",
    path: `${ig}/media_publish`,
    body: { creation_id: containerId },
  });
  const id = published.json.id || "";
  if (!id) {
    const cause = graphErrorMessage(published.json, "instagram_publish_failed");
    const uncertain = published.status === 0 || /timeout|network/i.test(cause);
    if (uncertain) {
      const again = await waitInstagramContainer(containerId, input.transport);
      if (again.ok && again.code === "PUBLISHED") {
        const permalink = await getInstagramPermalink(containerId, input.transport);
        return { ok: true, status: "PUBLISHED", id: containerId, permalink, containerId };
      }
      return { ok: false, status: "UNCERTAIN", cause, containerId };
    }
    return { ok: false, status: "FAILED", cause, containerId };
  }
  const permalink = (await getInstagramPermalink(id, input.transport)) || "";
  return { ok: true, status: "PUBLISHED", id, permalink, containerId };
}

async function lookupFacebookPost(postId: string, transport: GraphTransport) {
  const got = await transport.request({
    method: "GET",
    path: `${postId}?fields=id,permalink_url`,
  });
  const id = got.json.id || "";
  if (!id) return null;
  return {
    id,
    permalink: got.json.permalink_url || got.json.permalink || `https://www.facebook.com/${id}`,
  };
}

async function publishFacebook(input: {
  caption: string;
  imageUrl: string;
  existing?: ContentPublicationRecord | null;
  transport: GraphTransport;
  source: "now" | "scheduler" | "live";
}): Promise<{
  ok: boolean;
  status: "PUBLISHED" | "FAILED" | "UNCERTAIN";
  id?: string;
  permalink?: string;
  cause?: string;
  containerId?: string;
}> {
  const page = resolveFacebookPageId();
  if (!page.id) return { ok: false, status: "FAILED", cause: "facebook_unconfigured" };
  const decision = facebookReconcileDecision({
    existingStatus: input.existing?.status,
    existingPostId: input.existing?.externalPostId,
    source: input.source,
  });
  if (decision.action === "lookup_stored_id") {
    const found = await lookupFacebookPost(decision.postId, input.transport);
    if (found?.id) {
      return { ok: true, status: "PUBLISHED", id: found.id, permalink: found.permalink };
    }
    if (input.source !== "live") {
      return { ok: false, status: "UNCERTAIN", cause: "facebook_uncertain_unverified" };
    }
  }
  if (decision.action === "cannot_reconcile") {
    return { ok: false, status: "UNCERTAIN", cause: "facebook_uncertain_unverified" };
  }
  const posted = await input.transport.request({
    method: "POST",
    path: `${page.id}/photos`,
    body: { url: input.imageUrl, caption: input.caption, published: "true" },
  });
  const postId = posted.json.post_id || posted.json.id || "";
  if (!postId) {
    const cause = graphErrorMessage(posted.json, "facebook_publish_failed");
    const uncertain = posted.status === 0 || /timeout|network/i.test(cause);
    if (uncertain && input.existing?.externalPostId) {
      const found = await lookupFacebookPost(input.existing.externalPostId, input.transport);
      if (found?.id) {
        return { ok: true, status: "PUBLISHED", id: found.id, permalink: found.permalink };
      }
    }
    return { ok: false, status: uncertain ? "UNCERTAIN" : "FAILED", cause };
  }
  const permalink =
    (await getFacebookPermalink(postId, input.transport)) || `https://www.facebook.com/${postId}`;
  return { ok: true, status: "PUBLISHED", id: postId, permalink };
}

function brandedFeed(publicId: string, version: number) {
  return listAssets(publicId, "BRANDED", version).filter((asset) =>
    asset.storedFilename.includes("-feed."),
  )[0] as ContentAsset | undefined;
}

function formatTelegramResult(publicId: string, live: boolean, rows: PlatformPublishResult[]) {
  const header = live
    ? `Resultado de publicación\n\n${publicId}`
    : `SIMULACIÓN — no salió en Instagram ni Facebook.\n\n${publicId}`;
  const lines = rows.map((row) => {
    const label = row.platform === "instagram" ? "Instagram" : "Facebook";
    if (row.outcome === "published") {
      return `${label}: Publicado${row.permalink ? `\n${row.permalink}` : row.id ? `\nID ${row.id}` : ""}`;
    }
    if (row.outcome === "simulated") return `${label}: Simulado (dry-run)`;
    if (row.outcome === "already") return `${label}: Ya estaba publicado`;
    if (row.outcome === "uncertain") {
      const hint = humanCause(row.cause || "resultado pendiente de verificar");
      return `${label}: Resultado pendiente de verificar.\n${hint.text}\nAcción: ${hint.action}`;
    }
    if (row.outcome === "skipped") return `${label}: No aplica`;
    const hint = humanCause(row.cause || "failed");
    return `${label}: Falló.\n${hint.text}\nAcción: ${hint.action}`;
  });
  return [header, "", ...lines].join("\n");
}

export async function publishJob(
  publicId: string,
  source: "now" | "scheduler" | "live",
  transport: GraphTransport = createGraphTransport(),
) {
  const job = getJobByPublicId(publicId);
  if (!job) return { ok: false as const, cause: "missing" };
  const settings = getContentSettings();
  if (settings.paused) {
    return { ok: false as const, cause: "paused" };
  }
  if (contentPublishGloballyBlocked()) {
    return { ok: false as const, cause: "publish_disabled" };
  }
  if (settings.mode === "MANUAL" && source === "scheduler") {
    return { ok: false as const, cause: "manual_mode" };
  }
  if (!beginPublishLock(publicId, 180_000)) {
    return { ok: false as const, cause: "locked" };
  }
  const live = jobUsesLiveOverride(job, settings.dryRun, source, settings.paused);
  if (shouldConsumeLiveOnce(live, source)) {
    updateJob(publicId, { liveOnce: 0 });
  }
  const versionNumber = job.approvedVersion || latestVersion(publicId)?.version || 0;
  const version = versionNumber ? getContentVersion(publicId, versionNumber) : latestVersion(publicId);
  const latest = latestVersion(publicId);
  if (latest && version && latest.version !== version.version && source !== "now") {
    clearPublishLock(publicId);
    updateJob(publicId, { status: "AWAITING_APPROVAL", lastError: "stale_version" });
    await sendTelegramMessage({
      chatId: job.telegramChatId,
      text: `La pieza ${publicId} cambió después de aprobarse. Aprueba V${latest.version} antes de publicar.`,
    });
    return { ok: false as const, cause: "stale_version" };
  }
  const caption = withCanonicalCta(job.selectedCaption || version?.copy || "");
  const platforms = (settings.platforms.length ? settings.platforms : ["instagram", "facebook"]).filter(
    (item): item is "instagram" | "facebook" => item === "instagram" || item === "facebook",
  );
  try {
    updateJob(publicId, { status: "PUBLISHING" });
    recordContentEvent(publicId, "CONTENT_PUBLISHING", `${source}:${live ? "live" : "dry"}`);
    const feed = versionNumber ? brandedFeed(publicId, versionNumber) : undefined;
    const bytes = feed ? readAssetBytes(feed) : null;
    const results: PlatformPublishResult[] = [];

    let imageUrl = "";
    if (live) {
      if (!feed || !bytes) {
        for (const platform of platforms) {
          recordPublication({
            publicId,
            platform,
            dryRun: false,
            status: "FAILED",
            caption,
            error: "image_missing",
            version: versionNumber,
          });
          results.push({ platform, outcome: "failed", cause: "image_missing" });
        }
      } else {
        const valid = validatePublishImage({
          bytes,
          mime: feed.mimeType,
          width: feed.width,
          height: feed.height,
        });
        if (!valid.ok) {
          for (const platform of platforms) {
            recordPublication({
              publicId,
              platform,
              dryRun: false,
              status: "FAILED",
              caption,
              error: valid.cause,
              version: versionNumber,
            });
            results.push({ platform, outcome: "failed", cause: valid.cause });
          }
        } else {
          const signed = buildContentMediaUrl({
            siteUrl: siteBase(),
            publicId,
            assetId: feed.id,
          });
          if (!signed.ok) {
            for (const platform of platforms) {
              recordPublication({
                publicId,
                platform,
                dryRun: false,
                status: "FAILED",
                caption,
                error: signed.cause,
                version: versionNumber,
              });
              results.push({ platform, outcome: "failed", cause: signed.cause });
            }
          } else {
            imageUrl = signed.url;
          }
        }
      }
    }

    for (const platform of platforms) {
      if (results.some((row) => row.platform === platform)) continue;
      const existing = findPublication(publicId, platform, live);
      const attempt = nextPlatformAttempt(existing, live);
      if (attempt === "skip_published") {
        results.push({
          platform,
          outcome: "already",
          id: existing?.externalPostId,
          permalink: existing?.permalink,
        });
        continue;
      }
      if (!live) {
        recordPublication({
          publicId,
          platform,
          dryRun: true,
          status: "SIMULATED",
          caption,
          externalPostId: `dry-${publicId}-${platform}`,
          version: versionNumber,
        });
        results.push({ platform, outcome: "simulated" });
        continue;
      }
      if (!platformConfigured(platform)) {
        recordPublication({
          publicId,
          platform,
          dryRun: false,
          status: "FAILED",
          caption,
          error: platform === "instagram" ? "instagram_unconfigured" : "facebook_unconfigured",
          version: versionNumber,
        });
        results.push({
          platform,
          outcome: "failed",
          cause: platform === "instagram" ? "instagram_unconfigured" : "facebook_unconfigured",
        });
        continue;
      }
      if (!imageUrl) {
        results.push({ platform, outcome: "failed", cause: "image_missing" });
        continue;
      }
      recordPublication({
        publicId,
        platform,
        dryRun: false,
        status: "PUBLISHING",
        caption,
        containerId: existing?.containerId,
        version: versionNumber,
      });
      const published =
        platform === "instagram"
          ? await publishInstagram({
              caption,
              imageUrl,
              existing,
              transport,
            })
          : await publishFacebook({
              caption,
              imageUrl,
              existing,
              transport,
              source,
            });
      if (published.ok && published.status === "PUBLISHED") {
        if (feed && bytes) {
          storeDerivedAsset({
            job,
            version: version?.version || 1,
            assetType: "PUBLISHED",
            role: feed.role,
            bytes,
            mime: "image/jpeg",
            ext: "jpg",
            folder: "published",
            filename: `published-${platform}-v${version?.version || 1}.jpg`,
            width: feed.width,
            height: feed.height,
          });
        }
        recordPublication({
          publicId,
          platform,
          dryRun: false,
          status: "PUBLISHED",
          caption,
          externalPostId: published.id,
          permalink: published.permalink,
          containerId: published.containerId || "",
          version: versionNumber,
        });
        results.push({
          platform,
          outcome: "published",
          id: published.id,
          permalink: published.permalink,
        });
        continue;
      }
      recordPublication({
        publicId,
        platform,
        dryRun: false,
        status: published.status,
        caption,
        error: published.cause,
        containerId: published.containerId || existing?.containerId,
        version: versionNumber,
      });
      results.push({
        platform,
        outcome: published.status === "UNCERTAIN" ? "uncertain" : "failed",
        cause: published.cause,
      });
    }

    const anyPublished = results.some((row) => row.outcome === "published" || row.outcome === "already");
    const anySimulated = results.some((row) => row.outcome === "simulated");
    const anyUncertain = results.some((row) => row.outcome === "uncertain");
    const anyFailed = results.some((row) => row.outcome === "failed");
    const liveComplete =
      live && results.length > 0 && results.every((row) => row.outcome === "published" || row.outcome === "already");

    if (liveComplete) {
      updateJob(publicId, {
        status: "PUBLISHED",
        approvedAt: job.approvedAt || new Date().toISOString(),
        liveOnce: 0,
        lastError: null,
      });
      recordContentEvent(publicId, "CONTENT_PUBLISHED", results.map((row) => `${row.platform}:${row.outcome}`).join(","));
      logInfo("ContentPublished", { contentJobId: publicId, stage: source });
    } else if (!live && anySimulated && !anyFailed) {
      updateJob(publicId, { status: "SIMULATED", lastError: null, liveOnce: 0 });
      recordContentEvent(publicId, "CONTENT_SIMULATED", results.map((row) => row.platform).join(","));
      logInfo("ContentPublished", { contentJobId: publicId, stage: "dry-run" });
    } else if (anyPublished || anyUncertain) {
      updateJob(publicId, {
        status: "NEEDS_REVIEW",
        lastError: results.map((row) => `${row.platform}:${row.outcome}`).join(",").slice(0, 180),
        liveOnce: 0,
      });
      recordContentEvent(publicId, "CONTENT_PARTIAL", results.map((row) => `${row.platform}:${row.outcome}`).join(","));
    } else {
      updateJob(publicId, {
        status: "NEEDS_REVIEW",
        lastError: results.map((row) => `${row.platform}:${row.cause || row.outcome}`).join(",").slice(0, 180),
        liveOnce: 0,
      });
      recordContentEvent(publicId, "CONTENT_FAILED", results.map((row) => `${row.platform}:${row.cause || row.outcome}`).join(","));
    }

    const liveKeyboard =
      !live && settings.dryRun
        ? [[{ text: "PUBLICAR EN VIVO ESTA PIEZA", callback_data: `cs:${publicId}:live:v${version?.version || versionNumber}` }]]
        : anyFailed || anyUncertain
          ? [[{ text: "REINTENTAR EN VIVO (confirmar)", callback_data: `cs:${publicId}:live:v${version?.version || versionNumber}` }]]
          : undefined;

    await sendTelegramMessage({
      chatId: job.telegramChatId,
      text: formatTelegramResult(publicId, live, results),
      keyboard: liveKeyboard,
    });

    const ok = live ? liveComplete || (anyPublished && !anyFailed && !anyUncertain) : anySimulated;
    return { ok: ok as boolean, dryRun: !live, results };
  } catch (error) {
    const cause = error instanceof Error ? error.message : "unknown";
    logError("ContentPublishFailed", { contentJobId: publicId, cause: cause.slice(0, 180) });
    updateJob(publicId, { status: "NEEDS_REVIEW", lastError: cause.slice(0, 180) });
    await sendTelegramMessage({
      chatId: job.telegramChatId,
      text: `⚠️ No pude publicar.\n\n${publicId}\n\nTu contenido está seguro y NO se perdió.\nAcción: reintenta esta pieza. Si el post ya salió en Meta, no lo vuelvas a crear — el sistema reconcilia resultados inciertos.`,
    });
    return { ok: false as const, cause };
  } finally {
    clearPublishLock(publicId);
  }
}
