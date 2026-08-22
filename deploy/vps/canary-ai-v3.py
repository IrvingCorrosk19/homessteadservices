#!/usr/bin/env python3
"""Conversational AI V3 canary: locksmith photos + AC symptom. Test phone 60001111."""
import io
import json
import sqlite3
import time
import urllib.error
import urllib.request
from pathlib import Path

DB = "/opt/apps/homestead/data/homestead.sqlite"
ENV = "/opt/apps/homestead/deploy/vps/.env"
BASE = "http://127.0.0.1:3091"

# Minimal valid JPEG (>=12 bytes) for sniffImage.
JPEG = (
    b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
    b"\xff\xdb\x00C\x00" + (b"\x08" * 64)
    + b"\xff\xc0\x00\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00"
    + b"\xff\xd9"
)


def env_map():
    values = {}
    for line in Path(ENV).read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        values[key.strip()] = val.strip().strip('"')
    return values


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
        print("BOT:", data.get("reply"))
        print("LEAD:", data.get("leadId"), "APPT:", data.get("appointmentId"), "next:", data.get("nextAction"))
        print("CHIPS:", data.get("chips"))
        print("---")
        time.sleep(0.3)
        return data

    def photo(self):
        boundary = "----HsV3Canary"
        filename = "lock-test.jpg"
        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="photo"; filename="{filename}"\r\n'
            "Content-Type: image/jpeg\r\n\r\n"
        ).encode() + JPEG + f"\r\n--{boundary}--\r\n".encode()
        req = urllib.request.Request(BASE + "/api/concierge/photo", data=body, method="POST")
        req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
        if self.cookie:
            req.add_header("Cookie", self.cookie)
        with urllib.request.urlopen(req, timeout=30) as res:
            data = json.loads(res.read().decode())
        print("PHOTO_OK", data)
        time.sleep(0.2)
        return data


def main():
    values = env_map()
    print("DRY_RUN", values.get("AI_CONCIERGE_DRY_RUN"))
    print("CREATE_LEADS", values.get("AI_CONCIERGE_CREATE_LEADS") or "<empty>")
    chat = Chat()
    chat.call({"event": "CHAT_STARTED"})
    lock = chat.say("Hola, necesito cambiar la cerradura de mi puerta.")
    chat.photo()
    chat.say("Te envié una foto de la puerta. V3-TEST")
    last = chat.say("Soy Canario V3, estoy en San Francisco, mi numero es 60001111. V3-TEST")
    lock_lead = last.get("leadId") or lock.get("leadId")
    print("LOCK_LEAD", lock_lead)

    ac = Chat()
    ac.call({"event": "CHAT_STARTED"})
    air = ac.say("Mi aire no enfría.")
    print("AC_REPLY_DIFFERS", (lock.get("reply") or "") != (air.get("reply") or ""))

    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    if lock_lead:
        row = con.execute(
            "SELECT public_id, service, message, photos_json, facts_json FROM service_requests WHERE public_id=?",
            (lock_lead,),
        ).fetchone()
        print("HS_ROW", dict(row) if row else None)
        photos = json.loads(row["photos_json"] if row else "[]")
        print("PHOTO_COUNT", len(photos))
        outbox = con.execute(
            "SELECT event_type, status FROM automation_outbox WHERE correlation_id=? ORDER BY created_at DESC LIMIT 5",
            (lock_lead,),
        ).fetchall()
        print("OUTBOX", [dict(item) for item in outbox])
    con.close()


if __name__ == "__main__":
    main()
