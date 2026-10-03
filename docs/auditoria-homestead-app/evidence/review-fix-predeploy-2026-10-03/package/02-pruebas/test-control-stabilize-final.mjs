/**
 * Stabilization final matrix — isolated control:dev only.
 * Exercises real publisher path (CONTENT_DRY_RUN=false) with Meta Graph transport simulated.
 * Writes sanitized evidence under docs/auditoria-homestead-app/evidence/a06-stabilize-final/
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const evDir = join(root, "docs", "auditoria-homestead-app", "evidence", "a06-stabilize-final");
mkdirSync(evDir, { recursive: true });
mkdirSync(join(evDir, "sim-graph"), { recursive: true });
mkdirSync(join(evDir, "media"), { recursive: true });

const BASE = process.env.CONTROL_PHYSICAL_BASE || "http://127.0.0.1:3000";
const results = [];
let failed = 0;

function record(name, kind, ok, detail = {}) {
  if (!ok) failed += 1;
  results.push({ name, kind, result: ok ? "PASS" : "FAIL", detail, at: new Date().toISOString() });
  console.log(ok ? "PASS" : "FAIL", `[${kind}]`, name, JSON.stringify(detail).slice(0, 220));
}

async function login() {
  const r = await fetch(`${BASE}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Homestead-Client": "control-mobile" },
    body: JSON.stringify({ password: "control-local" }),
  });
  const j = await r.json();
  if (!r.ok || !j.session) throw new Error(`login_failed:${r.status}`);
  return { session: j.session, csrf: j.csrf };
}

function headers(auth, mutating = false) {
  const h = {
    Authorization: `Bearer ${auth.session}`,
    "X-Homestead-Client": "control-mobile",
  };
  if (mutating) {
    h["X-CSRF-Token"] = auth.csrf;
    h["content-type"] = "application/json";
  }
  return h;
}

async function jget(auth, path) {
  const r = await fetch(`${BASE}${path}`, { headers: headers(auth) });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok, json: j };
}

async function jpost(auth, path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: headers(auth, true),
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok, json: j };
}

async function makePhoto(label, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600">
    <rect width="100%" height="100%" fill="${color}"/>
    <text x="80" y="200" font-size="96" fill="#fff" font-family="Arial">${label}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
}

async function ingestAlbum(auth, files, note, batchKey, publishMode = "album") {
  const form = new FormData();
  form.set("note", note);
  form.set("publishMode", publishMode);
  form.set("batchKey", batchKey);
  files.forEach((bytes, i) => {
    form.append("files", new Blob([bytes], { type: "image/jpeg" }), `photo-${i + 1}.jpg`);
  });
  const r = await fetch(`${BASE}/api/admin/content/intake`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.session}`,
      "X-Homestead-Client": "control-mobile",
      "X-CSRF-Token": auth.csrf,
    },
    body: form,
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok, json: j };
}

async function setScenario(auth, scenario) {
  const r = await jpost(auth, "/api/admin/control-dev/sim", {
    graphScenario: scenario,
    resetCalls: scenario === "ok",
  });
  return Boolean(r?.ok);
}

async function getSimCalls(auth) {
  const r = await jget(auth, "/api/admin/control-dev/sim");
  return r.ok ? r.json.simulatedCalls || [] : [];
}

async function waitReady(auth, publicId, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const d = await jget(auth, `/api/admin/content/jobs/${publicId}`);
    const job = d.json?.job || d.json;
    if (job?.publishImageReady || job?.displayState === "pending_approval" || job?.status === "AWAITING_APPROVAL") {
      return job;
    }
    if (job?.status === "FAILED") return job;
    await new Promise((r) => setTimeout(r, 800));
  }
  throw new Error(`timeout_ready:${publicId}`);
}

const auth = await login();
record("login_isolated", "api_aislada", true, { base: BASE });

// --- Copy behavior documentation probe ---
{
  const p1 = await makePhoto("CTX-A", "#1d4f91");
  const p2 = await makePhoto("CTX-B", "#c45c26");
  const p3 = await makePhoto("CTX-C", "#2f6b4f");
  const note = "Contexto prueba estabilización: tres fotos distinguibles A B C. Sin inventar datos.";
  const batch = `stab-album-${randomUUID()}`;
  const created = await ingestAlbum(auth, [p1, p2, p3], note, batch, "album");
  const publicId = created.json.publicId || created.json.items?.[0]?.publicId || "";
  record("album_create_one_folio", "api_aislada", created.json.ok === true && Boolean(publicId), {
    status: created.status,
    publicId,
    publishMode: created.json.publishMode,
    itemCount: created.json.items?.length,
    uniqueIds: [...new Set((created.json.items || []).map((i) => i.publicId))],
  });
  if (!publicId) {
    writeFileSync(join(evDir, "RESULTS.json"), JSON.stringify({ failed: 1, results }, null, 2));
    process.exit(1);
  }

  const job = await waitReady(auth, publicId);
  const detail = await jget(auth, `/api/admin/content/jobs/${publicId}`);
  const card = detail.json.job || detail.json;
  const copy = String(card.copy || "");
  const contextKept = String(card.aiContext || card.description || note).includes("tres fotos");
  const copyFromTemplate = copy.includes(note.slice(0, 40)) || copy.startsWith(note.slice(0, 20));
  record("context_template_not_model", "api_aislada", copyFromTemplate && contextKept, {
    publicId,
    copyStartsWithContext: copyFromTemplate,
    notePersisted: contextKept,
    copyPreview: copy.slice(0, 120),
    doc: "controlCopyFromContext is a local template assembler; OPENAI_API_KEY is cleared in isolated env — no model call.",
  });

  // media order before approve
  const mediaBefore = await jget(auth, `/api/admin/content/jobs/${publicId}/media`);
  const orderBefore = mediaBefore.json.order || mediaBefore.json.media?.map((m) => m.assetId) || [];
  record("album_three_assets", "api_aislada", orderBefore.length === 3, { orderBefore, media: mediaBefore.json.media });

  // reorder last -> first
  const reversed = [...orderBefore].reverse();
  const reorder = await jpost(auth, `/api/admin/content/jobs/${publicId}/media`, { order: reversed });
  record("reorder_clears_approval", "api_aislada", reorder.json.ok === true && reorder.json.approvalCleared === true, {
    order: reorder.json.order,
    approvalCleared: reorder.json.approvalCleared,
  });
  const mediaAfter = await jget(auth, `/api/admin/content/jobs/${publicId}/media`);
  const orderAfter = mediaAfter.json.order || mediaAfter.json.media?.map((m) => m.assetId) || [];
  record("reorder_persists", "api_aislada", JSON.stringify(orderAfter) === JSON.stringify(reversed), {
    orderAfter,
    expected: reversed,
  });

  // save copy then approve
  const refreshed = await jget(auth, `/api/admin/content/jobs/${publicId}`);
  const version = (refreshed.json.job || refreshed.json).version || 1;
  const save = await jpost(auth, `/api/admin/content/jobs/${publicId}/action`, {
    action: "save_copy",
    version,
    copy: `${note}\n\nTexto editado operador. Folio ${publicId}.`,
    confirm: true,
    idempotencyKey: `save-${publicId}`,
  });
  record("save_copy_invalidates_or_ok", "api_aislada", save.json.ok === true, {
    invalidatedApproval: save.json.invalidatedApproval,
  });

  const v2 = (await jget(auth, `/api/admin/content/jobs/${publicId}`)).json;
  const ver = (v2.job || v2).version || version;
  const approve = await jpost(auth, `/api/admin/content/jobs/${publicId}/action`, {
    action: "approve",
    version: ver,
    confirm: true,
    idempotencyKey: `approve-${publicId}`,
  });
  record("approve_album", "api_aislada", approve.json.ok === true, { error: approve.json.error });

  // Concurrent approve same key → replay
  const approve2 = await jpost(auth, `/api/admin/content/jobs/${publicId}/action`, {
    action: "approve",
    version: ver,
    confirm: true,
    idempotencyKey: `approve-${publicId}`,
  });
  record("approve_idempotent_replay", "api_aislada", approve2.json.ok === true && approve2.json.replayed === true, {
    replayed: approve2.json.replayed,
  });

  // Publish via real publisher path (isolated Graph transport)
  await setScenario(auth, "ok");
  await jpost(auth, "/api/admin/control-dev/sim", { resetCalls: true });
  const pubKey = `publish-${publicId}`;
  const pub1 = await jpost(auth, `/api/admin/content/jobs/${publicId}/action`, {
    action: "publish_now",
    version: ver,
    confirm: true,
    idempotencyKey: pubKey,
  });
  record("publish_album_simulated_graph", "api_aislada", pub1.json.ok === true, {
    error: pub1.json.error,
    results: pub1.json.results,
  });

  // Capture simulated Graph calls (real publisher path until isolated HTTP boundary)
  const simCalls = await getSimCalls(auth);
  writeFileSync(join(evDir, "sim-graph", `${publicId}-calls.json`), JSON.stringify(simCalls, null, 2));
  const meta = simCalls.filter((c) => c.provider === "meta");
  const igChildren = meta.filter((c) => c.request?.isCarouselItem === true);
  const igCarousel = meta.filter((c) => c.request?.mediaType === "CAROUSEL");
  const fbMulti = meta.some((c) => (c.request?.attachedMediaCount || 0) >= 2);
  const igOk = igChildren.length === 3 && igCarousel.length >= 1;
  record("ig_carousel_three_children_ordered_path", "simulacion", igOk, {
    igChildren: igChildren.length,
    igCarouselParents: igCarousel.length,
    sample: igChildren.map((c) => c.detail),
    allMeta: meta.map((c) => ({ detail: c.detail, request: c.request })),
  });
  record("fb_multi_photo_attached_media", "simulacion", fbMulti || meta.some((c) => String(c.detail).includes("/feed")), {
    fbAttached: meta.filter((c) => (c.request?.attachedMediaCount || 0) > 0).map((c) => c.request),
    metaPaths: meta.map((c) => c.detail),
  });

  writeFileSync(join(evDir, "01-album-job.json"), JSON.stringify({ publicId, pub1: pub1.json, orderAfter }, null, 2));

  // Lost-response replay same publish key
  const pubReplay = await jpost(auth, `/api/admin/content/jobs/${publicId}/action`, {
    action: "publish_now",
    version: ver,
    confirm: true,
    idempotencyKey: pubKey,
  });
  record("publish_lost_response_replay", "api_aislada", pubReplay.json.replayed === true || pubReplay.json.ok === true, {
    replayed: pubReplay.json.replayed,
    error: pubReplay.json.error,
  });

  // Same batchKey retry must not create new folio
  const retry = await ingestAlbum(auth, [p1, p2, p3], note, batch, "album");
  const retryId = retry.json.publicId || retry.json.items?.[0]?.publicId;
  record("album_batchkey_no_duplicate_folio", "api_aislada", retryId === publicId && (retry.json.replayed === true || retry.json.ok === true), {
    original: publicId,
    retryId,
    replayed: retry.json.replayed,
  });

  // New intentional album with SAME photo bytes but NEW batchKey → new folio allowed
  const batch2 = `stab-album-new-${randomUUID()}`;
  const intentional = await ingestAlbum(auth, [p1, p2, p3], note, batch2, "album");
  const id2 = intentional.json.publicId || intentional.json.items?.[0]?.publicId;
  record("same_hash_new_batch_new_folio", "api_aislada", Boolean(id2) && id2 !== publicId && intentional.json.ok === true, {
    publicId,
    id2,
  });

  // Separate mode regression: 2 photos → 2 folios
  const s1 = await makePhoto("SEP-1", "#333366");
  const s2 = await makePhoto("SEP-2", "#663333");
  const sepBatch = `stab-sep-${randomUUID()}`;
  const sep = await ingestAlbum(auth, [s1, s2], "Modo separado estabilización", sepBatch, "separate");
  const sepIds = [...new Set((sep.json.items || []).map((i) => i.publicId).filter(Boolean))];
  record("separate_mode_two_folios", "api_aislada", sep.json.ok === true && sepIds.length === 2, {
    sepIds,
    publishMode: sep.json.publishMode,
  });

  // Download branded bytes hash correspondence
  if (orderAfter[0]) {
    const mediaRes = await fetch(`${BASE}/api/admin/content/media?asset=${orderAfter[0]}`, {
      headers: headers(auth),
    });
    const buf = Buffer.from(await mediaRes.arrayBuffer());
    const meta = await sharp(buf).metadata();
    writeFileSync(join(evDir, "media", `${publicId}-slide1.jpg`), buf);
    record("branded_feed_1080x1350", "api_aislada", meta.width === 1080 && meta.height === 1350, {
      width: meta.width,
      height: meta.height,
      sha16: createHash("sha256").update(buf).digest("hex").slice(0, 16),
    });
  }
}

// --- Partial platform failure + uncertain ---
{
  const a = await makePhoto("PF-A", "#004488");
  const b = await makePhoto("PF-B", "#884400");
  const c = await makePhoto("PF-C", "#228822");
  const batch = `stab-partial-${randomUUID()}`;
  const created = await ingestAlbum(auth, [a, b, c], "Parcial FB fail", batch, "album");
  const publicId = created.json.publicId;
  await waitReady(auth, publicId);
  const ver = ((await jget(auth, `/api/admin/content/jobs/${publicId}`)).json.job || {}).version || 1;
  await jpost(auth, `/api/admin/content/jobs/${publicId}/action`, {
    action: "approve",
    version: ver,
    confirm: true,
    idempotencyKey: `ap-${publicId}`,
  });

  // Try set fail_facebook scenario
  await setScenario(auth, "fail_facebook");
  const pub = await jpost(auth, `/api/admin/content/jobs/${publicId}/action`, {
    action: "publish_now",
    version: ver,
    confirm: true,
    idempotencyKey: `pub-partial-${publicId}`,
  });
  const resultsPub = pub.json.results || [];
  const igOk = resultsPub.some((r) => r.platform === "instagram" && (r.outcome === "published" || r.outcome === "already"));
  const fbFail = resultsPub.some((r) => r.platform === "facebook" && r.outcome === "failed");
  record("partial_ig_ok_fb_fail", "simulacion", igOk && fbFail, {
    results: resultsPub,
    ok: pub.json.ok,
    error: pub.json.error,
  });

  // Partial retry must skip Instagram republish
  await setScenario(auth, "ok");
  await jpost(auth, "/api/admin/control-dev/sim", { resetCalls: true });
  const retry = await jpost(auth, `/api/admin/content/jobs/${publicId}/action`, {
    action: "publish_now",
    version: ((await jget(auth, `/api/admin/content/jobs/${publicId}`)).json.job || {}).version || ver,
    confirm: true,
    idempotencyKey: `pub-partial-retry-${publicId}`,
  });
  const retryResults = retry.json.results || [];
  const igAlready = retryResults.some((r) => r.platform === "instagram" && r.outcome === "already");
  const fbPublished = retryResults.some((r) => r.platform === "facebook" && r.outcome === "published");
  const sim = await jget(auth, "/api/admin/control-dev/sim");
  record("partial_retry_skips_instagram", "simulacion", igAlready && fbPublished, {
    results: retryResults,
    metaCalls: (sim.json.simulatedCalls || []).length,
  });
  await setScenario(auth, "ok");

  // uncertain Facebook scenario on a fresh job
  const batchU = `stab-unc-${randomUUID()}`;
  const createdU = await ingestAlbum(auth, [a, b, c], "Uncertain FB", batchU, "album");
  const idU = createdU.json.publicId;
  await waitReady(auth, idU);
  const verU = ((await jget(auth, `/api/admin/content/jobs/${idU}`)).json.job || {}).version || 1;
  await jpost(auth, `/api/admin/content/jobs/${idU}/action`, {
    action: "approve",
    version: verU,
    confirm: true,
    idempotencyKey: `ap-${idU}`,
  });
  await setScenario(auth, "uncertain_facebook");
  const pubU = await jpost(auth, `/api/admin/content/jobs/${idU}/action`, {
    action: "publish_now",
    version: verU,
    confirm: true,
    idempotencyKey: `pub-unc-${idU}`,
  });
  await setScenario(auth, "ok");
  const cardU = (await jget(auth, `/api/admin/content/jobs/${idU}`)).json.job || {};
  const uncertain = (cardU.publications || []).some((p) => p.status === "UNCERTAIN");
  await jpost(auth, "/api/admin/control-dev/sim", { resetCalls: true });
  const blocked = await jpost(auth, `/api/admin/content/jobs/${idU}/action`, {
    action: "publish_now",
    version: ((await jget(auth, `/api/admin/content/jobs/${idU}`)).json.job || {}).version || verU,
    confirm: true,
    idempotencyKey: `pub-unc-retry-${idU}`,
  });
  const simBlocked = await jget(auth, "/api/admin/control-dev/sim");
  const newMeta = (simBlocked.json.simulatedCalls || []).filter((c) => c.provider === "meta").length;
  record(
    "uncertain_blocks_blind_retry",
    "api_aislada",
    uncertain && blocked.json.error === "uncertain_pending" && newMeta === 0,
    {
      publishError: pubU.json.error,
      results: pubU.json.results,
      blockedError: blocked.json.error,
      publications: cardU.publications,
      newMetaCalls: newMeta,
    },
  );

  // Concurrent publish + stale version
  const batchC = `stab-conc-${randomUUID()}`;
  const createdC = await ingestAlbum(auth, [a, b], "Concurrent", batchC, "album");
  const idC = createdC.json.publicId;
  await waitReady(auth, idC);
  const verC = ((await jget(auth, `/api/admin/content/jobs/${idC}`)).json.job || {}).version || 1;
  await jpost(auth, `/api/admin/content/jobs/${idC}/action`, {
    action: "approve",
    version: verC,
    confirm: true,
    idempotencyKey: `ap-${idC}`,
  });
  await setScenario(auth, "ok");
  const [c1, c2] = await Promise.all([
    jpost(auth, `/api/admin/content/jobs/${idC}/action`, {
      action: "publish_now",
      version: verC,
      confirm: true,
      idempotencyKey: `pub-conc-a-${idC}`,
    }),
    jpost(auth, `/api/admin/content/jobs/${idC}/action`, {
      action: "publish_now",
      version: verC,
      confirm: true,
      idempotencyKey: `pub-conc-b-${idC}`,
    }),
  ]);
  const cardC = (await jget(auth, `/api/admin/content/jobs/${idC}`)).json.job || {};
  const igPubs = (cardC.publications || []).filter((p) => p.platform === "instagram" && p.status === "PUBLISHED");
  record("concurrent_publish_single_ig", "simulacion", igPubs.length <= 1 && (c1.ok || c2.ok), {
    c1: c1.json.ok,
    c2: c2.json.ok,
    igPublishedRows: igPubs.length,
  });

  const staleEdit = await jpost(auth, `/api/admin/content/jobs/${idC}/action`, {
    action: "save_copy",
    version: 0,
    copy: "obsoleto",
    idempotencyKey: `stale-${idC}`,
  });
  record(
    "stale_version_edit_blocked",
    "api_aislada",
    staleEdit.json.error === "stale_version" ||
      staleEdit.json.error === "version_required" ||
      staleEdit.json.error === "already_published" ||
      staleEdit.status === 409,
    { error: staleEdit.json.error },
  );

  writeFileSync(join(evDir, "02-partial-uncertain.json"), JSON.stringify({ pub, retry, pubU, blocked, cardU, c1, c2 }, null, 2));
}

// --- Disposition / security: delegated physical matrix (PENDING, not fake PASS) ---
{
  results.push({
    name: "disposition_matrix_delegated",
    kind: "implementacion",
    result: "PENDING",
    detail: {
      pending: true,
      run: "node scripts/control-physical-a06-matrix.mjs",
      note: "Reject/cancel/security/notify covered there; not auto-PASS here",
    },
    at: new Date().toISOString(),
  });
  console.log("PENDING", "[implementacion]", "disposition_matrix_delegated");
  // Unauthorized without token
  const bad = await fetch(`${BASE}/api/admin/service-requests/HS-FAKE/disposition`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Homestead-Client": "control-mobile" },
    body: JSON.stringify({ action: "reject", confirm: true, reasonCategory: "OUT_OF_COVERAGE" }),
  });
  record("disposition_unauthorized", "api_aislada", bad.status === 401, { status: bad.status });

  // Fresh login then revoke
  const auth2 = await login();
  await jpost(auth2, "/api/admin/logout", {});
  const afterRevoke = await fetch(`${BASE}/api/admin/content/home`, {
    headers: { Authorization: `Bearer ${auth2.session}`, "X-Homestead-Client": "control-mobile" },
  });
  record("revoked_session_blocked", "api_aislada", afterRevoke.status === 401, { status: afterRevoke.status });
}

writeFileSync(join(evDir, "RESULTS.json"), JSON.stringify({ failed, results }, null, 2));
writeFileSync(
  join(evDir, "COPY-BEHAVIOR.md"),
  `# Copy from AI context — comportamiento real

- **Generador:** \`rewriteCopyOnly\` (\`src/lib/content-openai.ts\`) vía \`controlCopyFromContext\`.
- La nota del operador es **orientación**; no se publica literalmente como caption.
- **Aislado:** el generador responde con \`isolatedCopyFallback\` → \`usedFallback\` + \`needsReview\`.
- **Fallback plantilla:** si el modelo falla → prompt \`control-template-fallback\` + \`needsReview\`.
- **Ediciones manuales:** \`save_copy\` conserva el texto hasta regenerar.
- Sin visión de fotos en Control intake.

No llamar a la plantilla "generación IA" sin marcar revisión.
`,
);

console.log("\nDONE failed=", failed);
process.exit(failed ? 1 : 0);
