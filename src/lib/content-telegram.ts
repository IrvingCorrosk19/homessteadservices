import { logError } from "@/lib/log";

const TELEGRAM_API = "https://api.telegram.org";

export function telegramBotToken() {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() || "";
}

export function adminChatIds() {
  return (process.env.HOMESTEAD_TELEGRAM_ADMIN_CHAT_IDS || "")
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function isTelegramAdmin(chatId: string | number, userId?: string | number) {
  const allowed = new Set(adminChatIds());
  if (!allowed.size) return false;
  if (allowed.has(String(chatId))) return true;
  if (userId !== undefined && allowed.has(String(userId))) return true;
  return false;
}

type TelegramResponse = {
  ok: boolean;
  result?: { message_id?: number };
  description?: string;
};

async function telegramCall(method: string, payload: Record<string, unknown>) {
  const token = telegramBotToken();
  if (!token) throw new Error("telegram_unconfigured");
  const response = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = (await response.json()) as TelegramResponse;
  if (!json.ok) {
    logError("TelegramApiFailed", { method, cause: json.description || `http_${response.status}` });
  }
  return json;
}

export type TelegramButton = { text: string; callback_data?: string; url?: string };

export async function sendTelegramMessage(input: {
  chatId: string;
  text: string;
  keyboard?: Array<Array<TelegramButton>>;
  editMessageId?: number | null;
}) {
  const replyMarkup = input.keyboard
    ? { inline_keyboard: input.keyboard }
    : undefined;
  if (input.editMessageId) {
    const edited = await telegramCall("editMessageText", {
      chat_id: input.chatId,
      message_id: input.editMessageId,
      text: input.text,
      reply_markup: replyMarkup,
    });
    if (edited.ok) return input.editMessageId;
  }
  const sent = await telegramCall("sendMessage", {
    chat_id: input.chatId,
    text: input.text,
    reply_markup: replyMarkup,
  });
  return sent.result?.message_id ?? null;
}

export async function answerCallback(id: string, text?: string) {
  await telegramCall("answerCallbackQuery", {
    callback_query_id: id,
    text: text || "",
  });
}

export async function sendTelegramPhotos(input: {
  chatId: string;
  photos: Array<{ bytes: Buffer; filename: string }>;
}) {
  const token = telegramBotToken();
  if (!token || !input.photos.length) return;
  if (input.photos.length === 1) {
    const form = new FormData();
    form.set("chat_id", input.chatId);
    form.set(
      "photo",
      new Blob([new Uint8Array(input.photos[0].bytes)], { type: "image/jpeg" }),
      input.photos[0].filename,
    );
    await fetch(`${TELEGRAM_API}/bot${token}/sendPhoto`, { method: "POST", body: form });
    return;
  }
  const form = new FormData();
  form.set("chat_id", input.chatId);
  const media = input.photos.map((photo, index) => ({
    type: "photo",
    media: `attach://photo${index + 1}`,
  }));
  form.set("media", JSON.stringify(media));
  input.photos.forEach((photo, index) => {
    form.set(
      `photo${index + 1}`,
      new Blob([new Uint8Array(photo.bytes)], { type: "image/jpeg" }),
      photo.filename,
    );
  });
  await fetch(`${TELEGRAM_API}/bot${token}/sendMediaGroup`, { method: "POST", body: form });
}

export async function downloadTelegramFile(fileId: string) {
  const token = telegramBotToken();
  if (!token) return null;
  const infoRes = await fetch(`${TELEGRAM_API}/bot${token}/getFile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId }),
  });
  const info = (await infoRes.json()) as {
    ok: boolean;
    result?: { file_path?: string };
  };
  const filePath = info.result?.file_path;
  if (!info.ok || !filePath) return null;
  const fileRes = await fetch(`${TELEGRAM_API}/file/bot${token}/${filePath}`);
  if (!fileRes.ok) return null;
  return Buffer.from(await fileRes.arrayBuffer());
}

export type TelegramUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number };
    from?: { id: number };
    text?: string;
    caption?: string;
    photo?: Array<{ file_id: string; file_size?: number; width?: number; height?: number }>;
    document?: { file_id: string; mime_type?: string; file_name?: string };
    media_group_id?: string;
  };
  callback_query?: {
    id: string;
    from: { id: number };
    message?: { chat: { id: number }; message_id: number };
    data?: string;
  };
};
