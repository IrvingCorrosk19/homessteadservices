#!/usr/bin/env python3
import json
import sqlite3
import time
import urllib.request
from pathlib import Path

ENV = "/opt/apps/homestead/deploy/vps/.env"
values = {}
for line in Path(ENV).read_text(encoding="utf-8").splitlines():
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, val = line.split("=", 1)
    values[key.strip()] = val.strip().strip('"')
secret = values.get("N8N_HOMESTEAD_WEBHOOK_SECRET") or ""
payload = json.dumps({"action": "tick"}).encode()
req = urllib.request.Request(
    "http://127.0.0.1:3091/api/internal/ops/action",
    data=payload,
    method="POST",
    headers={
        "Content-Type": "application/json",
        "X-Homestead-Timestamp": str(int(time.time())),
        "X-Homestead-Webhook-Secret": secret,
    },
)
with urllib.request.urlopen(req, timeout=40) as res:
    print("WARM_TICK", res.status)

c = sqlite3.connect("/opt/apps/homestead/data/homestead.sqlite")
print("SQLITE_INTEGRITY", c.execute("PRAGMA integrity_check").fetchone()[0])
cols = [r[1] for r in c.execute("PRAGMA table_info(revenue_jobs)").fetchall()]
print("HAS_IS_TEST", "is_test" in cols)
print("HAS_FOLLOWUP", "followup_status" in cols)
tables = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
print("HAS_JOB_PHOTOS", "job_photos" in tables)
print("HAS_FEEDBACK", "job_feedback_tokens" in tables)
print("JOBS", c.execute("SELECT COUNT(*) FROM revenue_jobs").fetchone()[0])
c.close()
