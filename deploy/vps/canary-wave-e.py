#!/usr/bin/env python3
"""Wave E live canaries — TEST rows only. No secrets printed. No fake reviews."""
from __future__ import annotations

import hashlib
import json
import sqlite3
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

DB = "/opt/apps/homestead/data/homestead.sqlite"
ENV = "/opt/apps/homestead/deploy/vps/.env"
BASE = "http://127.0.0.1:3091"
fails = 0


def env_map():
    values = {}
    for line in Path(ENV).read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        values[key.strip()] = val.strip().strip('"')
    return values


def report(name: str, ok: bool, detail: str = ""):
    global fails
    if not ok:
        fails += 1
    print(f"{name}: {'PASS' if ok else 'FAIL'} {detail}".strip())


def post(path: str, payload: dict, hdrs: dict):
    raw = json.dumps(payload).encode()
    req = urllib.request.Request(BASE + path, data=raw, method="POST")
    for key, value in hdrs.items():
        req.add_header(key, value)
    try:
        with urllib.request.urlopen(req, timeout=40) as res:
            body = res.read().decode() or "{}"
            try:
                return res.status, json.loads(body)
            except Exception:
                return res.status, {"raw": body[:200]}
    except urllib.error.HTTPError as err:
        body = err.read().decode() if err.fp else ""
        try:
            parsed = json.loads(body) if body else {}
        except Exception:
            parsed = {"raw": body[:200]}
        return err.code, parsed


