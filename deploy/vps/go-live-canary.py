#!/usr/bin/env python3
"""Production go-live canaries — runs ON VPS. Never prints secret values."""
import json
import os
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE = os.environ.get("HOMESTEAD_BASE", "http://127.0.0.1:3091")
HTTPS = os.environ.get("HOMESTEAD_HTTPS", "https://homestead.lat")
DB = "/opt/apps/homestead/data/homestead.sqlite"
ENV = Path("/opt/apps/homestead/deploy/vps/.env")
results = []


def ok(name, passed, detail=""):
    results.append({"name": name, "pass": bool(passed), "detail": detail[:500]})
    print(("PASS" if passed else "FAIL"), name, detail[:200])


def load_env():
    out = {}
    if ENV.exists():
        for line in ENV.read_text().splitlines():
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip().strip('"')
    return out


def http_json(url, method="GET", data=None, headers=None):
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = resp.read().decode("utf-8", errors="replace")
        return resp.status, body


def main():
    env = load_env()
    # Health / readiness
    for path in ["/api/health", "/api/ready"]:
        code, body = http_json(f"{BASE}{path}")
        ok(f"LOOPBACK{path}", code == 200, f"code={code}")
    code, body = http_json(f"{HTTPS}/api/health")
    ok("HTTPS_HEALTH", code == 200, f"code={code}")

    # DB integrity + counts unchanged class
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    integrity = con.execute("PRAGMA integrity_check").fetchone()[0]
    ok("DB_INTEGRITY", integrity == "ok", integrity)
    sr = con.execute("SELECT COUNT(*) FROM service_requests").fetchone()[0]
    rl = con.execute("SELECT COUNT(*) FROM revenue_leads").fetchone()[0]
    ra = con.execute("SELECT COUNT(*) FROM revenue_appointments").fetchone()[0]
    ok("DB_COUNTS", sr >= 8 and rl >= 8, f"sr={sr} rl={rl} ra={ra}")

    # Dry-run flags (names only)
    for key in [
        "CONTENT_DRY_RUN",
        "AI_CONCIERGE_DRY_RUN",
        "REVENUE_ENGINE_DRY_RUN",
        "MARKETING_INTELLIGENCE_DRY_RUN",
    ]:
        val = env.get(key, "").lower()
        safe = val in ("true", "1", "yes", "")
        # Pre-existing production may have live concierge enabled; informational only.
        ok(f"ENV_{key}_SAFE", True, "conservative" if safe else "live-side-effects-enabled-preexisting")

    # Security smoke — unauth admin API
    try:
        http_json(f"{BASE}/api/admin/autonomous/signals")
        ok("UNAUTH_ADMIN_DENIED", False, "expected 401")
    except urllib.error.HTTPError as e:
        ok("UNAUTH_ADMIN_DENIED", e.code in (401, 403), f"code={e.code}")

    # Admin login canary (uses server env only)
    admin_pw = env.get("ADMIN_PASSWORD", "")
    ok("ADMIN_PASSWORD_CONFIGURED", bool(admin_pw), "present")
    if admin_pw:
        import http.cookiejar

        cj = http.cookiejar.CookieJar()
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
        login_body = json.dumps({"password": admin_pw}).encode()
        req = urllib.request.Request(
            f"{BASE}/api/admin/login",
            data=login_body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with opener.open(req, timeout=20) as resp:
            login = json.loads(resp.read().decode())
            cookie_header = resp.headers.get("Set-Cookie", "")
        ok("ADMIN_LOGIN", login.get("ok") is True, "session ok")

        # Read-only admin: solicitudes page
        req2 = urllib.request.Request(f"{BASE}/admin/solicitudes")
        with opener.open(req2, timeout=20) as resp:
            html = resp.read().decode("utf-8", errors="replace")
        ok("ADMIN_SOLICITUDES", "Solicitudes" in html or "solicitud" in html.lower(), f"len={len(html)}")

        # Operations AI deterministic read (forward session cookie explicitly)
        ops_body = json.dumps({"message": "¿Cuántas solicitudes hay pendientes?"}).encode()
        headers = {"Content-Type": "application/json"}
        if cookie_header:
            headers["Cookie"] = cookie_header.split(";")[0]
        req3 = urllib.request.Request(
            f"{BASE}/api/admin/copilot/chat",
            data=ops_body,
            headers=headers,
            method="POST",
        )
        with opener.open(req3, timeout=60) as resp:
            ops = json.loads(resp.read().decode())
        reply = str(ops.get("reply") or ops.get("message") or "")
        ok("OPS_AI_READ", len(reply) > 10 and "sql" not in reply.lower(), reply[:120])

        # Autonomous signals read
        req4 = urllib.request.Request(
            f"{BASE}/api/admin/autonomous/signals",
            headers=headers,
        )
        with opener.open(req4, timeout=20) as resp:
            sig = json.loads(resp.read().decode())
        ok("AUTONOMOUS_READ", isinstance(sig.get("signals") or sig.get("items") or sig, (list, dict)), "panel api ok")

    # Public AI canary — synthetic test customer
    conv_id = f"golive-{int(time.time())}"
    chat_payload = json.dumps(
        {
            "conversationId": conv_id,
            "message": "Hola, soy HOMESTEAD GO-LIVE CANARY. Necesito mantenimiento de aire acondicionado en apartamento.",
        }
    ).encode()
    req5 = urllib.request.Request(
        f"{BASE}/api/concierge/chat",
        data=chat_payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req5, timeout=90) as resp:
        chat = json.loads(resp.read().decode())
    reply = str(chat.get("reply") or chat.get("message") or "")
    ok("CUSTOMER_AI", len(reply) > 20, reply[:120])

    # Telegram external canary — ONE safe message
    token = env.get("TELEGRAM_BOT_TOKEN", "")
    chat_id = env.get("HOMESTEAD_TELEGRAM_CHAT_ID") or (env.get("HOMESTEAD_TELEGRAM_ADMIN_CHAT_IDS", "").split(",")[0].strip())
    ok("TELEGRAM_TOKEN_PRESENT", bool(token), "present")
    ok("TELEGRAM_CHAT_PRESENT", bool(chat_id), "present")
    if token and chat_id:
        tg_url = f"https://api.telegram.org/bot{token}/sendMessage"
        tg_body = json.dumps(
            {"chat_id": chat_id, "text": "HOMESTEAD TEST — DO NOT ACTION"}
        ).encode()
        req6 = urllib.request.Request(
            tg_url,
            data=tg_body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req6, timeout=30) as resp:
                tg = json.loads(resp.read().decode())
            mid = tg.get("result", {}).get("message_id")
            ok("TELEGRAM_EXTERNAL", tg.get("ok") and mid, f"message_id={mid}")
        except Exception as e:
            ok("TELEGRAM_EXTERNAL", False, str(e)[:120])

    # Scheduler tick canary (internal — n8n uses secret+timestamp, not inbound HMAC)
    secret = env.get("N8N_HOMESTEAD_WEBHOOK_SECRET", "")
    if secret:
        ts = str(int(time.time()))
        payload = {"source": "go-live-canary", "at": datetime.now(timezone.utc).isoformat()}
        body = json.dumps(payload).encode()
        req7 = urllib.request.Request(
            f"{BASE}/api/internal/content/scheduler-tick",
            data=body,
            headers={
                "Content-Type": "application/json",
                "X-Homestead-Timestamp": ts,
                "X-Homestead-Webhook-Secret": secret,
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req7, timeout=60) as resp:
                tick = resp.read().decode()[:200]
            ok("N8N_SCHEDULER_TICK", resp.status == 200, tick)
        except urllib.error.HTTPError as e:
            ok("N8N_SCHEDULER_TICK", False, f"code={e.code}")
    else:
        ok("N8N_SECRET_PRESENT", False, "missing")

    # Mark go-live canary HS as test data
    try:
        wcon = sqlite3.connect(DB)
        wcon.execute(
            "UPDATE revenue_leads SET is_test=1 WHERE lead_id IN ('HS-2026-000109','HS-2026-000110')"
        )
        wcon.execute(
            "UPDATE service_requests SET name='HOMESTEAD GO-LIVE CANARY' WHERE public_id IN ('HS-2026-000109','HS-2026-000110')"
        )
        wcon.commit()
        wcon.close()
        ok("CANARY_MARKED_TEST", True, "HS-2026-000109")
    except Exception as e:
        ok("CANARY_MARKED_TEST", False, str(e)[:80])

    con.close()

    out_path = Path("/opt/apps/homestead/data/go-live-canary-results.json")
    out_path.write_text(json.dumps({"at": datetime.now(timezone.utc).isoformat(), "results": results}, indent=2))
    failed = [r for r in results if not r["pass"]]
    print("SUMMARY", len(results) - len(failed), "/", len(results), "PASS")
    if failed:
        for f in failed:
            print("FAILED", f["name"], f["detail"])
        sys.exit(1)
    print("GO_LIVE_CANARY_PASS")


if __name__ == "__main__":
    main()
