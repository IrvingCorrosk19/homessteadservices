import { NextResponse } from "next/server";
import {
  conciergeTurn,
  isConciergeEnabled,
  startConcierge,
} from "@/lib/concierge-engine";
import {
  addEvent,
  countRecentByIp,
  countRecentMessages,
  getConversation,
  hashIp,
  recentMessages,
  touchConversation,
} from "@/lib/concierge-store";
import { areOfferedSlotsActive, buildSessionSnapshot, clearActiveTransactionState } from "@/lib/concierge-transaction";
import { parseConciergePhotoMessage } from "@/lib/concierge-photo-message";
import { logError, logInfo } from "@/lib/log";
import { CONCIERGE_BUILD_MARKER, CONCIERGE_PROMPT_VERSION } from "@/lib/concierge-knowledge";
import { isWebsiteImageChatContext } from "@/lib/concierge-entry-context";
import { startChatFromWebsiteImage } from "@/lib/concierge/website-image-context";

export const runtime = "nodejs";

const COOKIE = "hs_cid";

function conciergeE2EMode() {
  return process.env.NODE_ENV !== "production" && /e2e-cert/i.test(process.env.DATA_DIR || "");
}

function readStoredImageContext(state: { facts?: Record<string, string> } | undefined) {
  const raw = state?.facts?.websiteImageContext;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isWebsiteImageChatContext(parsed) ? parsed : null;
  } catch {
    return null;
  }
}


function clientIp(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "0.0.0.0"
  );
}

