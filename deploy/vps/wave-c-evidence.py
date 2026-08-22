#!/usr/bin/env python3
"""Post-deploy evidence for Wave C. Does not print secrets."""
import json
import sqlite3
import subprocess
import urllib.error
import urllib.request
from pathlib import Path

DB = "/opt/apps/homestead/data/homestead.sqlite"
ENV = "/opt/apps/homestead/deploy/vps/.env"


def http_code(url):
    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=20) as res:
            return res.status
    except urllib.error.HTTPError as err:
        return err.code
    except Exception as exc:
        return str(exc)


def env_map():
    values = {}
    for line in Path(ENV).read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        values[key.strip()] = val.strip().strip('"')
    return values


print("LOOPBACK", http_code("http://127.0.0.1:3091/"))
print("HOMESTEAD", http_code("https://homestead.lat/"))
print("N8N_HEALTHZ", http_code("https://n8n.autonomousflow.lat/healthz"))
print("EXPERIENCIA", http_code("http://127.0.0.1:3091/experiencia/no-disponible"))
print("ADMIN_TRABAJOS", http_code("http://127.0.0.1:3091/admin/trabajos"))

values = env_map()
token = values.get("TELEGRAM_BOT_TOKEN") or ""
expected = "https://n8n.autonomousflow.lat/webhook/homestead-content-studio"
req = urllib.request.Request(f"https://api.telegram.org/bot{token}/getWebhookInfo")
with urllib.request.urlopen(req, timeout=20) as res:
    data = json.loads(res.read().decode())
result = data.get("result") or {}
url = result.get("url") or ""
print("webhook_url", url)
print("webhook_match", url == expected)
print("pending", result.get("pending_update_count"))
print("last_error", result.get("last_error_message"))
print("last_error_date", result.get("last_error_date"))
review = (values.get("HOMESTEAD_REVIEW_URL") or "").strip()
print("REVIEW_URL_SET", "yes" if review.startswith("https://") else "no")
print("AI_CONCIERGE_DRY_RUN", values.get("AI_CONCIERGE_DRY_RUN"))
print("AUTOMATION_N8N_FAIL", values.get("AUTOMATION_N8N_FAIL"))

c = sqlite3.connect(DB)
c.row_factory = sqlite3.Row
print("SQLITE_INTEGRITY", c.execute("PRAGMA integrity_check").fetchone()[0])
print("JOBS_TOTAL", c.execute("SELECT COUNT(*) FROM revenue_jobs").fetchone()[0])
print("JOBS_TEST", c.execute("SELECT COUNT(*) FROM revenue_jobs WHERE is_test=1").fetchone()[0])
print("JOBS_COMPLETED_TEST", c.execute("SELECT COUNT(*) FROM revenue_jobs WHERE is_test=1 AND status='COMPLETED'").fetchone()[0])
print("JOB_PHOTOS", c.execute("SELECT COUNT(*) FROM job_photos").fetchone()[0])
print("FEEDBACK_TOKENS", c.execute("SELECT COUNT(*) FROM job_feedback_tokens").fetchone()[0])
print("RECOVERY_OPEN", c.execute("SELECT COUNT(*) FROM revenue_jobs WHERE recovery_status='OPEN'").fetchone()[0])
print("OUTBOX_JOB_COMPLETED", c.execute("SELECT COUNT(*) FROM automation_outbox WHERE event_type='job.completed'").fetchone()[0])
print("OUTBOX_FOLLOWUP", c.execute("SELECT COUNT(*) FROM automation_outbox WHERE event_type='post_service.followup_due'").fetchone()[0])
print("OUTBOX_RECOVERY", c.execute("SELECT COUNT(*) FROM automation_outbox WHERE event_type='customer.service_recovery_requested'").fetchone()[0])
print("OUTBOX_FAILED", c.execute("SELECT COUNT(*) FROM automation_outbox WHERE status='FAILED'").fetchone()[0])
print("RESCUED_BOOKING", c.execute("SELECT lead_id FROM revenue_leads WHERE rescued_to_booking=1 ORDER BY updated_at DESC LIMIT 1").fetchone())
print("HA_RESCUE", c.execute("SELECT appointment_id, lead_id, date, start_time, status FROM revenue_appointments WHERE appointment_id LIKE 'HA-%' ORDER BY created_at DESC LIMIT 3").fetchall())
c.close()

ps = subprocess.run(
    ["docker", "ps", "--filter", "name=homestead_web", "--format", "{{.Names}} {{.Status}} {{.Ports}}"],
    capture_output=True,
    text=True,
    check=False,
)
print("DOCKER", ps.stdout.strip())
logs = subprocess.run(
    ["docker", "logs", "--tail", "80", "homestead_web"],
    capture_output=True,
    text=True,
    check=False,
)
blob = (logs.stdout or "") + (logs.stderr or "")
bad = [line for line in blob.splitlines() if any(k in line.lower() for k in ("error", "fatal", "unhandled", "econnrefused"))]
print("LOG_ERROR_LINES", len(bad))
for line in bad[-12:]:
    print("LOG", line[:240])

n8n = subprocess.run(
    [
        "docker",
        "exec",
        "n8n_postgres",
        "psql",
        "-U",
        "n8nuser",
        "-d",
        "n8n",
        "-t",
        "-A",
        "-F",
        "|",
        "-c",
        "SELECT name, active FROM workflow_entity WHERE name LIKE 'HOMESTEAD%' ORDER BY name;",
    ],
    capture_output=True,
    text=True,
    check=False,
)
print("N8N_HS_WORKFLOWS")
print((n8n.stdout or n8n.stderr or "").strip())
count = subprocess.run(
    [
        "docker",
        "exec",
        "n8n_postgres",
        "psql",
        "-U",
        "n8nuser",
        "-d",
        "n8n",
        "-t",
        "-A",
        "-c",
        "SELECT COUNT(*) FROM workflow_entity;",
    ],
    capture_output=True,
    text=True,
    check=False,
)
print("N8N_WORKFLOW_COUNT", (count.stdout or "").strip())
