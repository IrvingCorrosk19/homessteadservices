#!/usr/bin/env python3
"""Wave A canaries. Test phone 60001111. Does not print secrets."""
import json
import sqlite3
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

DB = "/opt/apps/homestead/data/homestead.sqlite"
ENV = "/opt/apps/homestead/deploy/vps/.env"
BASE = "http://127.0.0.1:3091"
MARKER = "WAVE-A-TEST"


def env_map():
    values = {}
    for line in Path(ENV).read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        values[key.strip()] = val.strip().strip('"')
    return values


def multipart(fields):
    boundary = "----HomesteadWaveA"
    chunks = []
    for key, value in fields.items():
        chunks.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{key}\"\r\n\r\n{value}\r\n")
    body = ("".join(chunks) + f"--{boundary}--\r\n").encode()
    return body, f"multipart/form-data; boundary={boundary}"


def post_form(message):
    body, ctype = multipart(
        {
            "name": "Canario Wave A",
            "phone": "60001111",
            "email": "servicios@homestead.lat",
            "property": "apartment",
            "service": "ac",
            "message": message,
        }
    )
    req = urllib.request.Request(BASE + "/api/contact", data=body, method="POST")
    req.add_header("Content-Type", ctype)
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=40) as res:
        payload = json.loads(res.read().decode())
        http = res.status
    return http, payload, int((time.time() - t0) * 1000)


def db():
    return sqlite3.connect(DB)


def request_row(public_id):
    con = db()
    row = con.execute(
        "SELECT public_id, phone FROM service_requests WHERE public_id=?",
        (public_id,),
    ).fetchone()
    outbox = con.execute(
        "SELECT event_id, status, attempts, last_error FROM automation_outbox WHERE correlation_id=?",
        (public_id,),
    ).fetchall()
    tg = con.execute(
        "SELECT status FROM service_request_messages WHERE public_id=? AND channel='TELEGRAM'",
        (public_id,),
    ).fetchall()
    em = con.execute(
        "SELECT status FROM service_request_messages WHERE public_id=? AND channel='EMAIL'",
        (public_id,),
    ).fetchall()
    test = con.execute("SELECT is_test FROM revenue_leads WHERE lead_id=?", (public_id,)).fetchone()
    con.close()
    return {"row": row, "outbox": outbox, "telegram": tg, "email": em, "is_test": test}


def canary_a():
    print("=== CANARY A FORM ===")
    http, payload, ms = post_form(f"{MARKER} Canary A formulario. No es un cliente real.")
    print("HTTP", http, "BODY", payload, "CLIENT_MS", ms)
    time.sleep(4)
    info = request_row(payload.get("requestId"))
    print("SQLITE", info)
    ok = http == 200 and payload.get("ok") and info["row"] and info["outbox"]
    print("CANARY_A", "PASS" if ok else "FAIL", payload.get("requestId"))
    return payload.get("requestId"), ms, ok


def canary_d():
    print("=== CANARY D TELEGRAM UPDATE_ID ===")
    values = env_map()
    secret = values.get("N8N_HOMESTEAD_WEBHOOK_SECRET") or values.get("HOMESTEAD_WEBHOOK_SECRET") or ""
    tg_secret = values.get("TELEGRAM_WEBHOOK_SECRET") or ""
    ts = str(int(time.time()))
    update_id = int(time.time()) % 1000000000 + 900000000
    payload = {
        "headers": {"x-telegram-bot-api-secret-token": tg_secret},
        "body": {
            "update_id": update_id,
            "callback_query": {
                "id": "wave-a-d",
                "from": {"id": 1},
                "message": {"chat": {"id": 1}, "message_id": 1},
                "data": "cs:HC-2099-000001:process",
            },
        },
    }
    raw = json.dumps(payload).encode()

    def once():
        req = urllib.request.Request(BASE + "/api/internal/content/telegram-update", data=raw, method="POST")
        req.add_header("Content-Type", "application/json")
        req.add_header("X-Homestead-Webhook-Secret", secret)
        req.add_header("X-Homestead-Timestamp", ts)
        req.add_header("X-Telegram-Bot-Api-Secret-Token", tg_secret)
        try:
            with urllib.request.urlopen(req, timeout=20) as res:
                return res.status, json.loads(res.read().decode())
        except urllib.error.HTTPError as err:
            return err.code, json.loads(err.read().decode() or "{}")

    first = once()
    second = once()
    print("FIRST", first[0], {k: first[1].get(k) for k in ("ok", "denied", "duplicate")})
    print("SECOND", second[0], {k: second[1].get(k) for k in ("ok", "denied", "duplicate")})
    con = db()
    n = con.execute("SELECT COUNT(*) FROM content_telegram_updates WHERE update_id=?", (update_id,)).fetchone()[0]
    con.close()
    ok = first[0] == 200 and second[0] == 200 and second[1].get("duplicate") is True and n == 1
    print("CANARY_D", "PASS" if ok else "FAIL", "update_id", update_id, "rows", n)
    return ok


