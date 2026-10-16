#!/bin/sh
# Rollback Concierge to legacy engine without restoring SQLite over live data.
# Usage: CONFIRM=YES sh deploy/vps/rollback-concierge-n8n-engine.sh
set -eu

if [ "${CONFIRM:-}" != "YES" ]; then
  echo "Refusing: set CONFIRM=YES to flip AI_CONCIERGE_ENGINE=legacy and recreate homestead_web only."
  exit 1
fi

ENV_FILE=/opt/apps/homestead/deploy/vps/.env
if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE"
  exit 1
fi

# Upsert flag without printing secrets
if grep -q '^AI_CONCIERGE_ENGINE=' "$ENV_FILE"; then
  sed -i 's/^AI_CONCIERGE_ENGINE=.*/AI_CONCIERGE_ENGINE=legacy/' "$ENV_FILE"
else
  printf '\nAI_CONCIERGE_ENGINE=legacy\n' >> "$ENV_FILE"
fi

echo "AI_CONCIERGE_ENGINE set to legacy in .env (value not dumped)"
cd /opt/apps/homestead/deploy/vps
docker compose up -d homestead_web

echo "ROLLBACK_ENGINE_OK"
echo "Optional: deactivate 'HOMESTEAD — Concierge Turn Coordinator (prod v2)' in n8n UI."
echo "Do NOT restore homestead.sqlite from pre-backup over live data."
