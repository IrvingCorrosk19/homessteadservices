#!/usr/bin/env python3
"""Wave C E2E canaries A-I. Uses is_test jobs. Does not print secrets."""
import hashlib
import json
import os
import sqlite3
import time
import urllib.error
import urllib.request
from pathlib import Path

DB = "/opt/apps/homestead/data/homestead.sqlite"
ENV = "/opt/apps/homestead/deploy/vps/.env"
BASE = "http://127.0.0.1:3091"
DATA = "/opt/apps/homestead/data"


def env_map():
    values = {}
    for line in Path(ENV).read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        values[key.strip()] = val.strip().strip('"')
    return values


def headers(secret, extra=None):
    out = {
        "Content-Type": "application/json",
        "X-Homestead-Timestamp": str(int(time.time())),
        "X-Homestead-Webhook-Secret": secret,
    }
    if extra:
        out.update(extra)
    return out


def post(path, payload, hdrs):
    raw = json.dumps(payload).encode()
    req = urllib.request.Request(BASE + path, data=raw, method="POST")
    for key, value in hdrs.items():
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


def get(path, hdrs=None):
    req = urllib.request.Request(BASE + path, method="GET")
    if hdrs:
        for key, value in hdrs.items():
            req.add_header(key, value)
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            body = res.read().decode() or "{}"
            try:
                return res.status, json.loads(body)
            except Exception:
                return res.status, {"raw": body[:200]}
    except urllib.error.HTTPError as err:
        return err.code, {}


def report(name, ok, detail=""):
    print(f"{name}: {'PASS' if ok else 'FAIL'} {detail}".strip())
    return 0 if ok else 1


JPEG = bytes(
    [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]
    + [0xFF, 0xD9]
)


def next_hj(con):
    year = 2026
    row = con.execute("SELECT last FROM revenue_job_counters WHERE year=?", (year,)).fetchone()
    last = (row[0] if row else 0) + 1
    if row:
        con.execute("UPDATE revenue_job_counters SET last=? WHERE year=?", (last, year))
    else:
        con.execute("INSERT INTO revenue_job_counters (year, last) VALUES (?,?)", (year, last))
    return f"HJ-{year}-{last:06d}"


def unique_slot(con, stamp):
    day = 1 + (stamp % 27)
    hour = 8 + (stamp % 10)
    minute = (stamp % 4) * 15
    date = f"2026-11-{day:02d}"
    start = f"{hour:02d}:{minute:02d}"
    while con.execute(
        "SELECT 1 FROM revenue_appointments WHERE date=? AND start_time=? AND status IN ('REQUESTED','PROPOSED','CONFIRMED','RESCHEDULED')",
        (date, start),
    ).fetchone():
        minute += 15
        if minute >= 60:
            minute = 0
            hour += 1
        if hour >= 20:
            hour = 8
            day = 1 if day >= 27 else day + 1
        date = f"2026-11-{day:02d}"
        start = f"{hour:02d}:{minute:02d}"
    return date, start


