import { addEvent, addMessage, getConversation, touchConversation, type ConversationState } from "@/lib/concierge-store";
import { recordFunnelEvent } from "@/lib/concierge-intelligence";
import {
  activateDigitalLockFlow,
  emptyDigitalLockChecklist,
  getDigitalLockChecklist,
  setDigitalLockChecklist,
} from "@/lib/concierge/digital-lock-vision";
import { clearActiveTransactionState } from "@/lib/concierge-transaction";
import { getPlaybook } from "@/lib/concierge/service-playbooks";
import {
  contextualGreetingForImage,
  isWebsiteImageChatContext,
  type WebsiteImageChatContext,
} from "@/lib/concierge-entry-context";
import type { ServiceSlug } from "@/lib/site";

function isServiceSlug(value: string): value is ServiceSlug {
  return ["ac", "plumbing", "painting", "electrical", "locksmith", "repairs", "remodeling"].includes(value);
}

export function applyWebsiteImageContext(
  state: ConversationState,
  ctx: WebsiteImageChatContext,
  opts: { switching?: boolean } = {},
): ConversationState {
  const serviceId = isServiceSlug(ctx.serviceId) ? ctx.serviceId : state.primaryService || state.service || "other";
  const playbook = getPlaybook(serviceId);
  let next: ConversationState = {
    ...clearActiveTransactionState(state, true),
    activeLeadId: "",
    appointmentId: state.appointmentId || "",
    funnelStage: "DISCOVERY",
    primaryService: serviceId === "other" ? state.primaryService : serviceId,
    service: serviceId === "other" ? state.service || "other" : serviceId,
    bookingStrategy: playbook.bookingStrategy,
    bookingIntent: false,
    problem: ctx.contextLabel || ctx.serviceName,
    facts: {
      ...(state.facts || {}),
      need: ctx.contextLabel || ctx.serviceName,
      entryPoint: "service_image",
      entrySource: "website",
      entryItemId: ctx.itemId,
      entryImageId: ctx.imageId,
      entryServiceId: ctx.serviceId,
      websiteImageContext: JSON.stringify(ctx),
    },
  };

  if (opts.switching) {
    next = {
      ...next,
      facts: {
        ...(next.facts || {}),
        priorEntryItemId: state.facts?.entryItemId || "",
      },
    };
  }

  const wantsDigitalLock =
    ctx.intentHint === "digital_lock" ||
    /cerradura digital|digital lock/i.test(`${ctx.contextLabel} ${ctx.itemTitle} ${ctx.serviceName}`);

  if (wantsDigitalLock) {
    next = activateDigitalLockFlow(next);
  } else {
    const prior = getDigitalLockChecklist(next);
    if (prior.active || prior.front || prior.inside || prior.edge) {
      next = setDigitalLockChecklist(next, emptyDigitalLockChecklist());
    }
  }

  return next;
}

export async function startChatFromWebsiteImage(input: {
  conversationId: string;
  context: unknown;
}) {
  const conversation = getConversation(input.conversationId);
  if (!conversation) return { ok: false as const, error: "session" };
  if (!isWebsiteImageChatContext(input.context)) {
    return { ok: false as const, error: "invalid_context" };
  }

  const ctx = input.context;
  const previousService = conversation.state.primaryService || conversation.state.service || "";
  const switching = Boolean(previousService && previousService !== ctx.serviceId);

  const state = applyWebsiteImageContext(conversation.state, ctx, { switching });
  const reply = contextualGreetingForImage(ctx, state.name || "");
  addMessage(input.conversationId, "assistant", reply);
  addEvent(input.conversationId, "CHAT_CONTEXT_STARTED");
  touchConversation(input.conversationId, { state });

  recordFunnelEvent(input.conversationId, "ServiceImageChatOpened", {
    service: ctx.serviceId,
    intent: ctx.itemId,
  });
  recordFunnelEvent(input.conversationId, "ChatContextStarted", {
    service: ctx.serviceId,
    intent: ctx.imageId,
  });
  if (switching) {
    recordFunnelEvent(input.conversationId, "ServiceContextChanged", {
      service: ctx.serviceId,
      intent: previousService,
    });
  }

  return {
    ok: true as const,
    reply,
    context: ctx,
    stateService: state.primaryService || state.service,
  };
}