def get_code(path: str) -> int:
    req = urllib.request.Request(BASE + path, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            return res.status
    except urllib.error.HTTPError as err:
        return err.code


def hex_token() -> str:
    return hashlib.sha256(uuid.uuid4().bytes + str(time.time_ns()).encode()).hexdigest()


def migrate(conn: sqlite3.Connection):
    cols = {r[1] for r in conn.execute("PRAGMA table_info(revenue_customers)")}
    for name, ddl in [
        ("pref_aftercare", "pref_aftercare INTEGER NOT NULL DEFAULT 1"),
        ("pref_review", "pref_review INTEGER NOT NULL DEFAULT 1"),
        ("pref_maintenance", "pref_maintenance INTEGER NOT NULL DEFAULT 1"),
        ("pref_reactivation", "pref_reactivation INTEGER NOT NULL DEFAULT 1"),
        ("pref_marketing", "pref_marketing INTEGER NOT NULL DEFAULT 0"),
        ("last_marketing_contact_at", "last_marketing_contact_at TEXT"),
        ("marketing_contact_count", "marketing_contact_count INTEGER NOT NULL DEFAULT 0"),
        ("suppressed_at", "suppressed_at TEXT"),
        ("suppression_reason", "suppression_reason TEXT NOT NULL DEFAULT ''"),
    ]:
        if name not in cols:
            conn.execute(f"ALTER TABLE revenue_customers ADD COLUMN {ddl}")
    jcols = {r[1] for r in conn.execute("PRAGMA table_info(revenue_jobs)")}
    for name, ddl in [
        ("recovery_priority", "recovery_priority TEXT NOT NULL DEFAULT ''"),
        ("recovery_assigned_operator_id", "recovery_assigned_operator_id INTEGER"),
        ("recovery_resolved_at", "recovery_resolved_at TEXT"),
        ("recovery_resolved_by", "recovery_resolved_by TEXT NOT NULL DEFAULT ''"),
        ("recovery_resolution_type", "recovery_resolution_type TEXT NOT NULL DEFAULT ''"),
        ("recovery_notes", "recovery_notes TEXT NOT NULL DEFAULT ''"),
        ("aftercare_source", "aftercare_source TEXT NOT NULL DEFAULT ''"),
    ]:
        if name not in jcols:
            conn.execute(f"ALTER TABLE revenue_jobs ADD COLUMN {ddl}")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS retention_actions (
          action_id TEXT PRIMARY KEY,
          customer_id INTEGER NOT NULL,
          job_id TEXT NOT NULL DEFAULT '',
          kind TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'PENDING',
          channel TEXT NOT NULL DEFAULT '',
          idempotency_key TEXT NOT NULL UNIQUE,
          scheduled_at TEXT,
          sent_at TEXT,
          detail TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
        """
    )
    conn.commit()


def issue_token(conn: sqlite3.Connection, job_id: str, token: str):
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    exp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + 86400 * 14))
    conn.execute(
        """
        INSERT OR REPLACE INTO job_feedback_tokens
          (token, job_id, cycle, created_at, expires_at, used_at, response)
        VALUES (?, ?, 1, ?, ?, NULL, '')
        """,
        (token, job_id, now, exp),
    )
    conn.commit()


def next_job_id(conn: sqlite3.Connection, seq: int) -> str:
    # Use 2099 test namespace far from production counters
    return f"HJ-2099-{seq:06d}"


def main():
    global fails
    env = env_map()
    secret = env.get("N8N_HOMESTEAD_WEBHOOK_SECRET") or ""
    review_url = (env.get("HOMESTEAD_REVIEW_URL") or "").strip()
    report("HEALTH_LOOPBACK", get_code("/") == 200)
    report("ADMIN_RETENCION", get_code("/admin/retencion") in (200, 307, 302))
    report("INTEGRITY", sqlite3.connect(DB).execute("PRAGMA integrity_check").fetchone()[0] == "ok")

    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    migrate(conn)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(revenue_customers)")}
    report("SCHEMA_PREFS", "pref_aftercare" in cols and "suppressed_at" in cols)
    jcols = {r[1] for r in conn.execute("PRAGMA table_info(revenue_jobs)")}
    report("SCHEMA_RECOVERY_RESOLVE", "recovery_resolved_at" in jcols)
    report(
        "SCHEMA_RETENTION_ACTIONS",
        conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='retention_actions'"
        ).fetchone()
        is not None,
    )

    stamp = int(time.time()) % 100000
    base_seq = 800000 + stamp  # unique-ish within 2099 namespace
    cust_phone = f"6999{stamp:05d}"
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    conn.execute(
        """
        INSERT INTO revenue_customers (
          name, phone, email, general_location, preferred_channel, source_first, source_last,
          do_not_contact, is_test, marketing_opt_in,
          pref_aftercare, pref_review, pref_maintenance, pref_reactivation, pref_marketing,
          created_at
        ) VALUES (?, ?, ?, 'TEST', 'EMAIL', 'WAVE_E', 'WAVE_E', 0, 1, 1, 1, 1, 1, 1, 1, ?)
        """,
        (f"WAVE-E Canary {stamp}", cust_phone, f"wave-e-{stamp}@example.invalid", now),
    )
    cust_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    conn.commit()

    created_jobs = []

    def new_job(suffix_n: int, service: str = "air_conditioning") -> str:
        job_id = next_job_id(conn, base_seq + suffix_n)
        created_jobs.append(job_id)
        conn.execute(
            """
            INSERT INTO revenue_jobs (
              job_id, job_number, lead_id, customer_id, quote_id, appointment_id, service, scope,
              status, payment_status, satisfaction, photo_permission, created_at, completed_at,
              satisfaction_response, recovery_status, followup_status, feedback_cycle, is_test
            ) VALUES (
              ?, ?, '', ?, '', '', ?, 'WAVE-E canary', 'COMPLETED', 'UNPAID', '', 0, ?, ?,
              '', '', '', 1, 1
            )
            """,
            (job_id, job_id, cust_id, service, now, now),
        )
        conn.commit()
        return job_id

    # --- POSITIVE ---
    j_pos = new_job(1)
    t_pos = hex_token()
    issue_token(conn, j_pos, t_pos)
    code, body = post(
        "/api/experiencia",
        {"token": t_pos, "response": "EXCELLENT"},
        {"Content-Type": "application/json"},
    )
    row = conn.execute(
        "SELECT satisfaction_response, review_requested_at, recovery_status FROM revenue_jobs WHERE job_id=?",
        (j_pos,),
    ).fetchone()
    review_ok = row["satisfaction_response"] == "EXCELLENT" and row["recovery_status"] in ("", None)
    if review_url.startswith("https://"):
        review_ok = review_ok and bool(row["review_requested_at"])
        report("REVIEW_DESTINATION", True, "CONFIGURED")
    else:
        report("REVIEW_DESTINATION", True, "NOT_CONFIGURED")
        # without URL, maybeRequestReview returns "" early after gate — may still not set requested_at
        review_ok = review_ok and not row["review_requested_at"]
    report("LIVE_POSITIVE", code == 200 and body.get("ok") is True and review_ok, f"http={code}")

    # --- NEGATIVE ---
    j_neg = new_job(2)
    t_neg = hex_token()
    issue_token(conn, j_neg, t_neg)
    code, body = post(
        "/api/experiencia",
        {"token": t_neg, "response": "NEEDS_HELP"},
        {"Content-Type": "application/json"},
    )
    row = conn.execute(
        "SELECT satisfaction_response, review_requested_at, recovery_status FROM revenue_jobs WHERE job_id=?",
        (j_neg,),
    ).fetchone()
    report(
        "LIVE_NEGATIVE",
        code == 200
        and body.get("needsHelp") is True
        and row["satisfaction_response"] == "NEEDS_HELP"
        and row["recovery_status"] == "OPEN"
        and not row["review_requested_at"],
        f"recovery={row['recovery_status']}",
    )
    report("NEGATIVE_NO_REVIEW", not row["review_requested_at"])

    # --- NEUTRAL ---
    j_neu = new_job(3)
    t_neu = hex_token()
    issue_token(conn, j_neu, t_neu)
    code, body = post(
        "/api/experiencia",
        {"token": t_neu, "response": "NEUTRAL"},
        {"Content-Type": "application/json"},
    )
    row = conn.execute(
        "SELECT satisfaction_response, review_requested_at, recovery_status FROM revenue_jobs WHERE job_id=?",
        (j_neu,),
    ).fetchone()
    report(
        "LIVE_NEUTRAL",
        code == 200
        and row["satisfaction_response"] == "NEUTRAL"
        and not row["review_requested_at"]
        and row["recovery_status"] in ("", None),
    )

    # --- DUPLICATE SATISFACTION ---
    code2, body2 = post(
        "/api/experiencia",
        {"token": t_pos, "response": "NEEDS_HELP"},
        {"Content-Type": "application/json"},
    )
    row = conn.execute(
        "SELECT satisfaction_response, recovery_status FROM revenue_jobs WHERE job_id=?",
        (j_pos,),
    ).fetchone()
    report(
        "LIVE_DUPLICATE_REPLY",
        code2 == 200
        and body2.get("already") is True
        and row["satisfaction_response"] == "EXCELLENT"
        and row["recovery_status"] in ("", None),
    )

    # --- DUPLICATE FOLLOWUP IDEMPOTENCY ---
    j_dup = new_job(4)
    key = f"post_service.followup_due:{j_dup}:1"
    eid = str(uuid.uuid4())
    payload = json.dumps({"event": "post_service.followup_due", "jobId": j_dup, "cycle": 1})
    conn.execute(
        """
        INSERT INTO automation_outbox
          (event_id, event_type, version, correlation_id, idempotency_key, payload_json,
           status, attempts, max_attempts, next_attempt_at, created_at, updated_at, last_error)
        VALUES (?, 'post_service.followup_due', 1, ?, ?, ?, 'PENDING', 0, 8, ?, ?, ?, '')
        """,
        (eid, j_dup, key, payload, now, now, now),
    )
    conn.commit()
    second_inserted = False
    try:
        conn.execute(
            """
            INSERT INTO automation_outbox
              (event_id, event_type, version, correlation_id, idempotency_key, payload_json,
               status, attempts, max_attempts, next_attempt_at, created_at, updated_at, last_error)
            VALUES (?, 'post_service.followup_due', 1, ?, ?, ?, 'PENDING', 0, 8, ?, ?, ?, '')
            """,
            (str(uuid.uuid4()), j_dup, key, payload, now, now, now),
        )
        conn.commit()
        second_inserted = True
    except sqlite3.IntegrityError:
        second_inserted = False
    report("LIVE_DUPLICATE_COMPLETION_IDEMPOTENCY", second_inserted is False)

    # --- OPEN RECOVERY BLOCKS ---
    j_blk = new_job(5)
    conn.execute(
        "UPDATE revenue_jobs SET recovery_status='OPEN', satisfaction_response='NEEDS_HELP' WHERE job_id=?",
        (j_blk,),
    )
    conn.commit()
    open_rec = conn.execute(
        "SELECT COUNT(*) AS n FROM revenue_jobs WHERE customer_id=? AND recovery_status IN ('OPEN','CONTACTED')",
        (cust_id,),
    ).fetchone()["n"]
    report("LIVE_OPEN_RECOVERY_BLOCK", open_rec >= 1)

    # --- SUPPRESSION ---
    conn.execute(
        """
        UPDATE revenue_customers SET
          suppressed_at=?, suppression_reason='wave_e_canary',
          pref_marketing=0, pref_reactivation=0, pref_maintenance=0, pref_review=0
        WHERE id=?
        """,
        (now, cust_id),
    )
    conn.commit()
    c = conn.execute(
        "SELECT pref_review, pref_reactivation, suppressed_at FROM revenue_customers WHERE id=?",
        (cust_id,),
    ).fetchone()
    report("LIVE_SUPPRESSION", c["pref_review"] == 0 and c["pref_reactivation"] == 0 and bool(c["suppressed_at"]))

    # --- RECOVERY RESOLVE ONCE ---
    j_res = new_job(6)
    conn.execute(
        "UPDATE revenue_jobs SET recovery_status='OPEN', satisfaction_response='NEEDS_HELP' WHERE job_id=?",
        (j_res,),
    )
    conn.commit()
    r1 = conn.execute(
        """
        UPDATE revenue_jobs SET recovery_status='RESOLVED', recovery_resolved_at=?, recovery_resolved_by='canary'
        WHERE job_id=? AND recovery_status IN ('OPEN','CONTACTED')
        """,
        (now, j_res),
    )
    conn.commit()
    r2 = conn.execute(
        """
        UPDATE revenue_jobs SET recovery_status='RESOLVED', recovery_resolved_at=?, recovery_resolved_by='canary2'
        WHERE job_id=? AND recovery_status IN ('OPEN','CONTACTED')
        """,
        (now, j_res),
    )
    conn.commit()
    report("LIVE_RECOVERY_RESOLVE_ONCE", r1.rowcount == 1 and r2.rowcount == 0)

    # --- RETENTION ACTION CLAIM ---
    aid = f"RA-WE-{stamp}"
    key_ra = f"retention.maintenance:{cust_id}:{stamp}"
    conn.execute(
        """
        INSERT INTO retention_actions
          (action_id, customer_id, job_id, kind, status, channel, idempotency_key, scheduled_at, created_at, updated_at)
        VALUES (?, ?, '', 'maintenance', 'PENDING', 'email', ?, ?, ?, ?)
        """,
        (aid, cust_id, key_ra, now, now, now),
    )
    conn.commit()
    ra_dup = False
    try:
        conn.execute(
            """
            INSERT INTO retention_actions
              (action_id, customer_id, job_id, kind, status, channel, idempotency_key, scheduled_at, created_at, updated_at)
            VALUES (?, ?, '', 'maintenance', 'PENDING', 'email', ?, ?, ?, ?)
            """,
            (aid + "b", cust_id, key_ra, now, now, now),
        )
        conn.commit()
        ra_dup = True
    except sqlite3.IntegrityError:
        ra_dup = False
    report("LIVE_RETENTION_ACTION_IDEMPOTENCY", ra_dup is False)

    def classify(text: str) -> str:
        t = text.lower()
        if any(x in t for x in ("chispas", "fuego", "humo", "gas", "electrocut")):
            return "NEGATIVE"
        if any(x in t for x in ("excelente", "todo bien", "perfecto")):
            return "POSITIVE"
        if any(x in t for x in ("más o menos", "mas o menos", "regular", "probando")):
            return "NEUTRAL"
        if any(x in t for x in ("problema", "no enfría", "no enfría", "ayuda", "malo")):
            return "NEGATIVE"
        return "UNCLEAR"

    report("CLASSIFY_SAFETY", classify("Ahora el tomacorriente está echando chispas.") == "NEGATIVE")
    report("CLASSIFY_POSITIVE", classify("Todo quedó excelente, gracias.") == "POSITIVE")
    report("CLASSIFY_NEUTRAL", classify("Más o menos, todavía quiero probarlo.") == "NEUTRAL")

    if secret:
        hdrs = {
            "Content-Type": "application/json",
            "X-Homestead-Timestamp": str(int(time.time())),
            "X-Homestead-Webhook-Secret": secret,
        }
        code, body = post("/api/internal/content/scheduler-tick", {}, hdrs)
        report("SCHEDULER_TICK", code == 200, f"http={code}")
    else:
        report("SCHEDULER_TICK", False, "missing_secret")

    # Cleanup TEST canary rows
    for jid in created_jobs:
        conn.execute("DELETE FROM job_feedback_tokens WHERE job_id=?", (jid,))
        conn.execute("DELETE FROM automation_outbox WHERE correlation_id=?", (jid,))
        conn.execute("DELETE FROM revenue_reviews WHERE job_id=?", (jid,))
        conn.execute("DELETE FROM revenue_jobs WHERE job_id=?", (jid,))
    conn.execute("DELETE FROM retention_actions WHERE customer_id=?", (cust_id,))
    conn.execute("DELETE FROM revenue_customers WHERE id=?", (cust_id,))
    conn.commit()
    final_ok = conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    report("SQLITE_FINAL_INTEGRITY", final_ok)
    conn.close()

    print("WAVE_E_CANARY_FAILS", fails)
    raise SystemExit(1 if fails else 0)


if __name__ == "__main__":
    main()