def canary_e():
    print("=== CANARY E SLOT CONCURRENCY ===")
    con = db()
    con.execute("PRAGMA busy_timeout=4000")
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    for lead in ("HS-WAVEA-L1", "HS-WAVEA-L2"):
        con.execute(
            "INSERT OR IGNORE INTO revenue_customers (created_at, name, phone, email, general_location, preferred_channel, source_first, source_last, do_not_contact, is_test) VALUES (?,?,?,?,?,'',?,?,0,1)",
            (now, lead, "60001111", "servicios@homestead.lat", "TEST", "WAVE_A", "WAVE_A"),
        )
        cid = con.execute("SELECT id FROM revenue_customers WHERE name=?", (lead,)).fetchone()[0]
        con.execute(
            """INSERT OR IGNORE INTO revenue_leads
               (lead_id, customer_id, created_at, updated_at, source, service_category, problem_summary, pipeline_stage, is_test, dry_run)
               VALUES (?,?,?,?, 'WAVE_A', 'ac', 'WAVE-A-TEST', 'NEW', 1, 1)""",
            (lead, cid, now, now),
        )
    con.commit()
    date = "2026-12-31"
    start = "11:00"
    con.execute(
        "DELETE FROM revenue_appointments WHERE date=? AND start_time=? AND lead_id IN ('HS-WAVEA-L1','HS-WAVEA-L2')",
        (date, start),
    )
    con.commit()
    con.close()

    sql = """INSERT INTO revenue_appointments
              (appointment_id, lead_id, customer_id, date, start_time, service, status, created_at, notes, source)
              VALUES (?,?,?,?,?,'ac','CONFIRMED',?, 'WAVE-A-TEST','WAVE_A')"""

    def insert_one(lead_id, appt_id):
        local = sqlite3.connect(DB, timeout=8)
        local.execute("PRAGMA busy_timeout=4000")
        cid = local.execute(
            "SELECT customer_id FROM revenue_leads WHERE lead_id=?",
            (lead_id,),
        ).fetchone()[0]
        try:
            local.execute(sql, (appt_id, lead_id, cid, date, start, now))
            local.commit()
            local.close()
            return True
        except sqlite3.IntegrityError:
            local.close()
            return False

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda item: insert_one(*item), [("HS-WAVEA-L1", "HA-wavea1"), ("HS-WAVEA-L2", "HA-wavea2")]))
    winners = sum(1 for item in results if item)
    con = db()
    open_n = con.execute(
        "SELECT COUNT(*) FROM revenue_appointments WHERE date=? AND start_time=? AND status IN ('REQUESTED','PROPOSED','CONFIRMED','RESCHEDULED')",
        (date, start),
    ).fetchone()[0]
    con.close()
    ok = winners == 1 and open_n == 1
    print("INSERTS", results, "OPEN", open_n)
    print("CANARY_E", "PASS" if ok else "FAIL")
    return ok


def main():
    integrity = db().execute("PRAGMA integrity_check").fetchone()[0]
    print("SQLITE_INTEGRITY", integrity)
    a_id, ms, a_ok = canary_a()
    d_ok = canary_d()
    e_ok = canary_e()
    print("CONTACT_MS", ms)
    print("WAVE_A_CANARY_SUMMARY", {"A": a_ok, "D": d_ok, "E": e_ok, "requestId": a_id})


if __name__ == "__main__":
    main()
