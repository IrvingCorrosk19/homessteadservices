/**
 * Homestead Telegram access gate helpers for the single bot router.
 */
import {
  activateOperator,
  approveOperator,
  deactivateOperator,
  getOperatorById,
  hasTelegramPermission,
  incrementTelegramMetric,
  listOperators,
  listOwnersForNotify,
  maskTelegramId,
  registerPendingOperator,
  rejectOperator,
  resolveTelegramOperator,
  touchOperatorSeen,
  type TelegramOperator,
  type TelegramPermission,
} from "@/lib/telegram-operators";
import { sendTelegramMessage, type TelegramButton } from "@/lib/content-telegram";

export function displayNameFromTelegram(from?: {
  first_name?: string;
  last_name?: string;
  username?: string;
}) {
  const parts = [from?.first_name, from?.last_name].filter(Boolean).join(" ").trim();
  if (parts) return parts.slice(0, 80);
  if (from?.username) return `@${from.username}`.slice(0, 80);
  return "";
}

export function gateOperator(
  userId: string,
  chatId: string,
  permission?: TelegramPermission,
): {
  ok: boolean;
  operator: TelegramOperator | null;
  reason: "ok" | "unauthorized" | "pending" | "inactive" | "forbidden" | "group";
} {
  const operator = resolveTelegramOperator(userId, chatId);
  if (!operator) return { ok: false, operator: null, reason: "unauthorized" };
  if (operator.role === "PENDING") {
    return { ok: false, operator, reason: "pending" };
  }
  if (!operator.isActive) return { ok: false, operator, reason: "inactive" };
  if (permission && !hasTelegramPermission(operator, permission)) {
    incrementTelegramMetric("telegram_permission_denied");
    return { ok: false, operator, reason: "forbidden" };
  }
  touchOperatorSeen(operator.id, chatId);
  return { ok: true, operator, reason: "ok" };
}

export function accessDeniedText(reason: string) {
  if (reason === "pending") {
    return "Tu solicitud de acceso está pendiente de autorización.";
  }
  if (reason === "inactive") {
    return "Tu acceso al Command Center de Homestead está desactivado.";
  }
  if (reason === "group") {
    return "Homestead solo se administra en chat privado con el bot.";
  }
  if (reason === "forbidden") {
    return "No tienes permiso para esta acción.";
  }
  return "Esta cuenta todavía no está autorizada para administrar Homestead.";
}

export async function handleStartCommand(input: {
  userId: string;
  chatId: string;
  displayName?: string;
}) {
  const existing = resolveTelegramOperator(input.userId, input.chatId);
  if (existing?.isActive && existing.role !== "PENDING") {
    touchOperatorSeen(existing.id, input.chatId);
    await sendTelegramMessage({
      chatId: input.chatId,
      text: [
        "Bienvenido nuevamente a Homestead.",
        "",
        `Rol: ${existing.role}`,
        "",
        "Usa /homestead para abrir el Command Center.",
      ].join("\n"),
      keyboard: [[{ text: "🏠 PANEL HOMESTEAD", callback_data: "cc:h" }]],
    });
    return { status: "active" as const, operator: existing };
  }
  if (existing?.role === "PENDING") {
    await sendTelegramMessage({
      chatId: input.chatId,
      text: "Tu solicitud de acceso está pendiente de autorización.",
    });
    return { status: "pending" as const, operator: existing };
  }
  if (existing && !existing.isActive) {
    await sendTelegramMessage({
      chatId: input.chatId,
      text: accessDeniedText("inactive"),
    });
    return { status: "inactive" as const, operator: existing };
  }

  const { operator, created } = registerPendingOperator({
    telegramUserId: input.userId,
    telegramChatId: input.chatId,
    displayName: input.displayName,
  });
  await sendTelegramMessage({
    chatId: input.chatId,
    text: [
      "Esta cuenta todavía no está autorizada para administrar Homestead.",
      "",
      "Registramos tu solicitud. Un OWNER debe autorizarla.",
    ].join("\n"),
  });

  if (created) {
    const owners = listOwnersForNotify();
    const text = [
      "👤 NUEVO OPERADOR",
      "",
      "Una cuenta de Telegram solicita acceso",
      "al Command Center de Homestead.",
      "",
      `Nombre: ${operator.displayName}`,
      `Telegram ID: ${maskTelegramId(operator.telegramUserId)}`,
    ].join("\n");
    const keyboard: TelegramButton[][] = [
      [
        { text: "✅ Autorizar", callback_data: `cc:op:ask:${operator.id}` },
        { text: "❌ Rechazar", callback_data: `cc:op:rej:${operator.id}` },
      ],
      [{ text: "👥 Operadores", callback_data: "cc:op:list" }],
    ];
    for (const owner of owners) {
      if (!owner.telegramChatId) continue;
      await sendTelegramMessage({ chatId: owner.telegramChatId, text, keyboard });
    }
  }
  return { status: "pending_created" as const, operator };
}