def seed_job(con, suffix, email="canary-wave-c@homestead.lat"):
    now = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
    stamp = int(time.time() * 1000) % 100000000
    cust = con.execute(
        "INSERT INTO revenue_customers (created_at, name, phone, email, general_location, preferred_channel, source_first, source_last, do_not_contact, is_test) VALUES (?,?,?,?,?,?,?,?,0,1)",
        (now, f"Canario {suffix}", "60001111", email, "Bella Vista", "", "WAVE-C", "WAVE-C"),
    ).lastrowid
    lead = f"HS-2026-{800000 + (stamp % 199000):06d}"
    # avoid collision
    while con.execute("SELECT 1 FROM service_requests WHERE public_id=?", (lead,)).fetchone() or con.execute(
        "SELECT 1 FROM revenue_leads WHERE lead_id=?", (lead,)
    ).fetchone():
        stamp += 1
        lead = f"HS-2026-{800000 + (stamp % 199000):06d}"
    con.execute(
        "INSERT INTO service_requests (public_id, created_at, updated_at, name, phone, email, property, service, message, photos_json, status) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (lead, now, now, f"Canario {suffix}", "60001111", email, "apartment", "ac", f"WAVE-C-TEST {suffix} aire no enfria", "[]", "CONTACTED"),
    )
    con.execute(
        "INSERT INTO revenue_leads (lead_id, customer_id, created_at, updated_at, source, service_category, problem_summary, temperature, lead_score, pipeline_stage, next_action, is_test) VALUES (?,?,?,?,?,?,?,?,?,?,?,1)",
        (lead, cust, now, now, "WAVE-C", "ac", "aire no enfria WAVE-C-TEST", "HOT", 80, "SCHEDULED", "VISIT"),
    )
    appt = f"HA-c{suffix.lower()}{stamp:08x}"[:16]
    date, start = unique_slot(con, stamp)
    con.execute(
        "INSERT INTO revenue_appointments (appointment_id, lead_id, job_id, customer_id, date, start_time, service, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (appt, lead, "", cust, date, start, "ac", "CONFIRMED", now),
    )
    job = next_hj(con)
    con.execute(
        "INSERT INTO revenue_jobs (job_id, job_number, lead_id, customer_id, quote_id, appointment_id, service, scope, status, payment_status, created_at, is_test) VALUES (?,?,?,?,?,?,?,?, 'SCHEDULED','UNPAID',?,1)",
        (job, job, lead, cust, "", appt, "ac", "aire no enfria", now),
    )
    con.execute("UPDATE revenue_leads SET job_id=? WHERE lead_id=?", (job, lead))
    con.execute("UPDATE revenue_appointments SET job_id=? WHERE appointment_id=?", (job, appt))
    con.commit()
    return {"job": job, "lead": lead, "appt": appt, "customer": cust}


