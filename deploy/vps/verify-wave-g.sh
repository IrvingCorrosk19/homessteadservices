#!/bin/bash
set -e
docker exec homestead_web node <<'NODE'
const Database = require("better-sqlite3");
const db = new Database("/app/data/homestead.sqlite");
console.log("INTEGRITY=" + db.pragma("integrity_check", { simple: true }));
NODE
python3 /opt/apps/homestead/deploy/vps/canary-wave-g.py
curl -sS -o /dev/null -w "home:%{http_code}\n" https://homestead.lat/
curl -sS -o /dev/null -w "n8n:%{http_code}\n" https://n8n.autonomousflow.lat/healthz
echo VERIFY_OK
