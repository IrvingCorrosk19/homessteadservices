#!/bin/sh
# Wave B pre-implementation backup. Copy only. No deletes. No n8n postgres restart.
set -e
STAMP=pre-automation-v2-wave-b-20260822-0825
DIR=/opt/backups/$STAMP
mkdir -p "$DIR/n8n/workflow-export" "$DIR/homestead"
echo "BACKUP_DIR=$DIR"

python3 - <<'PY'
import hashlib, os, sqlite3
src = "/opt/apps/homestead/data/homestead.sqlite"
dst = "/opt/backups/pre-automation-v2-wave-b-20260822-0825/homestead/homestead.sqlite"
os.makedirs(os.path.dirname(dst), exist_ok=True)
s = sqlite3.connect(src)
d = sqlite3.connect(dst)
with d:
    s.backup(d)
s.close()
c = sqlite3.connect(dst)
print("SQLITE_INTEGRITY", c.execute("PRAGMA integrity_check").fetchone()[0])
print("REQUESTS", c.execute("SELECT COUNT(*) FROM service_requests").fetchone()[0])
print("APPOINTMENTS", c.execute("SELECT COUNT(*) FROM revenue_appointments").fetchone()[0])
c.close()
raw = open(dst, "rb").read()
print("SQLITE_BYTES", len(raw))
print("SQLITE_SHA256", hashlib.sha256(raw).hexdigest())
print("SQLITE_BACKUP_OK")
PY
chmod 600 "$DIR/homestead/homestead.sqlite"

docker exec n8n_postgres pg_dump -U n8nuser -Fc -d n8n -f /tmp/n8n-wave-b.dump
docker cp n8n_postgres:/tmp/n8n-wave-b.dump "$DIR/n8n/n8n.dump"
ENTRIES=$(docker exec n8n_postgres pg_restore -l /tmp/n8n-wave-b.dump | grep -c "^[0-9]" || true)
docker exec n8n_postgres rm -f /tmp/n8n-wave-b.dump
chmod 600 "$DIR/n8n/n8n.dump"
echo "N8N_DUMP_BYTES=$(wc -c < "$DIR/n8n/n8n.dump")"
echo "PG_RESTORE_ENTRIES=$ENTRIES"

if docker exec -u node n8n_n8n n8n export:workflow --all --output=/tmp/all-workflows.json; then
  docker cp n8n_n8n:/tmp/all-workflows.json "$DIR/n8n/workflow-export/all-workflows.json"
  docker exec n8n_n8n rm -f /tmp/all-workflows.json
  chmod 600 "$DIR/n8n/workflow-export/all-workflows.json"
  echo "N8N_EXPORT=OK"
else
  echo "N8N_EXPORT=FAIL"
  exit 1
fi

docker exec n8n_postgres psql -U n8nuser -d n8n -c "SELECT name, active FROM workflow_entity WHERE name LIKE 'HOMESTEAD%' ORDER BY name;"
echo "N8N_HEALTHZ=$(docker exec n8n_n8n wget -qO- http://localhost:5678/healthz)"
curl -sS -o /dev/null -w "homestead:%{http_code}\n" https://homestead.lat/ || true
echo BACKUP_COMPLETE