def add_photo(con, job_id, n):
    rel = f"jobs/2026/08/{job_id}/originals/original-{n:03d}.jpg"
    path = os.path.join(DATA, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    payload = JPEG + str(n).encode() + job_id.encode()
    with open(path, "wb") as handle:
        handle.write(payload)
    digest = hashlib.sha256(payload).hexdigest()
    now = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
    con.execute(
        "INSERT INTO job_photos (job_id, original_relpath, sha256, byte_size, mime, role, marketing_usage_approved, created_at, created_by) VALUES (?,?,?,?,?,?,0,?,?)",
        (job_id, rel, digest, len(payload), "image/jpeg", "WORK", now, "canary"),
    )
    count = con.execute("SELECT COUNT(*) FROM job_photos WHERE job_id=?", (job_id,)).fetchone()[0]
    con.execute("UPDATE revenue_jobs SET photo_count=? WHERE job_id=?", (count, job_id))
    con.commit()
    return rel


def main():
    values = env_map()
    secret = values.get("N8N_HOMESTEAD_WEBHOOK_SECRET") or ""
    tg = values.get("TELEGRAM_WEBHOOK_SECRET") or ""
    admin = (values.get("HOMESTEAD_TELEGRAM_ADMIN_CHAT_IDS") or "").split(",")[0].strip()
    review = (values.get("HOMESTEAD_REVIEW_URL") or "").strip()
    hdrs = headers(secret)
    failed = 0
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row

    integrity = con.execute("PRAGMA integrity_check").fetchone()[0]
    failed += report("SQLITE_INTEGRITY", integrity == "ok", integrity)

    a = seed_job(con, "A")
    start = post("/api/internal/ops/action", {"action": "job.start", "entityId": a["job"]}, hdrs)
    complete = post("/api/internal/ops/action", {"action": "job.complete", "entityId": a["job"]}, hdrs)
    again = post("/api/internal/ops/action", {"action": "job.complete", "entityId": a["job"]}, hdrs)
    job = con.execute("SELECT status, completed_at, lead_id, appointment_id, customer_id FROM revenue_jobs WHERE job_id=?", (a["job"],)).fetchone()
    outbox = con.execute("SELECT COUNT(*) FROM automation_outbox WHERE idempotency_key=?", (f"job.completed:{a['job']}",)).fetchone()[0]
    follow = con.execute("SELECT COUNT(*) FROM automation_outbox WHERE idempotency_key LIKE ?", (f"post_service.followup_due:{a['job']}:%",)).fetchone()[0]
    print("CANARY_A", a, start[1], complete[1], again[1])
    failed += report("CANARY_A_RELATIONS", bool(job and job["lead_id"] == a["lead"] and job["appointment_id"] == a["appt"] and job["customer_id"] == a["customer"]))
    failed += report("CANARY_A_COMPLETED", bool(job and job["status"] == "COMPLETED" and job["completed_at"]))
    failed += report("CANARY_A_OUTBOX_ONCE", outbox == 1)
    failed += report("CANARY_A_FOLLOWUP_OUTBOX", follow == 1)
    failed += report("CANARY_G_COMPLETE_DUP", again[1].get("already") is True or again[1].get("reason") == "already")

    b = seed_job(con, "B")
    post("/api/internal/ops/action", {"action": "job.complete", "entityId": b["job"]}, hdrs)
    token = "c" * 64
    exp = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(time.time() + 86400))
    now = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
    con.execute("INSERT INTO job_feedback_tokens (token, job_id, cycle, expires_at, used_at, response, created_at) VALUES (?,?,1,?,NULL,'',?)", (token, b["job"], exp, now))
    con.commit()
    page = get(f"/experiencia/{token}")
    sat = post("/api/experiencia", {"token": token, "response": "EXCELLENT"}, {})
    sat2 = post("/api/experiencia", {"token": token, "response": "NEEDS_HELP"}, {})
    row = con.execute("SELECT satisfaction_response, review_requested_at, recovery_status FROM revenue_jobs WHERE job_id=?", (b["job"],)).fetchone()
    failed += report("CANARY_B_PAGE", page[0] == 200)
    failed += report("CANARY_B_POSITIVE", sat[1].get("ok") is True and sat[1].get("needsHelp") is False)
    failed += report("CANARY_B_NO_DUP", sat2[1].get("already") is True and row["satisfaction_response"] == "EXCELLENT")
    failed += report("CANARY_B_NO_RECOVERY", row["recovery_status"] != "OPEN")
    if review.startswith("https://"):
        failed += report("CANARY_D_REVIEW_BUTTON", bool(sat[1].get("reviewUrl")))
    else:
        failed += report("CANARY_D_REVIEW_URL_NOT_CONFIGURED", not sat[1].get("reviewUrl"))
        print("REVIEW_URL_NOT_CONFIGURED")

    c = seed_job(con, "C")
    post("/api/internal/ops/action", {"action": "job.complete", "entityId": c["job"]}, hdrs)
    token_c = "d" * 64
    con.execute("INSERT INTO job_feedback_tokens (token, job_id, cycle, expires_at, used_at, response, created_at) VALUES (?,?,1,?,NULL,'',?)", (token_c, c["job"], exp, now))
    con.commit()
    help_ = post("/api/experiencia", {"token": token_c, "response": "NEEDS_HELP"}, {})
    rec = con.execute("SELECT recovery_status FROM revenue_jobs WHERE job_id=?", (c["job"],)).fetchone()
    rec_out = con.execute("SELECT COUNT(*) FROM automation_outbox WHERE idempotency_key=?", (f"customer.service_recovery:{c['job']}:1",)).fetchone()[0]
    rec2 = post("/api/experiencia", {"token": token_c, "response": "NEEDS_HELP"}, {})
    rec_out2 = con.execute("SELECT COUNT(*) FROM automation_outbox WHERE idempotency_key=?", (f"customer.service_recovery:{c['job']}:1",)).fetchone()[0]
    contacted = post("/api/internal/ops/action", {"action": "job.recovery", "entityId": c["job"]}, hdrs)
    contacted2 = post("/api/internal/ops/action", {"action": "job.recovery", "entityId": c["job"]}, hdrs)
    failed += report("CANARY_C_HELP", help_[1].get("needsHelp") is True and help_[1].get("reviewUrl") in ("", None))
    failed += report("CANARY_C_RECOVERY", rec["recovery_status"] == "OPEN" and rec_out == 1)
    failed += report("CANARY_G_RECOVERY_DUP", rec2[1].get("already") is True and rec_out2 == 1)
    failed += report("CANARY_C_CONTACTED", contacted[1].get("ok") is True)
    failed += report("CANARY_C_CONTACTED_IDEM", contacted2[1].get("already") is True)

    e = seed_job(con, "E")
    rel1 = add_photo(con, e["job"], 1)
    rel2 = add_photo(con, e["job"], 2)
    mixed = "/photos/" in rel1 or rel1.startswith("content/")
    count = con.execute("SELECT COUNT(*) FROM job_photos WHERE job_id=?", (e["job"],)).fetchone()[0]
    failed += report("CANARY_E_PHOTOS", count == 2 and rel1.endswith("original-001.jpg") and rel2.endswith("original-002.jpg") and not mixed)

    f = seed_job(con, "F")
    add_photo(con, f["job"], 1)
    add_photo(con, f["job"], 2)
    post("/api/internal/ops/action", {"action": "job.complete", "entityId": f["job"]}, hdrs)
    denied_content = post("/api/internal/ops/action", {"action": "job.content", "entityId": f["job"], "chatId": admin or "1"}, hdrs)
    failed += report("CANARY_F_BLOCKED_WITHOUT_MARKETING", denied_content[1].get("reason") == "marketing_not_approved")
    post("/api/internal/ops/action", {"action": "job.marketing", "entityId": f["job"]}, hdrs)
    created = post("/api/internal/ops/action", {"action": "job.content", "entityId": f["job"], "chatId": admin or "1"}, hdrs)
    created2 = post("/api/internal/ops/action", {"action": "job.content", "entityId": f["job"], "chatId": admin or "1"}, hdrs)
    src = con.execute("SELECT source_content_id FROM revenue_jobs WHERE job_id=?", (f["job"],)).fetchone()
    failed += report("CANARY_F_CONTENT_REUSED", created[1].get("ok") is True and str(created[1].get("contentId") or "").startswith("HC-"))
    failed += report("CANARY_F_NO_AUTOPUBLISH", created[1].get("reason") in ("created", "existing"))
    failed += report("CANARY_G_CONTENT_DUP", created2[1].get("reason") == "existing" and created2[1].get("contentId") == created[1].get("contentId"))
    failed += report("CANARY_F_LINKED", bool(src and src["source_content_id"].startswith("HC-")))

    uid = int(time.time() * 1000) % 1000000000
    denied = post(
        "/api/internal/content/telegram-update",
        {"body": {"update_id": uid, "callback_query": {"id": "x", "from": {"id": 999000111}, "message": {"message_id": 9, "chat": {"id": 999000111}}, "data": f"cc:w:{a['job']}"}}},
        headers(secret, {"X-Telegram-Bot-Api-Secret-Token": tg}),
    )
    failed += report("CANARY_I_UNAUTH_JOB", denied[0] == 200 and denied[1].get("denied") is True)
    idor = post("/api/experiencia", {"token": "e" * 64, "response": "EXCELLENT"}, {})
    failed += report("CANARY_I_BAD_TOKEN", idor[1].get("ok") is not True)
    other_row = con.execute("SELECT satisfaction_response FROM revenue_jobs WHERE job_id=?", (c["job"],)).fetchone()
    failed += report("CANARY_I_TOKEN_BOUND", other_row["satisfaction_response"] == "NEEDS_HELP")

    n8n = post("/api/internal/ops/action", {"action": "tick"}, hdrs)
    failed += report("CANARY_H_DRAIN_RUNS", n8n[0] == 200)
    still = con.execute("SELECT status, completed_at FROM revenue_jobs WHERE job_id=?", (a["job"],)).fetchone()
    failed += report("CANARY_H_BUSINESS_PERSISTS", still["status"] == "COMPLETED")

    print("REVIEW_URL", "configured" if review.startswith("https://") else "absent")
    print("FAILED_COUNT", failed)
    con.close()
    raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    main()
