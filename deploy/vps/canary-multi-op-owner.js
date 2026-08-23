const Database = require("better-sqlite3");

async function main() {
  const secret = process.env.N8N_HOMESTEAD_WEBHOOK_SECRET || "";
  const tgSecret = process.env.TELEGRAM_WEBHOOK_SECRET || "";
  if (!secret) {
    console.log("NO_SECRET");
    process.exit(1);
  }
  const db = new Database("/app/data/homestead.sqlite");
  console.log("INTEGRITY=" + db.pragma("integrity_check", { simple: true }));
  const owner = db
    .prepare(
      "SELECT telegram_user_id, telegram_chat_id, role, is_active FROM telegram_operators WHERE role='OWNER' AND is_active=1 LIMIT 1",
    )
    .get();
  if (!owner) {
    console.log("NO_OWNER");
    process.exit(1);
  }
  const pending = db.prepare("SELECT COUNT(*) AS c FROM telegram_operators WHERE role='PENDING'").get().c;
  const active = db
    .prepare("SELECT COUNT(*) AS c FROM telegram_operators WHERE is_active=1 AND role != 'PENDING'")
    .get().c;
  console.log("OWNER_ACTIVE=" + owner.is_active);
  console.log("ACTIVE_OPERATORS=" + active);
  console.log("PENDING_COUNT=" + pending);

  const updateId = Math.floor(Date.now() / 1000);
  const payload = {
    update_id: updateId,
    message: {
      message_id: 900001,
      chat: { id: Number(owner.telegram_chat_id || owner.telegram_user_id), type: "private" },
      from: { id: Number(owner.telegram_user_id), first_name: "OwnerCanary" },
      text: "/homestead",
    },
  };
  const ts = String(Math.floor(Date.now() / 1000));
  const headers = {
    "Content-Type": "application/json",
    "X-Homestead-Timestamp": ts,
    "X-Homestead-Webhook-Secret": secret,
  };
  if (tgSecret) headers["X-Telegram-Bot-Api-Secret-Token"] = tgSecret;

  const res = await fetch("http://127.0.0.1:3000/api/internal/content/telegram-update", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  console.log("HOMESTEAD_HTTP=" + res.status);
  console.log("HOMESTEAD_BODY=" + text.slice(0, 400));
  const ok = res.status === 200 && text.includes('"ok":true') && !text.includes('"denied":true');
  console.log("OWNER_HOMESTEAD=" + (ok ? "PASS" : "FAIL"));

  const bad = {
    update_id: updateId + 1,
    callback_query: {
      id: "canary-bad",
      from: { id: 999000111 },
      message: { chat: { id: 999000111, type: "private" }, message_id: 1 },
      data: "cc:h",
    },
  };
  const ts2 = String(Math.floor(Date.now() / 1000));
  const badRes = await fetch("http://127.0.0.1:3000/api/internal/content/telegram-update", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Homestead-Timestamp": ts2,
      "X-Homestead-Webhook-Secret": secret,
      ...(tgSecret ? { "X-Telegram-Bot-Api-Secret-Token": tgSecret } : {}),
    },
    body: JSON.stringify(bad),
  });
  const badText = await badRes.text();
  console.log("FAKE_USER_HTTP=" + badRes.status);
  console.log("FAKE_USER_BODY=" + badText.slice(0, 200));
  console.log("FAKE_USER_DENIED=" + (badText.includes('"denied":true') ? "PASS" : "FAIL"));

  if (pending === 0) console.log("SECOND_ACCOUNT=PENDING_SECOND_ACCOUNT_START");
  else console.log("SECOND_ACCOUNT=PENDING_EXISTS");
  console.log("CANARY_DONE");
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
