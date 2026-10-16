import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");
const p = join(root, "n8n", "homestead-n8n-concierge-turn.json");
const wf = JSON.parse(readFileSync(p, "utf8"));

const code = `const base = ($env.HOMESTEAD_INTERNAL_BASE || 'http://127.0.0.1:3095').replace(/\\/$/, '');
const secret = $env.CONCIERGE_INTERNAL_SECRET || '';
const root = $input.first().json;
const body = root.body || root;
const turnId = body.turnId;
const conversationId = body.conversationId;
const executionId = String($execution.id || '');

async function tool(name, payload = {}) {
  try {
    return await this.helpers.httpRequest({
      method: 'POST',
      url: \`\${base}/api/internal/concierge/\${name}\`,
      headers: {
        'content-type': 'application/json',
        'x-homestead-internal-secret': secret,
      },
      body: { turnId, conversationId, ...payload },
      json: true,
      timeout: 20000,
    });
  } catch (err) {
    const msg = err && err.message ? String(err.message) : String(err);
    let parsed = null;
    try { parsed = err && err.response && err.response.body ? err.response.body : null; } catch (_) {}
    return parsed && typeof parsed === 'object'
      ? parsed
      : { ok: false, code: 'tool_http_error', message: msg.slice(0, 200), tool: name };
  }
}

const interpret = await tool('interpret', {});
const route = await tool('route_decision', {});
const next = (route && route.data && route.data.nextAction) || 'ASK_MISSING';
const missing = (route && route.data && route.data.missing) || [];
let reply = '';
let kind = next;

if (next === 'BUSINESS_CONTACT') {
  const r = await tool('business_contact', {});
  reply = (r.data && r.data.reply) || 'No tengo un contacto comercial verificado.';
} else if (next === 'CANCEL_CONFIRM') {
  const scope = (route.data.pendingConfirmation === 'CANCEL_APPOINTMENT') ? 'appointment' : 'request';
  const r = await tool('cancel', { scope, confirm: true });
  reply = r.ok
    ? (scope === 'appointment'
      ? 'Listo, cancelé la cita. La solicitud queda abierta si aún la necesitas.'
      : \`Cancelé la solicitud \${(r.data && r.data.publicId) || ''}.\`)
    : \`No pude cancelar (\${r.code || 'error'}).\`;
} else if (next === 'CANCEL_ASK') {
  const r = await tool('cancel', { scope: 'request', confirm: false });
  reply = (r.data && r.data.awaitingConfirmation)
    ? '¿Confirmas que cancelo la solicitud completa? Responde sí para confirmar.'
    : (r.message || '¿Confirmas la cancelación?');
} else if (next === 'CANCEL_ALL_ASK') {
  const r = await tool('cancel_all_ask', {});
  reply = (r.data && r.data.reply) || r.message || 'No pude listar solicitudes.';
} else if (next === 'CANCEL_ALL_CONFIRM') {
  const r = await tool('cancel_all_confirm', {});
  reply = (r.data && r.data.reply) || r.message || 'No pude cancelar.';
} else if (next === 'SECOND_SERVICE_ASK') {
  const r = await tool('second_service', {});
  reply = (r.data && r.data.reply) || '¿Seguimos con la solicitud actual o abrimos otra?';
} else if (next === 'HUMAN') {
  const r = await tool('human_handoff', {});
  reply = (r.data && r.data.reply) || 'Dejo tu caso para revisión humana.';
} else if (next === 'BOOK') {
  const hint = route.data.bookHint || {};
  const r = await tool('book_appointment', { date: hint.date, time: hint.time });
  if (r.ok) {
    reply = \`Quedó reservada la visita para \${hint.date || ''} \${hint.time || ''}.\`;
  } else {
    // Race after offer: keep data, never announce success, re-offer fresh slots.
    const avail = await tool('check_availability', {});
    const composed = await tool('compose_ask', { kind: 'slots', toolData: avail.data || {} });
    const slotsReply = (composed.data && composed.data.reply) || '';
    reply = (r.message || 'Ese horario ya no está disponible. Tus datos siguen guardados.') +
      (slotsReply ? \`\\n\\n\${slotsReply}\` : ' ¿Cuál otro te sirve?');
  }
} else if (next === 'RESCHEDULE') {
  const hint = route.data.bookHint || {};
  if (!hint.date || !hint.time) {
    const avail = await tool('check_availability', {});
    const composed = await tool('compose_ask', { kind: 'slots', toolData: avail.data || {} });
    reply = (composed.data && composed.data.reply) || '¿Qué nuevo horario te sirve?';
  } else {
    const r = await tool('reschedule', { date: hint.date, time: hint.time });
    reply = r.ok
      ? \`Reprogramé la visita para \${hint.date} \${hint.time}.\`
      : (r.message || 'No pude reprogramar; la cita anterior se conserva.');
  }
} else if (next === 'CHECK_AVAILABILITY') {
  await tool('upsert_request', {});
  const avail = await tool('check_availability', {});
  const composed = await tool('compose_ask', { kind: 'slots', toolData: avail.data || {} });
  reply = (composed.data && composed.data.reply) || 'No veo horarios libres.';
} else if (next === 'DIGITAL_LOCK') {
  await tool('upsert_request', {});
  const composed = await tool('compose_ask', { kind: 'digital_lock' });
  reply = (composed.data && composed.data.reply) || 'Para cerradura digital necesito fotos y contacto.';
} else if (next === 'LOCKOUT') {
  const up = await tool('upsert_request', {});
  const composed = await tool('compose_ask', { kind: 'lockout', toolData: up.data || {} });
  reply = (composed.data && composed.data.reply) || 'Para la apertura necesito teléfono y zona.';
} else if (next === 'UPSERT_AND_CONTINUE') {
  const up = await tool('upsert_request', {});
  if (up && up.ok) {
    const composed = await tool('compose_ask', { kind: 'folio_continue', toolData: up.data || {} });
    reply = (composed.data && composed.data.reply) || 'Seguimos con tu solicitud.';
  } else {
    const composed = await tool('compose_ask', { kind: 'missing', toolData: { missing, code: up && up.code } });
    reply = (composed.data && composed.data.reply) || 'Me faltan algunos datos para registrar la solicitud.';
  }
} else {
  const composed = await tool('compose_ask', { kind: 'missing', toolData: { missing } });
  reply = (composed.data && composed.data.reply) || 'Cuéntame un poco más (zona y teléfono) para dejarte registrada.';
}

const fin = await tool('finalize_turn', { reply, n8nExecutionId: executionId, kind });
return [{
  json: {
    ok: true,
    executionId,
    turnId,
    conversationId,
    nextAction: next,
    folio: (fin.data && fin.data.folio) || '',
    interpretOk: !!(interpret && interpret.ok),
    routeOk: !!(route && route.ok),
    finalized: !!(fin && fin.ok),
  }
}];
`;

const node = wf.nodes.find((n) => n.id === "ct-coordinate");
if (!node) throw new Error("ct-coordinate missing");
node.parameters.jsCode = code;
wf.active = false;
writeFileSync(p, JSON.stringify(wf, null, 2) + "\n");
console.log("patched", p, "jsCode_len", code.length);
