#!/usr/bin/env python3
"""Conversational AI V3.1 Human Excellence live matrix. Test phone 60001111."""
import io
import json
import sqlite3
import time
import urllib.request
from pathlib import Path

DB = "/opt/apps/homestead/data/homestead.sqlite"
ENV = "/opt/apps/homestead/deploy/vps/.env"
BASE = "http://127.0.0.1:3091"
MARKER = "V3.1-TEST"

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
    def __init__(self, label):
        self.label = label
        self.cookie = ""
        self.replies = []

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
            return json.loads(res.read().decode())

    def say(self, message):
        data = self.call({"message": message})
        reply = data.get("reply") or ""
        self.replies.append(reply)
        print(f"[{self.label}] USER:", message)
        print(f"[{self.label}] BOT:", reply[:220])
        print(f"[{self.label}] LEAD:", data.get("leadId"))
        time.sleep(0.35)
        return data

    def photo(self):
        boundary = "----HsV31Canary"
        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="photo"; filename="v31.jpg"\r\n'
            "Content-Type: image/jpeg\r\n\r\n"
        ).encode() + JPEG + f"\r\n--{boundary}--\r\n".encode()
        req = urllib.request.Request(BASE + "/api/concierge/photo", data=body, method="POST")
        req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
        if self.cookie:
            req.add_header("Cookie", self.cookie)
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.loads(res.read().decode())


def assert_lead(data, name):
    lead = data.get("leadId")
    print(f"ASSERT {name} lead={lead}")
    return lead


def main():
    print("ENV", {k: env_map().get(k) for k in ("AI_CONCIERGE_DRY_RUN", "AI_CONCIERGE_CREATE_LEADS")})

    lock = Chat("LOCKSMITH")
    lock.call({"event": "CHAT_STARTED"})
    lock.say("Hola, necesito cambiar la cerradura de mi puerta.")
    lock.photo()
    lock.say("Te envié una foto de la puerta.")
    lock_lead = assert_lead(
        lock.say(f"Estoy en San Francisco y me pueden llamar al 60001111. {MARKER}"),
        "locksmith",
    )

    ac = Chat("AC")
    ac.call({"event": "CHAT_STARTED"})
    ac.say("Mi aire no enfría, son dos equipos y estoy en Bella Vista.")
    ac_lead = assert_lead(ac.say(f"Mi número es 60001111. {MARKER}"), "ac")

    packed = Chat("PACKED")
    packed.call({"event": "CHAT_STARTED"})
    packed_lead = assert_lead(
        packed.say(
            f"Hola soy Ana, estoy en Obarrio, mi aire está botando agua desde ayer, "
            f"es un split y mi número es 60001111. {MARKER}"
        ),
        "packed",
    )

    plumb = Chat("PLUMBING")
    plumb.call({"event": "CHAT_STARTED"})
    plumb.say("Se me está saliendo agua debajo del fregador.")
    plumb_lead = assert_lead(plumb.say(f"Estoy en Condado del Rey, teléfono 60001111. {MARKER}"), "plumbing")

    elec = Chat("ELECTRICAL")
    elec.call({"event": "CHAT_STARTED"})
    elec.say("Un tomacorriente está echando chispas y huele a quemado.")
    elec_lead = assert_lead(elec.say(f"Zona El Cangrejo, 60001111. {MARKER}"), "electrical_safety")

    paint = Chat("PAINTING")
    paint.call({"event": "CHAT_STARTED"})
    paint.say("Quiero pintar la sala y tengo fotos.")
    paint.photo()
    paint_lead = assert_lead(paint.say(f"Bella Vista, 60001111. {MARKER}"), "painting")

    unknown = Chat("UNKNOWN")
    unknown.call({"event": "CHAT_STARTED"})
    u1 = unknown.say("Necesito reparar un portón eléctrico.")
    unknown_lead = assert_lead(unknown.say(f"Está atascado, zona Obarrio, 60001111. {MARKER}"), "unknown")
    print("UNKNOWN_NO_FALSE_PROMISE", "seguro" not in (u1.get("reply") or "").lower())

    multi = Chat("MULTI")
    multi.call({"event": "CHAT_STARTED"})
    multi.say("Necesito mantenimiento de dos aires y cambiar la cerradura principal.")
    multi_lead = assert_lead(multi.say(f"El Cangrejo, 60001111. {MARKER}"), "multi")

    human = Chat("HUMAN")
    human.call({"event": "CHAT_STARTED"})
    human.say("Quiero hablar con una persona.")
    human_lead = assert_lead(human.say(f"60001111 Bella Vista. {MARKER}"), "human")

    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    for label, lead in [
        ("lock", lock_lead),
        ("ac", ac_lead),
        ("packed", packed_lead),
        ("plumb", plumb_lead),
        ("elec", elec_lead),
        ("paint", paint_lead),
        ("unknown", unknown_lead),
        ("multi", multi_lead),
        ("human", human_lead),
    ]:
        if not lead:
            print("MISSING_LEAD", label)
            continue
        row = con.execute(
            "SELECT public_id, service, photos_json, facts_json FROM service_requests WHERE public_id=?",
            (lead,),
        ).fetchone()
        print("HS", label, dict(row) if row else None)
    con.close()


if __name__ == "__main__":
    main()
