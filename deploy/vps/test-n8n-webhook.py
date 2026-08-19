#!/usr/bin/env python3
import json
import hmac
import hashlib
import time
import urllib.request
import urllib.error
from pathlib import Path

def env_file(path):
    values = {}
    for line in Path(path).read_text().splitlines():
        if not line.strip() or line.strip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'").replace("$$", "$")
    return values

def canonical(value):
    if value is None or not isinstance(value, (dict, list)):
        return json.dumps(value, separators=(",", ":"))
    if isinstance(value, list):
        return "[" + ",".join(canonical(item) for item in value) + "]"
    keys = sorted(value.keys())
    return "{" + ",".join(json.dumps(key) + ":" + canonical(value[key]) for key in keys) + "}"

def sign(secret, timestamp, payload):
    body = canonical(payload)
    return hmac.new(secret.encode(), f"{timestamp}.{body}".encode(), hashlib.sha256).hexdigest()

def post(url, payload, headers):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json", **headers}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            return res.status, res.read().decode()
    except urllib.error.HTTPError as err:
        return err.code, err.read().decode()

hs = env_file("/opt/apps/homestead/deploy/vps/.env")
secret = hs.get("N8N_HOMESTEAD_WEBHOOK_SECRET", "")
url = "http://127.0.0.1:8083/webhook/homestead-service-request"
payload = {
    "event": "service_request.created",
    "requestId": "HS-2099-000042",
    "createdAt": "2026-08-19T03:00:00.000Z",
    "customer": {"name": "Prueba", "phone": "60000000", "email": "a@b.co"},
    "service": {"slug": "plumbing", "type": "Plomería", "property": "Casa", "description": "Prueba webhook."},
    "photos": {"count": 0, "items": []},
    "actions": {"contactWhatsApp": "https://wa.me/50760000000"},
}

results = []
status, body = post(url, payload, {"X-Homestead-Timestamp": str(int(time.time())), "X-Homestead-Signature": "sha256=ab"})
results.append(("UNAUTHORIZED", status in (401, 403), status, body[:180]))

ts = str(int(time.time()))
bad = {"event": "nope"}
status, body = post(
    url,
    bad,
    {
        "X-Homestead-Timestamp": ts,
        "X-Homestead-Signature": "sha256=" + sign(secret, ts, bad),
        "X-Homestead-Webhook-Secret": secret,
    },
)
results.append(("MALFORMED", status == 400, status, body[:180]))

ts = str(int(time.time()))
sig = sign(secret, ts, payload)
headers = {
    "X-Homestead-Timestamp": ts,
    "X-Homestead-Signature": "sha256=" + sig,
    "X-Homestead-Webhook-Secret": secret,
}
status1, body1 = post(url, payload, headers)
status2, body2 = post(url, payload, headers)
dup = "duplicate" in body2
results.append(("IDEMPOTENT_FIRST", status1 == 200, status1, body1[:180]))
results.append(("IDEMPOTENT_SECOND", status2 == 200 and dup, status2, body2[:180]))

for name, ok, status, body in results:
    print(("PASS" if ok else "FAIL"), name, status, body.replace("\n", " "))
