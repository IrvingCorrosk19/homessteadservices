#!/bin/sh
set -e
python3 - <<'PY'
import json
from pathlib import Path
for src, dst in [
    ('/opt/apps/homestead/n8n/homestead-n8n-analytics-collector.json', '/tmp/homestead-mi-collect-import.json'),
    ('/opt/apps/homestead/n8n/homestead-n8n-weekly-report.json', '/tmp/homestead-mi-week-import.json'),
]:
    wf = json.loads(Path(src).read_text())
    Path(dst).write_text(json.dumps([wf]))
PY
docker exec n8n_postgres psql -U n8nuser -d n8n -c "DELETE FROM workflow_entity WHERE name IN ('HOMESTEAD — Marketing Analytics Collector', 'HOMESTEAD — Weekly Marketing Report');"
docker cp /tmp/homestead-mi-collect-import.json n8n_n8n:/tmp/homestead-mi-collect-import.json
docker cp /tmp/homestead-mi-week-import.json n8n_n8n:/tmp/homestead-mi-week-import.json
docker exec -u node n8n_n8n n8n import:workflow --input=/tmp/homestead-mi-collect-import.json
docker exec -u node n8n_n8n n8n import:workflow --input=/tmp/homestead-mi-week-import.json
ID1=$(docker exec n8n_postgres psql -U n8nuser -d n8n -t -A -c "SELECT id FROM workflow_entity WHERE name = 'HOMESTEAD — Marketing Analytics Collector' LIMIT 1;")
ID2=$(docker exec n8n_postgres psql -U n8nuser -d n8n -t -A -c "SELECT id FROM workflow_entity WHERE name = 'HOMESTEAD — Weekly Marketing Report' LIMIT 1;")
echo "COLLECTOR=$ID1"
echo "WEEKLY=$ID2"
docker exec -u node n8n_n8n n8n publish:workflow --id="$ID1"
docker exec -u node n8n_n8n n8n publish:workflow --id="$ID2"
docker restart n8n_n8n
sleep 12
docker exec n8n_n8n wget -qO- http://localhost:5678/healthz
echo
docker exec n8n_postgres psql -U n8nuser -d n8n -c "SELECT name, active FROM workflow_entity WHERE name LIKE 'HOMESTEAD%';"
echo MARKETING_N8N_IMPORT_OK
