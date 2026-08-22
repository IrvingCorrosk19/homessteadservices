#!/usr/bin/env python3
"""Wave B canaries. Test phone 60001111. Does not print secrets or full PII."""
import json
import sqlite3
import time
import urllib.error
import urllib.request
from pathlib import Path

DB = "/opt/apps/homestead/data/homestead.sqlite"
ENV = "/opt/apps/homestead/deploy/vps/.env"
BASE = "http://127.0.0.1:3091"
MARKER = "WAVE-B-TEST"


def env_map():
    values = {}
    for line in Path(ENV).read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        values[key.strip()] = val.strip().strip('"')
    return values


def db():
    return sqlite3.connect(DB)


def auth_headers(secret, extra=None):
    headers = {
        "Content-Type": "application/json",
        "X-Homestead-Timestamp": str(int(time.time())),
        "X-Homestead-Webhook-Secret": secret,
    }
    if extra:
        headers.update(extra)
    return headers


def post(path, payload, headers):
    raw = json.dumps(payload).encode()
    req = urllib.request.Request(BASE + path, data=raw, method="POST")
    for key, value in headers.items():
        req.add_header(key, value)
    try:
        with urllib.request.urlopen(req, timeout=40) as res:
            return res.status, json.loads(res.read().decode() or "{}")
    except urllib.error.HTTPError as err:
        body = err.read().decode() if err.fp else ""
        try:
            parsed = json.loads(body) if body else {}
        except Exception:
            parsed = {}
        return err.code, parsed


def get(path, headers):
    req = urllib.request.Request(BASE + path, method="GET")
    for key, value in headers.items():
        req.add_header(key, value)
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            return res.status, json.loads(res.read().decode() or "{}")
    except urllib.error.HTTPError as err:
        return err.code, {}


def multipart(fields):
    boundary = "----HomesteadWaveB"
    chunks = []
    for key, value in fields.items():
        chunks.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{key}\"\r\n\r\n{value}\r\n")
    body = ("".join(chunks) + f"--{boundary}--\r\n").encode()
    return body, f"multipart/form-data; boundary={boundary}"


def post_form(message):
    body, ctype = multipart(
        {
            "name": "Canario Wave B",
            "phone": "60001111",
            "email": "servicios@homestead.lat",
            "property": "apartment",
            "service": "ac",
            "message": message,
        }
    )
    req = urllib.request.Request(BASE + "/api/contact", data=body, method="POST")
    req.add_header("Content-Type", ctype)
    with urllib.request.urlopen(req, timeout=40) as res:
        return res.status, json.loads(res.read().decode())


def report(name, ok, detail=""):
    print(f"{name}: {'PASS' if ok else 'FAIL'} {detail}".strip())
    return ok


def backdate(public_id, minutes=20):
    iso = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(time.time() - minutes * 60))
    con = db()
    con.execute("UPDATE service_requests SET created_at=?, updated_at=? WHERE public_id=?", (iso, iso, public_id))
    con.execute(
        "UPDATE revenue_leads SET created_at=?, updated_at=?, rescue_alerted_at=NULL, first_human_action_at=NULL WHERE lead_id=?",
        (iso, iso, public_id),
    )
    con.commit()
    con.close()


