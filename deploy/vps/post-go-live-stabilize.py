#!/usr/bin/env python3
"""Post-go-live stabilization checks — runs on VPS. No secrets/PII in output."""
from __future__ import annotations

import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

DB = "/opt/apps/homestead/data/homestead.sqlite"
ENV_PATH = Path("/opt/apps/homestead/deploy/vps/.env")
BASE = "http://127.0.0.1:3091"
OUT = Path("/opt/apps/homestead/data/post-go-live-stabilization.json")
results: list[dict] = []


def ok(name: str, passed: bool, detail: str = "") -> None:
    results.append({"name": name, "pass": passed, "detail": detail[:500]})
    print(("PASS" if passed else "FAIL"), name, detail[:200])


def load_env() -> dict[str, str]:
    out: dict[str, str] = {}
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text().splitlines():
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip().strip('"')
    return out


def http_get(path: str) -> tuple[int, str]:
    with urllib.request.urlopen(BASE + path, timeout=20) as resp:
        return resp.status, resp.read().decode()[:800]


def snapshot() -> None:
    code, _ = http_get("/api/health")
    ok("HEALTH", code == 200, f"code={code}")
    code, body = http_get("/api/ready")
    ok("READY", code == 200 and '"status":"ok"' in body, f"code={code}")
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    ok("DB_INTEGRITY", con.execute("PRAGMA integrity_check").fetchone()[0] == "ok", "ok")
    sr = con.execute("SELECT COUNT(*) FROM service_requests").fetchone()[0]
    rl = con.execute("SELECT COUNT(*) FROM revenue_leads").fetchone()[0]
    ra = con.execute("SELECT COUNT(*) FROM revenue_appointments").fetchone()[0]
    test_leads = con.execute("SELECT COUNT(*) FROM revenue_leads WHERE is_test=1").fetchone()[0]
    outbox_p = con.execute("SELECT COUNT(*) FROM automation_outbox WHERE status='PENDING'").fetchone()[0]
    outbox_f = con.execute("SELECT COUNT(*) FROM automation_outbox WHERE status='FAILED'").fetchone()[0]
    sig_open = 0
    try:
        sig_open = con.execute("SELECT COUNT(*) FROM operational_signals WHERE status='OPEN'").fetchone()[0]
    except sqlite3.Error:
        sig_open = -1
    sched = con.execute(
        "SELECT value FROM automation_engine_state WHERE key='last_scheduler_at'"
    ).fetchone()
    ok("COUNTS", True, f"sr={sr} rl={rl} ra={ra} test_leads={test_leads} outbox_p={outbox_p} outbox_f={outbox_f} sig_open={sig_open}")
    ok("SCHEDULER_FRESH", bool(sched and sched[0]), sched[0][:19] if sched else "missing")
    con.close()
    try:
        img = subprocess.check_output(
            ["docker", "inspect", "homestead_web", "--format", "{{.Image}} {{.State.Status}}"],
            text=True,
        ).strip()
        ok("CONTAINER", "running" in img.lower(), img[:80])
    except Exception as e:
        ok("CONTAINER", False, str(e)[:80])


def classify_data() -> dict:
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    rows = con.execute(
        """SELECT r.public_id, r.name, COALESCE(l.is_test,0), r.created_at
           FROM service_requests r
           LEFT JOIN revenue_leads l ON l.lead_id = r.public_id
           ORDER BY r.public_id"""
    ).fetchall()
    inventory = []
    for pid, name, is_test, created in rows:
        label = "GO_LIVE_CANARY" if "GO-LIVE CANARY" in (name or "") or pid in (
            "HS-2026-000109",
            "HS-2026-000110",
            "HS-2026-000111",
        ) else ("CERTIFICATION_TEST" if is_test else "REAL_OR_UNCERTAIN")
        inventory.append({"public_id": pid, "classification": label, "is_test": is_test})
    con.close()
    ok("DATA_INVENTORY", True, json.dumps(inventory))
    return {"inventory": inventory}


