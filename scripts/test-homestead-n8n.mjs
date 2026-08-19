import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function sign(secret, timestamp, payload) {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${canonicalJson(payload)}`)
    .digest("hex");
}

const webhookUrl =
  process.env.N8N_HOMESTEAD_WEBHOOK_URL ||
  "https://n8n.autonomousflow.lat/webhook/homestead-service-request";
const secret = process.env.N8N_HOMESTEAD_WEBHOOK_SECRET || "";
const homesteadUrl = process.env.HOMESTEAD_URL || "https://homestead.lat";

function samplePayload(requestId) {
  return {
    event: "service_request.created",
    requestId,
    createdAt: new Date().toISOString(),
    customer: {
      name: "Prueba n8n",
      phone: "60000000",
      email: "prueba.homestead@example.com",
    },
    service: {
      slug: "plumbing",
      type: "Plomería",
      property: "Casa",
      description: "Prueba de webhook Homestead.",
    },
    photos: { count: 0, items: [] },
    actions: {
      contactWhatsApp: "https://wa.me/50760000000",
      replyUrl: "https://homestead.lat/admin/solicitudes/HS-2099-000001",
    },
  };
}

async function postWebhook(payload, headers) {
  return fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(payload),
  });
}

async function testUnauthorized() {
  const payload = samplePayload("HS-2099-000001");
  const response = await postWebhook(payload, {
    "X-Homestead-Timestamp": String(Math.floor(Date.now() / 1000)),
    "X-Homestead-Signature": "sha256=deadbeef",
  });
  return {
    name: "WEBHOOK_UNAUTHORIZED",
    pass: response.status === 401 || response.status === 403,
    status: response.status,
  };
}

async function testMalformed() {
  if (!secret) return { name: "WEBHOOK_MALFORMED", pass: false, status: "missing_secret" };
  const payload = { event: "nope" };
  const timestamp = String(Math.floor(Date.now() / 1000));
  const response = await postWebhook(payload, {
    "X-Homestead-Timestamp": timestamp,
    "X-Homestead-Signature": `sha256=${sign(secret, timestamp, payload)}`,
    "X-Homestead-Webhook-Secret": secret,
  });
  return {
    name: "WEBHOOK_MALFORMED",
    pass: response.status === 400 || response.status === 401,
    status: response.status,
  };
}

async function testDuplicate() {
  if (!secret) return { name: "WEBHOOK_IDEMPOTENCY", pass: false, status: "missing_secret" };
  const payload = samplePayload(`HS-2099-${String(Date.now()).slice(-6)}`);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = sign(secret, timestamp, payload);
  const headers = {
    "X-Homestead-Timestamp": timestamp,
    "X-Homestead-Signature": `sha256=${signature}`,
    "X-Homestead-Webhook-Secret": secret,
  };
  const first = await postWebhook(payload, headers);
  const second = await postWebhook(payload, {
    ...headers,
    "X-Homestead-Timestamp": String(Math.floor(Date.now() / 1000)),
    "X-Homestead-Signature": `sha256=${sign(secret, String(Math.floor(Date.now() / 1000)), payload)}`,
  });
  const firstBody = await first.text();
  const secondBody = await second.text();
  return {
    name: "WEBHOOK_IDEMPOTENCY",
    pass: first.ok && second.ok && secondBody.includes("duplicate"),
    status: `${first.status}/${second.status}`,
    detail: `${firstBody} | ${secondBody}`,
  };
}

async function testHomesteadForm() {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const form = new FormData();
  form.set("name", "Prueba n8n Homestead");
  form.set("phone", "6000-0000");
  form.set("email", "prueba.homestead@example.com");
  form.set("property", "house");
  form.set("service", "plumbing");
  form.set("message", "Prueba end-to-end de persistencia, email y n8n.");
  form.set("website", "");
  form.append("photos", new Blob([png], { type: "image/png" }), "fuga.png");
  const response = await fetch(`${homesteadUrl}/api/contact`, {
    method: "POST",
    body: form,
  });
  const body = await response.json().catch(() => ({}));
  return {
    name: "HOMESTEAD_FORM",
    pass: response.ok && Boolean(body.requestId),
    status: response.status,
    requestId: body.requestId || null,
  };
}

const selfCheckExpected = sign("unit-secret", "1", { a: 1, b: [2] });
const selfCheckActual = createHmac("sha256", "unit-secret")
  .update(`1.${canonicalJson({ a: 1, b: [2] })}`)
  .digest("hex");
const selfCheck = {
  name: "HMAC_CANONICAL",
  pass:
    selfCheckExpected === selfCheckActual &&
    timingSafeEqual(Buffer.from(selfCheckExpected, "hex"), Buffer.from(selfCheckActual, "hex")) &&
    randomBytes(8).length === 8,
};

const results = [selfCheck];
results.push(await testHomesteadForm());
if (secret) {
  results.push(await testUnauthorized());
  results.push(await testMalformed());
  results.push(await testDuplicate());
} else {
  results.push({ name: "WEBHOOK_TESTS", pass: false, status: "missing_secret" });
}

for (const result of results) {
  console.log(`${result.pass ? "PASS" : "FAIL"} ${result.name}`, result);
}

if (results.some((result) => !result.pass)) process.exitCode = 1;