def main():
    values = env_map()
    secret = values.get("N8N_HOMESTEAD_WEBHOOK_SECRET") or ""
    tg_secret = values.get("TELEGRAM_WEBHOOK_SECRET") or ""
    admin = (values.get("HOMESTEAD_TELEGRAM_ADMIN_CHAT_IDS") or "").split(",")[0].strip()
    failed = 0

    headers = auth_headers(secret)
    status, summary = get("/api/internal/ops/summary", headers)
    live = (summary.get("summary") or {}) if status == 200 else {}
    con = db()
    pending = con.execute(
        "SELECT COUNT(*) FROM service_requests r LEFT JOIN revenue_leads l ON l.lead_id=r.public_id WHERE r.status='NEW' AND COALESCE(l.is_test,0)=0"
    ).fetchone()[0]
    integrity = con.execute("PRAGMA integrity_check").fetchone()[0]
    con.close()
    failed += not report("SUMMARY_HTTP", status == 200, str(status))
    failed += not report("COUNTS_MATCH_DB", live.get("pendingRequests") == pending, f"api={live.get('pendingRequests')} db={pending}")
    failed += not report("SQLITE_INTEGRITY", integrity == "ok", integrity)

    unauth = post(
        "/api/internal/content/telegram-update",
        {
            "body": {
                "update_id": int(time.time()),
                "message": {
                    "message_id": 1,
                    "chat": {"id": 999000111},
                    "from": {"id": 999000111},
                    "text": "/homestead",
                },
            }
        },
        auth_headers(secret, {"X-Telegram-Bot-Api-Secret-Token": tg_secret}),
    )
    denied = unauth[0] == 200 and (unauth[1].get("denied") is True or unauth[1].get("ok") is True)
    failed += not report("UNAUTHORIZED_HOMESTEAD", unauth[0] in (200, 401))

    form_status, form = post_form(f"{MARKER} solicitud pendiente para SLA. El aire bota agua y no enfria.")
    public_id = (form.get("publicId") or form.get("requestId") or "") if form_status == 200 else ""
    failed += not report("FORM_CANARY", bool(public_id), public_id)
    if public_id:
        backdate(public_id, 20)
        tick_status, tick = post("/api/internal/ops/action", {"action": "tick"}, headers)
        con = db()
        sla = con.execute("SELECT sla_first_alerted_at, status FROM service_requests WHERE public_id=?", (public_id,)).fetchone()
        outbox = con.execute(
            "SELECT event_type, status FROM automation_outbox WHERE idempotency_key=?",
            (f"sla.first:{public_id}",),
        ).fetchone()
        con.close()
        failed += not report("SLA_FIRST", bool(sla and sla[0]) and bool(outbox), str(outbox))
        post("/api/internal/ops/action", {"action": "tick"}, headers)
        con = db()
        sla_count = con.execute(
            "SELECT COUNT(*) FROM automation_outbox WHERE idempotency_key=?",
            (f"sla.first:{public_id}",),
        ).fetchone()[0]
        con.close()
        failed += not report("SLA_NO_DUP", sla_count == 1, str(sla_count))
        contacted = post("/api/internal/ops/action", {"action": "contacted", "entityId": public_id}, headers)
        con = db()
        status_row = con.execute("SELECT status FROM service_requests WHERE public_id=?", (public_id,)).fetchone()
        con.close()
        failed += not report("MARK_CONTACTED", contacted[0] == 200 and status_row and status_row[0] != "NEW", str(status_row))

    rescue_id = f"HS-B-{int(time.time()) % 100000:05d}"
    iso = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(time.time() - 20 * 60))
    con = db()
    cust = con.execute("SELECT id FROM revenue_customers WHERE phone LIKE '%60001111%' LIMIT 1").fetchone()
    if cust:
        try:
            con.execute(
                """INSERT INTO revenue_leads (
                    lead_id, customer_id, conversation_id, source, service_category, problem_summary,
                    general_location, temperature, lead_score, pipeline_stage, next_action, next_follow_up_at,
                    is_test, dry_run, created_at, updated_at, phone_normalized, lead_created_at
                ) VALUES (?,?,?,'CHAT','ac','el aire bota agua y no enfria en Bella Vista',
                    'Bella Vista','HOT',90,'NEW','CALL_NOW',?,1,0,?,?, '60001111', ?)""",
                (rescue_id, cust[0], "", iso, iso, iso, iso),
            )
            con.commit()
        except sqlite3.IntegrityError:
            pass
    con.close()
    post("/api/internal/ops/action", {"action": "tick"}, headers)
    con = db()
    rescue_out = con.execute(
        "SELECT COUNT(*) FROM automation_outbox WHERE idempotency_key LIKE ?",
        (f"lead.rescue_eligible:{rescue_id}:%",),
    ).fetchone()[0]
    alerted = con.execute("SELECT rescue_alerted_at, rescue_cycle FROM revenue_leads WHERE lead_id=?", (rescue_id,)).fetchone()
    con.close()
    failed += not report("RESCUE_OUTBOX", rescue_out == 1 and bool(alerted and alerted[0]), f"outbox={rescue_out}")
    post("/api/internal/ops/action", {"action": "tick"}, headers)
    con = db()
    rescue_out2 = con.execute(
        "SELECT COUNT(*) FROM automation_outbox WHERE idempotency_key LIKE ?",
        (f"lead.rescue_eligible:{rescue_id}:%",),
    ).fetchone()[0]
    con.close()
    failed += not report("RESCUE_NO_DUP", rescue_out2 == 1, str(rescue_out2))
    snooze = post("/api/internal/ops/action", {"action": "snooze", "entityId": rescue_id, "minutes": 15}, headers)
    con = db()
    snoozed = con.execute("SELECT snoozed_until, rescue_alerted_at FROM revenue_leads WHERE lead_id=?", (rescue_id,)).fetchone()
    con.close()
    failed += not report("SNOOZE", snooze[0] == 200 and bool(snoozed and snoozed[0]) and not snoozed[1])

    brief1 = post("/api/internal/ops/action", {"action": "brief"}, headers)
    brief2 = post("/api/internal/ops/action", {"action": "brief"}, headers)
    con = db()
    brief_n = con.execute("SELECT COUNT(*) FROM automation_outbox WHERE event_type='daily.brief.ready' AND date(created_at)=date('now')").fetchone()[0]
    con.close()
    failed += not report("DAILY_BRIEF_ONCE", brief1[0] == 200 and brief2[0] == 200 and brief_n >= 1)

    forged = post(
        "/api/internal/ops/action",
        {"action": "contacted", "entityId": public_id or "HS-FAKE"},
        {"Content-Type": "application/json", "X-Homestead-Timestamp": str(int(time.time())), "X-Homestead-Webhook-Secret": "forged"},
    )
    failed += not report("FORGED_ACTION", forged[0] == 401, str(forged[0]))
    failed += not report("ADMIN_CONFIGURED", bool(admin))
    print("WAVE_B_CANARY", "PASS" if failed == 0 else "FAIL", failed)


if __name__ == "__main__":
    main()
