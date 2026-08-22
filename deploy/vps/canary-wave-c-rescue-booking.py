#!/usr/bin/env python3
"""Wave B gate: live Rescue → client resumes → booking. is_test via 60001111 + WAVE-C-TEST."""
import json
import sqlite3
import time
import urllib.error
import urllib.request
from pathlib import Path

DB = "/opt/apps/homestead/data/homestead.sqlite"
ENV = "/opt/apps/homestead/deploy/vps/.env"
BASE = "http://127.0.0.1:3091"


def env_map():
    values = {}
    for line in Path(ENV).read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        values[key.strip()] = val.strip().strip('"')
    return values


def headers(secret):
    return {
        "Content-Type": "application/json",
        "X-Homestead-Timestamp": str(int(time.time())),
        "X-Homestead-Webhook-Secret": secret,
    }


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


class Chat:
    def __init__(self):
        self.cookie = ""

    def call(self, payload, method="POST"):
        body = json.dumps(payload).encode() if method == "POST" else None
        req = urllib.request.Request(BASE + "/api/concierge/chat", data=body, method=method)
        if method == "POST":
            req.add_header("Content-Type", "application/json")
        if self.cookie:
            req.add_header("Cookie", self.cookie)
        with urllib.request.urlopen(req, timeout=60) as res:
            set_cookie = res.headers.get("Set-Cookie", "")
            if "hs_cid=" in set_cookie:
                self.cookie = set_cookie.split(";")[0]
            return res.status, json.loads(res.read().decode())

    def say(self, message):
        status, data = self.call({"message": message})
        print("USER:", message)
        print("BOT:", (data.get("reply") or "")[:400])
        print("LEAD:", data.get("leadId"), "APPT:", data.get("appointmentId"), "next:", data.get("nextAction"))
        print("---")
        time.sleep(0.4)
        return data


def report(name, ok, detail=""):
    print(f"{name}: {'PASS' if ok else 'FAIL'} {detail}".strip())
    return 0 if ok else 1


def main():
    values = env_map()
    dry = (values.get("AI_CONCIERGE_DRY_RUN") or "").lower()
    print("DRY_RUN", dry)
    failed = 0
    failed += report("DRY_RUN_OFF", dry in ("false", "0", "no", ""), dry)
    secret = values.get("N8N_HOMESTEAD_WEBHOOK_SECRET") or ""
    marker = f"WAVE-C-TEST rescue {int(time.time())}"
    chat = Chat()
    chat.call({"event": "CHAT_STARTED"})
    chat.say("hola")
    chat.say("mi aire no enfria y esta botando agua, necesito que vengan a revisarlo")
    last = chat.say(f"Soy Carlos, Bella Vista, mi numero es 60001111. {marker}")
    lead_id = last.get("leadId") or ""
    failed += report("LEAD_CREATED", str(lead_id).startswith("HS-"), str(lead_id))
    failed += report("NOT_BOOKED_YET", not last.get("appointmentId"), str(last.get("appointmentId")))

    past = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(time.time() - 20 * 60))
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    if lead_id:
        con.execute(
            "UPDATE revenue_leads SET is_test=1, updated_at=?, created_at=COALESCE(created_at,?), lead_created_at=COALESCE(lead_created_at,?) WHERE lead_id=?",
            (past, past, past, lead_id),
        )
        con.execute("UPDATE concierge_messages SET created_at=? WHERE conversation_id IN (SELECT conversation_id FROM revenue_leads WHERE lead_id=?)", (past, lead_id))
        con.execute("UPDATE service_requests SET created_at=?, updated_at=? WHERE public_id=?", (past, past, lead_id))
        con.commit()
    row = con.execute(
        "SELECT lead_id, is_test, rescue_alerted_at, rescued_to_booking, first_human_action_at FROM revenue_leads WHERE lead_id=?",
        (lead_id,),
    ).fetchone()
    print("LEAD_ROW", dict(row) if row else None)
    con.close()
    failed += report("IS_TEST", bool(row and row["is_test"] == 1))

    tick = post("/api/internal/ops/action", {"action": "tick"}, headers(secret))
    print("TICK", tick[0], {k: tick[1].get(k) for k in ("ok", "ops", "drain") if isinstance(tick[1], dict)})
    failed += report("OPS_TICK", tick[0] == 200 and tick[1].get("ok") is True)

    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    after = con.execute(
        "SELECT rescue_alerted_at, rescue_cycle FROM revenue_leads WHERE lead_id=?",
        (lead_id,),
    ).fetchone()
    outbox = con.execute(
        "SELECT event_id, event_type, status FROM automation_outbox WHERE correlation_id=? AND event_type LIKE 'lead.rescue%' ORDER BY created_at DESC LIMIT 3",
        (lead_id,),
    ).fetchall()
    print("RESCUE_ALERTED", dict(after) if after else None)
    print("RESCUE_OUTBOX", [dict(item) for item in outbox])
    failed += report("RESCUE_ELIGIBLE", bool(after and after["rescue_alerted_at"]), str(after))
    con.close()

    booked = chat.say("Pueden venir el lunes a las 11 de la manana?")
    if not booked.get("appointmentId"):
        booked = chat.say("Si, confirma esa visita por favor.")
    appt = booked.get("appointmentId") or ""
    failed += report("BOOKING_HA", str(appt).startswith("HA-"), str(appt))

    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    lead = con.execute(
        "SELECT lead_id, rescued_to_booking, is_test FROM revenue_leads WHERE lead_id=?",
        (lead_id,),
    ).fetchone()
    request = con.execute("SELECT public_id, service FROM service_requests WHERE public_id=?", (lead_id,)).fetchone()
    appointment = con.execute(
        "SELECT appointment_id, lead_id, date, start_time, status FROM revenue_appointments WHERE appointment_id=?",
        (appt,),
    ).fetchone()
    event = con.execute(
        "SELECT event FROM revenue_events WHERE lead_id=? AND event='LEAD_RESCUE_BOOKED' LIMIT 1",
        (lead_id,),
    ).fetchone()
    print("FINAL_LEAD", dict(lead) if lead else None)
    print("FINAL_REQUEST", dict(request) if request else None)
    print("FINAL_APPT", dict(appointment) if appointment else None)
    print("RESCUED_EVENT", dict(event) if event else None)
    failed += report("HS_PERSISTED", bool(request and str(request["public_id"]).startswith("HS-")))
    failed += report("HA_PERSISTED", bool(appointment and appointment["appointment_id"] == appt))
    failed += report("CALENDAR_STATUS", bool(appointment and appointment["status"] in ("REQUESTED", "PROPOSED", "CONFIRMED", "RESCHEDULED")))
    failed += report("RESCUED_TO_BOOKING", bool(lead and lead["rescued_to_booking"] == 1))
    failed += report("LEAD_RESCUE_BOOKED_EVENT", bool(event))
    con.close()

    print("FAILED_COUNT", failed)
    raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    main()
