#!/bin/sh
set -e
python3 - <<'PY'
import json
from pathlib import Path
wf = json.loads(Path('/opt/apps/homestead/n8n/homestead-n8n-telegram-workflow.json').read_text())
Path('/tmp/homestead-n8n-import.json').write_text(json.dumps([wf]))
PY
docker exec n8n_postgres psql -U n8nuser -d n8n -c "DELETE FROM workflow_entity WHERE id = 'Dn5OgT2QvTcTFRrV' OR name = 'HOMESTEAD — Nueva solicitud → Telegram';"
docker cp /tmp/homestead-n8n-import.json n8n_n8n:/tmp/homestead-n8n-import.json
docker exec -u node n8n_n8n n8n import:workflow --input=/tmp/homestead-n8n-import.json
ID=$(docker exec n8n_postgres psql -U n8nuser -d n8n -t -A -c "SELECT id FROM workflow_entity WHERE name = 'HOMESTEAD — Nueva solicitud → Telegram' LIMIT 1;")
echo "WORKFLOW_ID=$ID"
docker exec -u node n8n_n8n n8n publish:workflow --id="$ID"
docker restart n8n_n8n
sleep 10
docker exec n8n_n8n wget -qO- http://localhost:5678/healthz
echo
docker exec n8n_postgres psql -U n8nuser -d n8n -c 'SELECT "webhookPath", method FROM webhook_entity;'
echo REPLACE_OK