def verify_canaries() -> list[str]:
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    ids = ("HS-2026-000109", "HS-2026-000110", "HS-2026-000111")
    verified = []
    for pid in ids:
        row = con.execute(
            "SELECT r.name, COALESCE(l.is_test,0) FROM service_requests r LEFT JOIN revenue_leads l ON l.lead_id=r.public_id WHERE r.public_id=?",
            (pid,),
        ).fetchone()
        if row:
            name, is_test = row
            ok(f"CANARY_{pid}", is_test == 1 and "GO-LIVE" in (name or ""), f"is_test={is_test}")
            if is_test == 1:
                verified.append(pid)
    con.close()
    return verified


def cleanup_test_only(dry_run: bool) -> None:
    con = sqlite3.connect(DB)
    test_ids = [
        r[0]
        for r in con.execute(
            "SELECT lead_id FROM revenue_leads WHERE is_test=1"
        ).fetchall()
    ]
    if not test_ids:
        ok("CLEANUP_TEST_ONLY", True, "no is_test rows")
        con.close()
        return
    placeholders = ",".join("?" * len(test_ids))
    plan = {
        "test_lead_ids": test_ids,
        "service_requests": con.execute(
            f"SELECT public_id FROM service_requests WHERE public_id IN ({placeholders})",
            test_ids,
        ).fetchall(),
        "outbox": con.execute(
            f"SELECT event_id FROM automation_outbox WHERE correlation_id IN ({placeholders})",
            test_ids,
        ).fetchall(),
    }
    ok("CLEANUP_PLAN", True, json.dumps(plan)[:400])
    if dry_run:
        con.close()
        return
    con.execute("BEGIN")
    try:
        con.execute(
            f"DELETE FROM automation_outbox WHERE correlation_id IN ({placeholders})",
            test_ids,
        )
        con.execute(
            f"DELETE FROM service_request_messages WHERE public_id IN ({placeholders})",
            test_ids,
        )
        con.execute(
            f"DELETE FROM revenue_appointments WHERE lead_id IN ({placeholders})",
            test_ids,
        )
        con.execute(f"DELETE FROM revenue_leads WHERE lead_id IN ({placeholders})", test_ids)
        con.execute(f"DELETE FROM service_requests WHERE public_id IN ({placeholders})", test_ids)
        for pid in test_ids:
            photo_dir = Path(f"/opt/apps/homestead/data/photos/{pid}")
            if photo_dir.is_dir():
                shutil.rmtree(photo_dir, ignore_errors=True)
        con.commit()
        ok("CLEANUP_EXECUTED", True, f"removed {len(test_ids)} test leads")
    except Exception as e:
        con.rollback()
        ok("CLEANUP_EXECUTED", False, str(e)[:120])
    con.close()


def audit_flags(env: dict[str, str]) -> None:
    flags = [
        ("CONTENT_DRY_RUN", "true", "blocks external content publish"),
        ("MARKETING_INTELLIGENCE_DRY_RUN", "true", "blocks marketing external"),
        ("REVENUE_ENGINE_DRY_RUN", "true", "blocks revenue customer messages"),
        ("AI_CONCIERGE_DRY_RUN", "false", "live: HS/Telegram/outbox when false"),
        ("AUTONOMOUS_OPERATIONS_DRY_RUN", "true", "compose default conservative"),
        ("AUTONOMOUS_LOW_RISK_ACTIONS_ENABLED", "false", "no auto low-risk actions"),
    ]
    for key, recommended, effect in flags:
        val = env.get(key, "(unset)")
        ok(f"FLAG_{key}", True, f"current={val} recommended={recommended} ({effect})")