export function operatorsListView(actor: TelegramOperator) {
  if (!hasTelegramPermission(actor, "operators.read")) {
    return {
      text: accessDeniedText("forbidden"),
      keyboard: [[{ text: "⬅ Inicio", callback_data: "cc:h" }]],
    };
  }
  const ops = listOperators({ includeInactive: true });
  const lines = ["👥 OPERADORES", ""];
  for (const op of ops) {
    const status =
      op.role === "PENDING" ? "⏳ PENDING" : op.isActive ? "🟢 Activo" : "🔴 Inactivo";
    lines.push(op.displayName);
    lines.push(`${op.role} · ${status}`);
    lines.push(`ID …${op.telegramUserId.slice(-4)}`);
    lines.push("");
  }
  const keyboard: TelegramButton[][] = [];
  const pending = ops.filter((op) => op.role === "PENDING");
  for (const op of pending.slice(0, 5)) {
    keyboard.push([
      { text: `➕ Autorizar ${op.displayName.slice(0, 12)}`, callback_data: `cc:op:ask:${op.id}` },
    ]);
  }
  const inactive = ops.filter((op) => !op.isActive && op.role !== "PENDING").slice(0, 3);
  for (const op of inactive) {
    keyboard.push([{ text: `🔁 Reactivar ${op.displayName.slice(0, 10)}`, callback_data: `cc:op:on:${op.id}` }]);
  }
  const activeNonPending = ops.filter((op) => op.isActive && op.role !== "PENDING").slice(0, 5);
  for (const op of activeNonPending) {
    if (op.id === actor.id) continue;
    keyboard.push([{ text: `⛔ Desactivar ${op.displayName.slice(0, 10)}`, callback_data: `cc:op:off:${op.id}` }]);
  }
  keyboard.push([{ text: "⬅ Inicio", callback_data: "cc:h" }]);
  return { text: lines.join("\n").trim(), keyboard };
}

export function operatorRolePicker(operatorId: number) {
  return {
    text: "Selecciona el rol para este operador:",
    keyboard: [
      [{ text: "👑 OWNER", callback_data: `cc:op:own:${operatorId}` }],
      [{ text: "🛡 ADMIN", callback_data: `cc:op:adm:${operatorId}` }],
      [{ text: "⬅ Operadores", callback_data: "cc:op:list" }],
    ],
  };
}

export async function applyOperatorCallback(
  data: string,
  actor: TelegramOperator,
): Promise<{ text: string; keyboard?: TelegramButton[][] }> {
  const parts = data.split(":");
  const action = parts[2] || "list";
  const targetId = Number(parts[3] || 0);

  if (action === "list") return operatorsListView(actor);
  if (action === "ask") {
    if (!hasTelegramPermission(actor, "operators.manage")) {
      return { text: accessDeniedText("forbidden"), keyboard: [[{ text: "⬅ Inicio", callback_data: "cc:h" }]] };
    }
    return operatorRolePicker(targetId);
  }
  if (action === "adm" || action === "own") {
    const role: "OWNER" | "ADMIN" = action === "own" ? "OWNER" : "ADMIN";
    const result = approveOperator({ operatorId: targetId, role, actor });
    if (!result.ok) {
      const msg =
        result.reason === "owner_only"
          ? "Solo un OWNER puede crear otro OWNER."
          : result.reason === "forbidden"
            ? accessDeniedText("forbidden")
            : "No pudimos autorizar este operador.";
      return { text: msg, keyboard: [[{ text: "⬅ Operadores", callback_data: "cc:op:list" }]] };
    }
    if (result.operator.telegramChatId) {
      await sendTelegramMessage({
        chatId: result.operator.telegramChatId,
        text: [
          "✅ Acceso autorizado",
          "",
          `Rol: ${role}`,
          "",
          "Ya puedes usar /homestead.",
        ].join("\n"),
        keyboard: [[{ text: "🏠 PANEL HOMESTEAD", callback_data: "cc:h" }]],
      });
    }
    return {
      text: `Operador autorizado como ${role}.\n\n${result.operator.displayName}`,
      keyboard: [[{ text: "👥 Operadores", callback_data: "cc:op:list" }]],
    };
  }
  if (action === "rej") {
    const result = rejectOperator({ operatorId: targetId, actor });
    if (!result.ok) {
      return {
        text: accessDeniedText("forbidden"),
        keyboard: [[{ text: "⬅ Operadores", callback_data: "cc:op:list" }]],
      };
    }
    const target = getOperatorById(targetId);
    if (target?.telegramChatId) {
      await sendTelegramMessage({
        chatId: target.telegramChatId,
        text: "Tu solicitud de acceso a Homestead fue rechazada.",
      });
    }
    return {
      text: "Solicitud rechazada.",
      keyboard: [[{ text: "👥 Operadores", callback_data: "cc:op:list" }]],
    };
  }
  if (action === "off") {
    const result = deactivateOperator({ operatorId: targetId, actor });
    if (!result.ok) {
      const msg =
        result.reason === "last_owner"
          ? "No se puede desactivar al último OWNER activo."
          : accessDeniedText("forbidden");
      return { text: msg, keyboard: [[{ text: "⬅ Operadores", callback_data: "cc:op:list" }]] };
    }
    return {
      text: "Operador desactivado. El acceso se revoca de inmediato.",
      keyboard: [[{ text: "👥 Operadores", callback_data: "cc:op:list" }]],
    };
  }
  if (action === "on") {
    const result = activateOperator({ operatorId: targetId, actor });
    if (!result.ok) {
      return {
        text: result.reason === "still_pending" ? "Primero debes autorizar el rol." : accessDeniedText("forbidden"),
        keyboard: [[{ text: "⬅ Operadores", callback_data: "cc:op:list" }]],
      };
    }
    return {
      text: "Operador reactivado.",
      keyboard: [[{ text: "👥 Operadores", callback_data: "cc:op:list" }]],
    };
  }
  return operatorsListView(actor);
}

export function settingsView(actor: TelegramOperator) {
  const rows: TelegramButton[][] = [];
  if (hasTelegramPermission(actor, "operators.read")) {
    rows.push([{ text: "👥 Operadores", callback_data: "cc:op:list" }]);
  }
  rows.push([{ text: "⬅ Inicio", callback_data: "cc:h" }]);
  return {
    text: ["⚙️ CONFIGURACIÓN", "", `Operador: ${actor.displayName}`, `Rol: ${actor.role}`].join("\n"),
    keyboard: rows,
  };
}
