#!/bin/sh
# Backup before Concierge n8n activation. Preserves data; does not activate anything.
# Safe to re-run. Does not restart Homestead or mutate workflows.
set -eu

STAMP=$(TZ=America/Panama date +%Y%m%d-%H%M%S)
DIR=/opt/backups/concierge-n8n-pre-$STAMP
mkdir -p "$DIR/n8n" "$DIR/homestead" "$DIR/config"
echo "BACKUP_DIR=$DIR"

echo "=== n8n postgres dump ==="
docker exec n8n_postgres pg_dump -U n8nuser -Fc -d n8n -f /tmp/concierge-n8n-pre.dump
docker cp n8n_postgres:/tmp/concierge-n8n-pre.dump "$DIR/n8n/n8n.dump"
docker exec n8n_postgres rm -f /tmp/concierge-n8n-pre.dump
chmod 600 "$DIR/n8n/n8n.dump"
ENTRIES=$(pg_restore -l "$DIR/n8n/n8n.dump" 2>/dev/null | grep -c '^[0-9]' || echo unknown)
echo "N8N_DUMP_BYTES=$(wc -c < "$DIR/n8n/n8n.dump")"
echo "N8N_DUMP_ENTRIES=$ENTRIES"

echo "=== n8n workflow export (all; for restore inventory) ==="
if docker exec -u node n8n_n8n n8n export:workflow --all --output=/tmp/all-workflows-pre-concierge.json; then
  docker cp n8n_n8n:/tmp/all-workflows-pre-concierge.json "$DIR/n8n/all-workflows.json"
  docker exec n8n_n8n rm -f /tmp/all-workflows-pre-concierge.json
  chmod 600 "$DIR/n8n/all-workflows.json"
  echo "WORKFLOW_EXPORT=OK"
else
  echo "WORKFLOW_EXPORT=CLI_FAILED"
fi

echo "=== homestead sqlite online backup ==="
python3 - <<PY
import sqlite3, os, json, shutil
from datetime import datetime, timezone
src="/opt/apps/homestead/data/homestead.sqlite"
dst="$DIR/homestead/homestead.sqlite"
os.makedirs(os.path.dirname(dst), exist_ok=True)
s=sqlite3.connect(src); d=sqlite3.connect(dst); s.backup(d); s.close(); d.close()
c=sqlite3.connect(dst); integrity=c.execute("PRAGMA integrity_check").fetchone()[0]; c.close()
assert integrity=="ok", integrity
for sub in ("photos","content","concierge","jobs"):
  p=f"/opt/apps/homestead/data/{sub}"
  if os.path.isdir(p):
    shutil.copytree(p, f"$DIR/homestead/{sub}", dirs_exist_ok=True)
manifest={
  "at": datetime.now(timezone.utc).isoformat(),
  "purpose": "pre-concierge-n8n-activation",
  "integrity": integrity,
  "note": "Rollback flips AI_CONCIERGE_ENGINE=legacy; do NOT restore this dump over newer customer data unless disaster recovery.",
}
open("$DIR/manifest.json","w").write(json.dumps(manifest, indent=2))
print("SQLITE_INTEGRITY", integrity)
PY

echo "=== config key names only ==="
if [ -f /opt/apps/homestead/deploy/vps/.env ]; then
  awk -F= '/^[A-Za-z_][A-Za-z0-9_]*=/{print $1}' /opt/apps/homestead/deploy/vps/.env \
    > "$DIR/config/homestead-env-keys.txt"
fi
N8N_DIR=$(docker inspect n8n_n8n --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' 2>/dev/null || true)
if [ -n "$N8N_DIR" ] && [ -f "$N8N_DIR/.env" ]; then
  awk -F= '/^[A-Za-z_][A-Za-z0-9_]*=/{print $1}' "$N8N_DIR/.env" > "$DIR/config/n8n-env-keys.txt"
fi
echo "$DIR" > /opt/backups/concierge-n8n-pre-LATEST.path
echo "BACKUP_OK $DIR"