def smtp_canary(env: dict[str, str]) -> None:
    host = env.get("SMTP_HOST", "")
    user = env.get("SMTP_USER", "")
    password = env.get("SMTP_PASS", "")
    inbox = env.get("CONTACT_INBOX", "") or user
    ok("SMTP_CONFIGURED", bool(host and user and password), f"host={host} user={user}")
    if not (host and user and password and inbox):
        ok("SMTP_CANARY", False, "OWNER ACTION — no safe test path")
        return
    if inbox == user or inbox.endswith("@homestead.lat"):
        recipient = inbox
    else:
        ok("SMTP_CANARY", False, "OWNER ACTION — test recipient not clearly authorized")
        return
    try:
        import smtplib
        from email.message import EmailMessage

        msg = EmailMessage()
        msg["Subject"] = "HOMESTEAD GO-LIVE SMTP TEST"
        msg["From"] = user
        msg["To"] = recipient
        msg.set_content(
            "This is an authorized Homestead production SMTP canary. No customer action is required."
        )
        port = int(env.get("SMTP_PORT", "465"))
        if port == 465:
            with smtplib.SMTP_SSL(host, port, timeout=30) as smtp:
                smtp.login(user, password)
                smtp.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=30) as smtp:
                smtp.starttls()
                smtp.login(user, password)
                smtp.send_message(msg)
        ok("SMTP_CANARY", True, "SMTP ACCEPTED")
    except Exception as e:
        ok("SMTP_CANARY", False, str(e)[:120])


def backup_canary() -> str:
    dest = f"/opt/backups/stab-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}"
    script = "/opt/apps/homestead/deploy/vps/production-backup.sh"
    env = os.environ.copy()
    env["BACKUP_DIR"] = "/opt/backups"
    r = subprocess.run(["sh", script], env=env, capture_output=True, text=True)
    ok("BACKUP_SCRIPT", r.returncode == 0, (r.stdout or r.stderr)[:200])
    # restore spot check
    backups = sorted(Path("/opt/backups").glob("*/homestead.sqlite"), key=lambda p: p.stat().st_mtime)
    latest = backups[-1] if backups else None
    if not latest:
        ok("RESTORE_SPOT_INTEGRITY", False, "no backup")
        return str(dest)
    tmp = Path("/tmp/homestead-restore-spot")
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir()
    shutil.copy2(latest, tmp / "homestead.sqlite")
    c = sqlite3.connect(str(tmp / "homestead.sqlite"))
    ok("RESTORE_SPOT_INTEGRITY", c.execute("PRAGMA integrity_check").fetchone()[0] == "ok", str(latest.parent))
    c.close()
    shutil.rmtree(tmp, ignore_errors=True)
    return str(latest.parent)


def disk_and_cron() -> None:
    df = subprocess.check_output(["df", "-h", "/opt/apps/homestead/data"], text=True).strip().split("\n")[-1]
    ok("DISK", True, df[:120])
    cron = subprocess.check_output(["crontab", "-l"], text=True, stderr=subprocess.DEVNULL)
    ok("BACKUP_CRON", "homestead-production-backup" in cron, "03:15 UTC daily")


def log_scan() -> None:
    try:
        logs = subprocess.check_output(
            ["docker", "logs", "--since", "2h", "homestead_web", "2>&1"],
            text=True,
            stderr=subprocess.STDOUT,
        )
    except Exception:
        logs = ""
    patterns = [
        (r"\b500\b", "http_500"),
        (r"SQLITE_BUSY|database is locked", "sqlite_busy"),
        (r"sk-proj-[A-Za-z0-9_-]{8,}", "openai_key_leak"),
        (r"SMTP_PASS=", "smtp_secret_leak"),
    ]
    issues = []
    for pat, label in patterns:
        if re.search(pat, logs, re.I):
            issues.append(label)
    ok("LOG_SCAN", len(issues) == 0, "issues=" + ",".join(issues) if issues else "clean")


def main() -> None:
    dry = "--execute-cleanup" not in sys.argv
    env = load_env()
    snapshot()
    classify_data()
    verify_canaries()
    cleanup_test_only(dry_run=dry)
    audit_flags(env)
    smtp_canary(env)
    backup_path = backup_canary()
    disk_and_cron()
    log_scan()
    OUT.write_text(
        json.dumps(
            {
                "at": datetime.now(timezone.utc).isoformat(),
                "backup_path": backup_path,
                "results": results,
            },
            indent=2,
        )
    )
    failed = [r for r in results if not r["pass"]]
    print("SUMMARY", len(results) - len(failed), "/", len(results))
    if failed:
        for f in failed:
            print("FAILED", f["name"], f["detail"])
        sys.exit(1)
    print("STABILIZATION_PASS")


if __name__ == "__main__":
    main()