function originOk(request: Request) {
  const origin = request.headers.get("origin") || "";
  const host = request.headers.get("host") || "";
  if (!origin) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function cookieId(request: Request) {
  const header = request.headers.get("cookie") || "";
  const match = header.match(/(?:^|; )hs_cid=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

export async function GET(request: Request) {
  if (!isConciergeEnabled()) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }
  const conversationId = cookieId(request);
  if (!conversationId || !getConversation(conversationId)) {
    return NextResponse.json({ ok: true, messages: [], conversationId: null });
  }
  logInfo("CONVERSATION_HYDRATED", {
    contentJobId: conversationId.slice(0, 8),
    stage: "get",
  });
  const messages = recentMessages(conversationId, 30).map((item) => {
    const photo = parseConciergePhotoMessage(item.body);
    if (photo) {
      return {
        role: item.role,
        body: photo.caption,
        photoId: photo.photoId,
      };
    }
    return { role: item.role, body: item.body };
  });
  const conversation = getConversation(conversationId);
  let state = conversation?.state;
  if (conversation && state) {
    if (!areOfferedSlotsActive(state) && (state.offeredSlots.length || state.awaitingSlotSelection)) {
      state = clearActiveTransactionState(state, state.offeredSlots.length > 0);
      touchConversation(conversationId, { state });
    }
  }
  const session = state ? buildSessionSnapshot(state, Date.now(), state.activeLeadId || "") : {
    chips: [],
    historicalChips: [],
    leadBanner: null,
    requestCard: null,
    awaitingSlotSelection: false,
    bookingPending: false,
    slotGroups: [],
    serviceContext: null,
    showResumeBooking: false,
    showPhotoCta: false,
    photosRemaining: 4,
  };
  return NextResponse.json({
    ok: true,
    conversationId,
    messages,
    chips: session.chips,
    historicalChips: session.historicalChips,
    leadBanner: session.leadBanner,
    leadId: session.leadBanner,
    requestCard: session.requestCard,
    awaitingSlotSelection: session.awaitingSlotSelection,
    bookingPending: session.bookingPending,
    slotGroups: session.slotGroups,
    serviceContext: session.serviceContext,
    showResumeBooking: session.showResumeBooking,
    showPhotoCta: session.showPhotoCta,
    photosRemaining: session.photosRemaining,
    imageContext: readStoredImageContext(state),
  });
}

export async function POST(request: Request) {
  if (!isConciergeEnabled()) {
    return NextResponse.json({ ok: false, error: "disabled" }, { status: 404 });
  }
  if (!originOk(request)) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }
  const payload = (await request.json().catch(() => null)) as
    | {
        message?: string;
        utm?: Record<string, string>;
        event?: string;
        context?: unknown;
        conversationId?: string;
      }
    | null;
  if (!payload) return NextResponse.json({ ok: false }, { status: 400 });
  const ip = clientIp(request);
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  if (!conciergeE2EMode() && countRecentByIp(hashIp(ip), since) >= 40) {
    return NextResponse.json({ ok: false, error: "rate" }, { status: 429 });
  }

  if (payload.event === "NEW_CONVERSATION") {
    const previousId = cookieId(request);
    if (previousId && getConversation(previousId)) {
      logInfo("CONVERSATION_ENDED", {
        contentJobId: previousId.slice(0, 8),
        stage: "new_conversation",
      });
    }
    const utm = payload.utm && typeof payload.utm === "object" ? payload.utm : {};
    const conversationId = startConcierge(ip, utm);
    const res = NextResponse.json({
      ok: true,
      conversationId,
      messages: [],
      chips: [],
      historicalChips: [],
      leadBanner: null,
      requestCard: null,
      awaitingSlotSelection: false,
      bookingPending: false,
      slotGroups: [],
      serviceContext: null,
      showResumeBooking: false,
      showPhotoCta: false,
      photosRemaining: 4,
      imageContext: null,
      ended: false,
    });
    res.cookies.set(COOKIE, conversationId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
      secure: process.env.NODE_ENV === "production",
    });
    return res;
  }

  let conversationId = cookieId(request);
  const clientConversationId = typeof payload.conversationId === "string" ? payload.conversationId.trim() : "";
  if (clientConversationId && getConversation(clientConversationId)) {
    conversationId = clientConversationId;
  } else if (!conversationId || !getConversation(conversationId)) {
    conversationId = startConcierge(ip, payload.utm && typeof payload.utm === "object" ? payload.utm : {});
  }
  if (!conciergeE2EMode() && countRecentMessages(conversationId, since) >= 24) {
    return NextResponse.json({ ok: false, error: "rate" }, { status: 429 });
  }

  if (payload.event === "CHAT_STARTED") {
    addEvent(conversationId, "CHAT_STARTED");
    const res = NextResponse.json({
      ok: true,
      conversationId,
      build: CONCIERGE_BUILD_MARKER,
      promptVersion: CONCIERGE_PROMPT_VERSION,
    });
    res.cookies.set(COOKIE, conversationId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
      secure: process.env.NODE_ENV === "production",
    });
    return res;
  }

  if (payload.event === "CONTEXT_STARTED") {
    const started = await startChatFromWebsiteImage({
      conversationId,
      context: payload.context,
    });
    if (!started.ok) {
      return NextResponse.json({ ok: false, error: started.error }, { status: 400 });
    }
    const conversation = getConversation(conversationId);
    const session = conversation?.state ? buildSessionSnapshot(conversation.state) : null;
    const res = NextResponse.json({
      ok: true,
      conversationId,
      reply: started.reply,
      imageContext: started.context,
      chips: session?.chips || [],
      historicalChips: session?.historicalChips || [],
      serviceContext: session?.serviceContext || started.stateService || null,
      showPhotoCta: session?.showPhotoCta || false,
      photosRemaining: session?.photosRemaining ?? 4,
      awaitingSlotSelection: session?.awaitingSlotSelection || false,
      bookingPending: session?.bookingPending || false,
      slotGroups: session?.slotGroups || [],
      showResumeBooking: session?.showResumeBooking || false,
      build: CONCIERGE_BUILD_MARKER,
      promptVersion: CONCIERGE_PROMPT_VERSION,
    });
    res.cookies.set(COOKIE, conversationId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
      secure: process.env.NODE_ENV === "production",
    });
    return res;
  }

  const message = String(payload.message || "").trim();
  if (!message) return NextResponse.json({ ok: false }, { status: 400 });

  try {
    const result = await conciergeTurn({ conversationId, message, utm: payload.utm });
    const res = NextResponse.json({ ...result, conversationId });
    res.cookies.set(COOKIE, conversationId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
      secure: process.env.NODE_ENV === "production",
    });
    return res;
  } catch (error) {
    logError("ConciergeChatFailed", {
      stage: error instanceof Error ? error.name : "error",
      contentJobId: conversationId.slice(0, 8),
    });
    return NextResponse.json({
      ok: true,
      reply: "Puedo seguir registrando tu solicitud. Cuéntame brevemente qué servicio necesitas.",
      chips: [],
      contactUrl: "/contact",
    });
  }
}
