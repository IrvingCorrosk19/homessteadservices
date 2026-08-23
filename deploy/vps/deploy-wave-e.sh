#!/bin/bash
set -euo pipefail
tar -xzf /tmp/homestead-deploy.tar.gz -C /opt/apps/homestead
rm -f /tmp/homestead-deploy.tar.gz
test -f /opt/apps/homestead/src/lib/retention-engine.ts
test -f /opt/apps/homestead/src/app/admin/retencion/page.tsx
cd /opt/apps/homestead/deploy/vps
export NEXT_PUBLIC_SITE_URL=https://homestead.lat
docker compose --project-name homestead build homestead_web
docker compose --project-name homestead up -d homestead_web
sleep 8
curl -sS -o /dev/null -w "loopback:%{http_code}\n" http://127.0.0.1:3091/
curl -sS -o /dev/null -w "lat:%{http_code}\n" https://homestead.lat/ || true
curl -sS -o /dev/null -w "n8n:%{http_code}\n" https://n8n.autonomousflow.lat/healthz || true
curl -sS -o /dev/null -w "retencion:%{http_code}\n" http://127.0.0.1:3091/admin/retencion || true
docker exec homestead_web node -e 'const Database=require("better-sqlite3"); const db=new Database("/app/data/homestead.sqlite"); console.log("INTEGRITY="+db.pragma("integrity_check",{simple:true}));'
echo DEPLOY_OK
