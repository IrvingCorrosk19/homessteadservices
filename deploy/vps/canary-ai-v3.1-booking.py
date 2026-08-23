#!/usr/bin/env python3
"""Minimal booking canary against loopback — test phone 60001111."""
import json, time, urllib.request, sqlite3, re

BASE = "http://127.0.0.1:3091"
PHONE = "60001111"
MARKER = "V3.1-TEST-BOOK"

class Chat:
    def __init__(self):
        self.cookie = ""
    def call(self, payload):
        body = json.dumps(payload).encode()
        req = urllib.request.Request(BASE + "/api/concierge/chat", data=body, method="POST")
        req.add_header("Content-Type", "application/json")
        req.add_header("X-Forwarded-For", "198.51.100.77")
        if self.cookie:
            req.add_header("Cookie", self.cookie)
        with urllib.request.urlopen(req, timeout=90) as res:
            sc = res.headers.get("Set-Cookie", "")
            if "hs_cid=" in sc:
                self.cookie = sc.split(";")[0]
            return json.loads(res.read().decode())
    def say(self, msg):
        d = self.call({"message": msg, "utm": {"hs_test": "1"}})
        print("USER:", msg)
        print("BOT:", (d.get("reply") or "")[:280])
        print("LEAD:", d.get("leadId"), "APPT:", d.get("appointmentId"), "CHIPS:", d.get("chips"))
        time.sleep(2)
        return d

c = Chat()
print("START", c.call({"event": "CHAT_STARTED", "utm": {"hs_test": "1"}}).get("build"))
c.say(f"Hola, necesito mantenimiento de un aire en Bella Vista. Mi número es {PHONE}. {MARKER}")
d = c.say("Quiero agendar una visita, ¿qué horarios tienes mañana?")
chips = d.get("chips") or []
# try to pick a chip if offered
slot_msg = None
if chips:
    slot_msg = chips[0]
    d2 = c.say(f"Me sirve {slot_msg}")
else:
    # ask model offered times from reply
    times = re.findall(r"\b([1-9]|1[0-2]):[0-5]\d\s*(?:a\.\s*m\.|p\.\s*m\.)", d.get("reply") or "", re.I)
    d2 = c.say("Me sirve el primero que mencionaste.")
# confirm
d3 = c.say("Sí, confirmo esa cita.")
print("FINAL_APPT", d3.get("appointmentId"), "LEAD", d3.get("leadId") or d2.get("leadId") or d.get("leadId"))
lead = d3.get("leadId") or d2.get("leadId") or d.get("leadId")
appt = d3.get("appointmentId") or d2.get("appointmentId")
con = sqlite3.connect("/opt/apps/homestead/data/homestead.sqlite")
con.row_factory = sqlite3.Row
if appt:
    row = con.execute("SELECT appointment_id, lead_id, date, start_time, status FROM appointments WHERE appointment_id=?", (appt,)).fetchone()
    print("APPT_ROW", dict(row) if row else None)
elif lead:
    row = con.execute("SELECT appointment_id, lead_id, date, start_time, status FROM appointments WHERE lead_id=? ORDER BY created_at DESC LIMIT 1", (lead,)).fetchone()
    # lead_id may be internal — try by public via join if exists
    print("APPT_BY_LEAD", dict(row) if row else None)
    rows = con.execute("SELECT appointment_id, date, start_time, status FROM appointments ORDER BY created_at DESC LIMIT 3").fetchall()
    print("RECENT_APPTS", [dict(x) for x in rows])
print("integrity", con.execute("PRAGMA integrity_check").fetchone()[0])
con.close()
