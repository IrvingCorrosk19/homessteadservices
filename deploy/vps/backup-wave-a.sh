#!/bin/sh
# Wave A pre-implementation backup. Copy only. No deletes. No n8n restart.
set -e
STAMP=pre-automation-v2-wave-a-20260822-0308
DIR=/opt/backups/$STAMP
mkdir -p "$DIR/n8n/workflow-export" "$DIR/homestead" "$DIR/config"
echo "BACKUP_DIR=$DIR"

python3 - <<'PY'
import hashlib, os, sqlite3
src = "/opt/apps/homestead/data/homestead.sqlite"
dst = "/opt/backups/pre-automation-v2-wave-a-20260822-0308/homestead/homestead.sqlite"
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

# photos/content manifest, do not copy all binaries unless small
python3 - <<'PY'
import json, os
from pathlib import Path
root = Path("/opt/apps/homestead/data")
def inventory(rel):
    p = root / rel
    files = 0
    size = 0
    if p.exists():
        for f in p.rglob("*"):
            if f.is_file():
                files += 1
                size += f.stat().st_size
    return {"files": files, "bytes": size}
out = {"photos": inventory("photos"), "content": inventory("content")}
print("DATA_MANIFEST", json.dumps(out))
open("/opt/backups/pre-automation-v2-wave-a-20260822-0308/homestead/storage-manifest.json","w").write(json.dumps(out, indent=2))
PY

docker exec n8n_postgres pg_dump -U n8nuser -Fc -d n8n -f /tmp/n8n-wave-a.dump
docker cp n8n_postgres:/tmp/n8n-wave-a.dump "$DIR/n8n/n8n.dump"
ENTRIES=$(docker exec n8n_postgres pg_restore -l /tmp/n8n-wave-a.dump | grep -c "^[0-9]" || true)
docker exec n8n_postgres rm -f /tmp/n8n-wave-a.dump
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
curl -sS -o /dev/null -w "homestead_loopback:%{http_code}\n" http://127.0.0.1:3091/ || true
curl -sS -o /dev/null -w "n8n_public:%{http_code}\n" https://n8n.autonomousflow.lat/healthz || true

docker exec homestead_web node -e "
const token=process.env.TELEGRAM_BOT_TOKEN||'';
if(!token){console.log('WEBHOOK=NO_TOKEN');process.exit(0)}
fetch('https://api.telegram.org/bot'+token+'/getWebhookInfo').then(r=>r.json()).then(j=>{
  const r=j.result||{};
  console.log(JSON.stringify({ok:j.ok,url:r.url||'',pending:r.pending_update_count,last_error_date:r.last_error_date||null,last_error_message:r.last_error_message||null}));
});
"

ls -lh "$DIR/n8n" "$DIR/homestead"
echo BACKUP_COMPLETE
