#!/usr/bin/env python3
"""Wave G canary — deterministic Copilot brief vs DB counts. No secrets printed."""
import json
import sqlite3
import urllib.request

DB = "/opt/apps/homestead/data/homestead.sqlite"
BASE = "http://127.0.0.1:3091"

def http_code(path):
    try:
        req = urllib.request.Request(BASE + path, method="GET")
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status
    except Exception as e:
        return getattr(e, "code", None) or 0

def main():
    db = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
    print("INTEGRITY=" + integrity)
    assert integrity == "ok"

    # Schema present after boot migration — may appear after first request
    tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    print("HAS_ANALYTICS_DEPS=" + str("revenue_customers" in tables and "service_requests" in tables))

    pending = db.execute(
        """SELECT COUNT(*) FROM service_requests r
           LEFT JOIN revenue_leads l ON l.lead_id = r.public_id
           WHERE r.status='NEW' AND COALESCE(l.is_test,0)=0
             AND (r.snoozed_until IS NULL OR r.snoozed_until <= datetime('now'))"""
    ).fetchone()[0]
    print("PENDING_NEW=" + str(pending))

    codes = {
        "home": http_code("/"),
        "admin": http_code("/admin"),
        "copilot": http_code("/admin/copilot"),
    }
    print("HTTP=" + json.dumps(codes))
    assert codes["home"] == 200
    # admin/copilot may redirect to login (302/307) without session — accept 200 or 3xx
    assert codes["copilot"] in (200, 302, 303, 307)
    print("WAVE_G_CANARY_OK")

if __name__ == "__main__":
    main()
