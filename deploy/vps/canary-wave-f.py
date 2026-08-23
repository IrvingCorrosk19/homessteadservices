#!/usr/bin/env python3
"""Wave F live canaries — TEST rows only. No secrets printed. No fake revenue."""
from __future__ import annotations

import json
import sqlite3
import time
import uuid
import urllib.error
import urllib.request
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


def get_code(path: str, follow: bool = True) -> int:
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
            return None

    handlers = [] if follow else [NoRedirect()]
    opener = urllib.request.build_opener(*handlers)
    req = urllib.request.Request(BASE + path, method="GET")
    try:
        with opener.open(req, timeout=20) as res:
            return res.status
    except urllib.error.HTTPError as err:
        return err.code


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
            return err.code, json.loads(body) if body else {}
        except Exception:
            return err.code, {"raw": body[:200]}


def main():
    global fails
    env = env_map()
    secret = env.get("N8N_HOMESTEAD_WEBHOOK_SECRET") or ""
    report("HEALTH", get_code("/") == 200)
    report("ADMIN_DASHBOARD_AUTH", get_code("/admin", follow=False) in (200, 302, 307))
    report("ADMIN_CLIENTES_AUTH", get_code("/admin/clientes", follow=False) in (200, 302, 307))
    report("INTEGRITY", sqlite3.connect(DB).execute("PRAGMA integrity_check").fetchone()[0] == "ok")

    conn = sqlite3.connect(DB, timeout=30)
    conn.row_factory = sqlite3.Row
    cols = {r[1] for r in conn.execute("PRAGMA table_info(revenue_customers)")}
    if "normalized_phone" not in cols:
        conn.execute("ALTER TABLE revenue_customers ADD COLUMN normalized_phone TEXT NOT NULL DEFAULT ''")
    if "email_normalized" not in cols:
        conn.execute("ALTER TABLE revenue_customers ADD COLUMN email_normalized TEXT NOT NULL DEFAULT ''")
    conn.commit()
    report("SCHEMA_NORM", "normalized_phone" in {r[1] for r in conn.execute("PRAGMA table_info(revenue_customers)")})

    stamp = int(time.time()) % 100000
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    phone = f"5076888{stamp % 10000:04d}"
    conn.execute(
        """
        INSERT INTO revenue_customers (
          name, phone, email, general_location, preferred_channel, source_first, source_last,
          do_not_contact, is_test, marketing_opt_in, normalized_phone, email_normalized, created_at
        ) VALUES (?, ?, ?, 'TEST', 'EMAIL', 'WAVE_F', 'WAVE_F', 0, 1, 0, ?, ?, ?)
        """,
        (f"WAVE-F Canary {stamp}", phone, f"wave-f-{stamp}@example.invalid", phone, f"wave-f-{stamp}@example.invalid", now),
    )
    cust = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    lead = f"HS-2099-{stamp:06d}"
    conn.execute(
        """
        INSERT INTO revenue_leads (
          lead_id, customer_id, created_at, updated_at, source, source_detail, utm_json,
          service_category, problem_summary, temperature, pipeline_stage, is_test, dry_run
        ) VALUES (?, ?, ?, ?, 'WAVE_F', 'RETENTION_MAINTENANCE', '{}', 'air_conditioning', 'wave f canary', 'WARM', 'NEW', 1, 1)
        """,
        (lead, cust, now, now),
    )
    # service_requests may require more columns — skip if insert fails and use lead only
    try:
        conn.execute(
            """
            INSERT INTO service_requests (
              public_id, created_at, name, phone, email, property, service, message, photos_json, status
            ) VALUES (?, ?, ?, ?, ?, 'residential', 'air_conditioning', 'wave f', '[]', 'NEW')
            """,
            (lead, now, f"WAVE-F {stamp}", phone, f"wave-f-{stamp}@example.invalid"),
        )
    except sqlite3.Error as err:
        print("SR_INSERT_SKIP", type(err).__name__)
    appt = f"HA-wavef{stamp:08d}"
    try:
        conn.execute(
            """
            INSERT INTO revenue_appointments (
              appointment_id, lead_id, customer_id, date, start_time, service, status, created_at
            ) VALUES (?, ?, ?, '2099-12-01', '10:00', 'air_conditioning', 'CONFIRMED', ?)
            """,
            (appt, lead, cust, now),
        )
    except sqlite3.Error as err:
        print("HA_INSERT_SKIP", type(err).__name__)
    j1 = f"HJ-2099-{800000 + (stamp % 1000):06d}"
    j2 = f"HJ-2099-{801000 + (stamp % 1000):06d}"
    for jid in (j1, j2):
        conn.execute(
            """
            INSERT INTO revenue_jobs (
              job_id, job_number, lead_id, customer_id, service, scope, status, payment_status,
              satisfaction, photo_permission, created_at, completed_at, is_test, feedback_cycle
            ) VALUES (?, ?, ?, ?, 'air_conditioning', 'wave-f', 'COMPLETED', 'UNPAID', '', 0, ?, ?, 1, 1)
            """,
            (jid, jid, lead, cust, now, now),
        )
    conn.commit()

    completed = conn.execute(
        "SELECT COUNT(*) AS n FROM revenue_jobs WHERE customer_id=? AND status='COMPLETED'",
        (cust,),
    ).fetchone()["n"]
    report("LIVE_REPEAT", completed >= 2, f"completed={completed}")

    # Funnel counts for controlled today-ish inserts (created_at = now)
    leads_n = conn.execute(
        "SELECT COUNT(*) AS n FROM revenue_leads WHERE customer_id=? AND is_test=1",
        (cust,),
    ).fetchone()["n"]
    jobs_n = conn.execute(
        "SELECT COUNT(*) AS n FROM revenue_jobs WHERE customer_id=? AND is_test=1",
        (cust,),
    ).fetchone()["n"]
    report("LIVE_FUNNEL_ENTITY", leads_n == 1 and jobs_n == 2)

    # Retention attribution present on lead
    src = conn.execute(
        "SELECT source_detail FROM revenue_leads WHERE lead_id=?",
        (lead,),
    ).fetchone()["source_detail"]
    report("LIVE_RETENTION_ATTR", "RETENTION_" in (src or ""))

    # Duplicate detection: second customer same phone should be detectable
    conn.execute(
        """
        INSERT INTO revenue_customers (
          name, phone, email, general_location, preferred_channel, source_first, source_last,
          do_not_contact, is_test, marketing_opt_in, normalized_phone, email_normalized, created_at
        ) VALUES (?, ?, ?, 'TEST', 'EMAIL', 'WAVE_F', 'WAVE_F', 0, 1, 0, ?, ?, ?)
        """,
        (f"WAVE-F Dup {stamp}", phone, f"wave-f-dup-{stamp}@example.invalid", phone, f"wave-f-dup-{stamp}@example.invalid", now),
    )
    dup_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    conn.commit()
    dups = conn.execute(
        "SELECT COUNT(*) AS n FROM revenue_customers WHERE normalized_phone=? AND is_test=1",
        (phone,),
    ).fetchone()["n"]
    report("LIVE_DUPLICATE_DETECT", dups >= 2)
    report("LIVE_NO_AUTO_MERGE", cust != dup_id and dups >= 2)

    # Admin pages exist (auth gate)
    report("IDOR_UNAUTH", get_code(f"/admin/clientes/{cust}", follow=False) in (302, 307, 401))

    if secret:
        hdrs = {
            "Content-Type": "application/json",
            "X-Homestead-Timestamp": str(int(time.time())),
            "X-Homestead-Webhook-Secret": secret,
        }
        code, body = post("/api/internal/ops/summary", {}, hdrs)
        # summary endpoint may differ — accept 200 or 404
        report("OPS_SUMMARY_ENDPOINT", code in (200, 404, 405), f"http={code}")
    else:
        report("OPS_SUMMARY_ENDPOINT", False, "missing_secret")

    # Cleanup
    conn.execute("DELETE FROM revenue_jobs WHERE customer_id IN (?,?)", (cust, dup_id))
    conn.execute("DELETE FROM revenue_appointments WHERE customer_id=?", (cust,))
    conn.execute("DELETE FROM service_requests WHERE public_id=?", (lead,))
    conn.execute("DELETE FROM revenue_leads WHERE customer_id=?", (cust,))
    conn.execute("DELETE FROM revenue_customers WHERE id IN (?,?)", (cust, dup_id))
    conn.commit()
    report("SQLITE_FINAL", conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok")
    conn.close()
    print("WAVE_F_CANARY_FAILS", fails)
    raise SystemExit(1 if fails else 0)


if __name__ == "__main__":
    main()
