import { logError, logInfo } from "@/lib/log";

export const DEFAULT_META_GRAPH_VERSION = "v22.0";

export type MetaPlatform = "instagram" | "facebook";

export type GraphJson = {
  id?: string;
  post_id?: string;
  permalink?: string;
  permalink_url?: string;
  link?: string;
  status_code?: string;
  status?: string;
  name?: string;
  username?: string;
  instagram_business_account?: { id?: string };
  data?: unknown;
  error?: { message?: string; code?: number; error_subcode?: number; type?: string };
};

export type GraphTransport = {
  request(input: {
    method: "GET" | "POST";
    path: string;
    body?: Record<string, string>;
  }): Promise<{ status: number; json: GraphJson }>;
};

function graphVersion() {
  const raw = process.env.META_GRAPH_VERSION?.trim() || DEFAULT_META_GRAPH_VERSION;
  return raw.startsWith("v") ? raw : `v${raw}`;
}

export function resolveFacebookPageId() {
  const facebook = process.env.FACEBOOK_PAGE_ID?.trim() || "";
  const legacy = process.env.META_PAGE_ID?.trim() || "";
  if (facebook && legacy && facebook !== legacy) {
    logError("MetaPageIdConflict", {
      cause: "FACEBOOK_PAGE_ID_and_META_PAGE_ID_differ",
      stage: "FACEBOOK_PAGE_ID_wins",
    });
    return { id: facebook, source: "FACEBOOK_PAGE_ID" as const, conflict: true };
  }
  if (facebook) return { id: facebook, source: "FACEBOOK_PAGE_ID" as const, conflict: false };
  if (legacy) return { id: legacy, source: "META_PAGE_ID" as const, conflict: false };
  return { id: "", source: "" as const, conflict: false };
}

export function metaPageAccessToken() {
  return process.env.META_PAGE_ACCESS_TOKEN?.trim() || "";
}

export function instagramAccountId() {
  return process.env.INSTAGRAM_ACCOUNT_ID?.trim() || "";
}

export function metaTokenConfigured() {
  return Boolean(metaPageAccessToken());
}

export function platformConfigured(platform: MetaPlatform) {
  if (!metaTokenConfigured()) return false;
  if (platform === "instagram") return Boolean(instagramAccountId());
  return Boolean(resolveFacebookPageId().id);
}

export function anyMetaPlatformConfigured() {
  return platformConfigured("instagram") || platformConfigured("facebook");
}

function summarizeGraphError(json: GraphJson, fallback: string) {
  const message = json.error?.message || fallback;
  return message.replace(/access_token=[^&\s]+/gi, "access_token=[REDACTED]").slice(0, 180);
}

export function createGraphTransport(token = metaPageAccessToken()): GraphTransport {
  return {
    async request(input) {
      if (!token) {
        return {
          status: 0,
          json: { error: { message: "meta_token_unconfigured" } },
        };
      }
      const url = new URL(`https://graph.facebook.com/${graphVersion()}/${input.path.replace(/^\//, "")}`);
      const init: RequestInit = { method: input.method };
      if (input.method === "GET") {
        url.searchParams.set("access_token", token);
        init.headers = { Accept: "application/json" };
      } else {
        const body = new URLSearchParams({ ...(input.body || {}), access_token: token });
        init.headers = { "Content-Type": "application/x-www-form-urlencoded" };
        init.body = body.toString();
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25_000);
      try {
        const response = await fetch(url.toString(), { ...init, signal: controller.signal });
        const json = (await response.json().catch(() => ({}))) as GraphJson;
        return { status: response.status, json };
      } catch (error) {
        const cause = error instanceof Error ? error.name : "unknown";
        return {
          status: 0,
          json: { error: { message: cause === "AbortError" ? "meta_timeout" : "meta_network" } },
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export async function inspectMetaConnections(transport: GraphTransport = createGraphTransport()) {
  const token = metaTokenConfigured();
  const page = resolveFacebookPageId();
  const ig = instagramAccountId();
  const result = {
    tokenConfigured: token,
    graphVersion: graphVersion(),
    facebookPageId: page.id ? "SET" : "EMPTY",
    facebookPageSource: page.source || "none",
    facebookPageConflict: page.conflict,
    instagramAccountId: ig ? "SET" : "EMPTY",
    page: null as { id: string; name: string } | { error: string } | null,
    instagram: null as { id: string; username: string } | { error: string } | null,
  };
  if (!token) return result;
  if (page.id) {
    const got = await transport.request({
      method: "GET",
      path: `${page.id}?fields=id,name,instagram_business_account`,
    });
    if (got.json.id) {
      result.page = { id: "SET", name: String(got.json.name || "").slice(0, 80) };
      logInfo("MetaPageInspected", { stage: "ok" });
    } else {
      result.page = { error: summarizeGraphError(got.json, "page_lookup_failed") };
      logError("MetaPageInspectFailed", { cause: result.page.error });
    }
  }
  if (ig) {
    const got = await transport.request({
      method: "GET",
      path: `${ig}?fields=id,username,name`,
    });
    if (got.json.id) {
      result.instagram = { id: "SET", username: String(got.json.username || "").slice(0, 80) };
      logInfo("MetaInstagramInspected", { stage: "ok" });
    } else {
      result.instagram = { error: summarizeGraphError(got.json, "instagram_lookup_failed") };
      logError("MetaInstagramInspectFailed", { cause: result.instagram.error });
    }
  }
  return result;
}

export function graphErrorMessage(json: GraphJson, fallback: string) {
  return summarizeGraphError(json, fallback);
}

export async function getInstagramPermalink(
  mediaId: string,
  transport: GraphTransport,
) {
  const got = await transport.request({
    method: "GET",
    path: `${mediaId}?fields=id,permalink`,
  });
  return got.json.permalink || "";
}

export async function getFacebookPermalink(
  postId: string,
  transport: GraphTransport,
) {
  const got = await transport.request({
    method: "GET",
    path: `${postId}?fields=id,permalink_url`,
  });
  if (got.json.permalink_url) return got.json.permalink_url;
  return postId ? `https://www.facebook.com/${postId}` : "";
}
