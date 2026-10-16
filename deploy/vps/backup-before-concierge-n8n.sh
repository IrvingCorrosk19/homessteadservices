#!/bin/sh
# MUST run BEFORE any Homestead image rebuild, .env migration, n8n import, or engine flip.
# Consistent SQLite backup + data dirs + protected config (keys/hashes only) + previous image IDs.
# Does not activate Concierge, restart services for activation, or restore anything.
set -eu

STAMP=$(TZ=America/Panama date +%Y%m%d-%H%M%S)
DIR=/opt/backups/concierge-n8n-pre-$STAMP
mkdir -p "$DIR/n8n" "$DIR/homestead" "$DIR/config" "$DIR/images"
echo "BACKUP_DIR=$DIR"
echo "PURPOSE=pre-any-deploy-or-migration"

echo "=== previous container / image identity (rollback target) ==="
{
  echo "at=$(TZ=America/Panama date -Iseconds)"
  docker inspect homestead_web --format 'name={{.Name}} id={{.Id}} image={{.Image}} imageName={{.Config.Image}} created={{.Created}} status={{.State.Status}}' 2>/dev/null || echo "homestead_web=MISSING"
  docker inspect n8n_n8n --format 'name={{.Name}} id={{.Id}} image={{.Image}} imageName={{.Config.Image}} created={{.Created}} status={{.State.Status}}' 2>/dev/null || echo "n8n_n8n=MISSING"
  docker images --no-trunc --format '{{.Repository}}:{{.Tag}} {{.ID}} {{.CreatedSince}}' | grep -E 'homestead|n8nio/n8n' || true
  if [ -f /opt/apps/homestead/DEPLOYED_SHA ]; then
    echo "DEPLOYED_SHA=$(cat /opt/apps/homestead/DEPLOYED_SHA)"
  fi
  if [ -f /opt/apps/homestead/.deploy-commit ]; then
    echo "DEPLOY_COMMIT=$(cat /opt/apps/homestead/.deploy-commit)"
  fi
} | tee "$DIR/images/previous-runtime.txt"

# Digest-level identity for homestead_web image
docker inspect homestead_web --format '{{json .Image}}' > "$DIR/images/homestead_web.image-id" 2>/dev/null || true
docker inspect homestead_web --format '{{.Config.Image}}' > "$DIR/images/homestead_web.image-name" 2>/dev/null || true
docker inspect n8n_n8n --format '{{json .Image}}' > "$DIR/images/n8n_n8n.image-id" 2>/dev/null || true

echo "=== n8n postgres dump ==="
docker exec n8n_postgres pg_dump -U n8nuser -Fc -d n8n -f /tmp/concierge-n8n-pre.dump
docker cp n8n_postgres:/tmp/concierge-n8n-pre.dump "$DIR/n8n/n8n.dump"
docker exec n8n_postgres rm -f /tmp/concierge-n8n-pre.dump
chmod 600 "$DIR/n8n/n8n.dump"
ENTRIES=$(pg_restore -l "$DIR/n8n/n8n.dump" 2>/dev/null | grep -c '^[0-9]' || echo unknown)
echo "N8N_DUMP_BYTES=$(wc -c < "$DIR/n8n/n8n.dump")"
echo "N8N_DUMP_ENTRIES=$ENTRIES"

echo "=== n8n workflow export (inventory; do not use to overwrite blindly) ==="
if docker exec -u node n8n_n8n n8n export:workflow --all --output=/tmp/all-workflows-pre-concierge.json; then
  docker cp n8n_n8n:/tmp/all-workflows-pre-concierge.json "$DIR/n8n/all-workflows.json"
  docker exec n8n_n8n rm -f /tmp/all-workflows-pre-concierge.json
  chmod 600 "$DIR/n8n/all-workflows.json"
  echo "WORKFLOW_EXPORT=OK"
else
  echo "WORKFLOW_EXPORT=CLI_FAILED"
fi

echo "=== homestead sqlite ONLINE consistent backup ==="
python3 - <<PY
import sqlite3, os, json, shutil, hashlib
from datetime import datetime, timezone
src="/opt/apps/homestead/data/homestead.sqlite"
dst="$DIR/homestead/homestead.sqlite"
os.makedirs(os.path.dirname(dst), exist_ok=True)
s=sqlite3.connect(src); d=sqlite3.connect(dst); s.backup(d); s.close(); d.close()
c=sqlite3.connect(dst); integrity=c.execute("PRAGMA integrity_check").fetchone()[0]
counts={
  "service_requests": c.execute("SELECT COUNT(*) FROM service_requests").fetchone()[0] if c.execute("SELECT name FROM sqlite_master WHERE name='service_requests'").fetchone() else None,
  "revenue_appointments": c.execute("SELECT COUNT(*) FROM revenue_appointments").fetchone()[0] if c.execute("SELECT name FROM sqlite_master WHERE name='revenue_appointments'").fetchone() else None,
  "concierge_conversations": c.execute("SELECT COUNT(*) FROM concierge_conversations").fetchone()[0] if c.execute("SELECT name FROM sqlite_master WHERE name='concierge_conversations'").fetchone() else None,
}
c.close()
assert integrity=="ok", integrity
copied_dirs=[]
for sub in ("photos","content","concierge","jobs"):
  p=f"/opt/apps/homestead/data/{sub}"
  if os.path.isdir(p):
    shutil.copytree(p, f"$DIR/homestead/{sub}", dirs_exist_ok=True)
    copied_dirs.append(sub)
sha256=hashlib.sha256(open(dst,"rb").read()).hexdigest()
manifest={
  "at": datetime.now(timezone.utc).isoformat(),
  "purpose": "pre-any-deploy-or-migration-concierge-n8n",
  "integrity": integrity,
  "sqlite_sha256": sha256,
  "counts": counts,
  "copied_dirs": copied_dirs,
  "note": "Engine rollback flips AI_CONCIERGE_ENGINE=legacy only. Do NOT restore this dump over newer customer data unless disaster recovery.",
}
open("$DIR/manifest.json","w").write(json.dumps(manifest, indent=2))
print("SQLITE_INTEGRITY", integrity)
print("SQLITE_SHA256", sha256)
print("COUNTS", json.dumps(counts))
PY

echo "=== protected configuration (no secret values) ==="
# Homestead env: key names + sha256 of file (proves snapshot without exposing values)
if [ -f /opt/apps/homestead/deploy/vps/.env ]; then
  awk -F= '/^[A-Za-z_][A-Za-z0-9_]*=/{print $1}' /opt/apps/homestead/deploy/vps/.env \
    | sort > "$DIR/config/homestead-env-keys.txt"
  sha256sum /opt/apps/homestead/deploy/vps/.env | awk '{print $1}' > "$DIR/config/homestead-env.sha256"
  cp /opt/apps/homestead/deploy/vps/docker-compose.yml "$DIR/config/homestead-docker-compose.yml" 2>/dev/null || true
fi
# Optional encrypted copy only if operator explicitly sets INCLUDE_ENV_COPY=YES
if [ "${INCLUDE_ENV_COPY:-}" = "YES" ] && [ -f /opt/apps/homestead/deploy/vps/.env ]; then
  umask 077
  cp /opt/apps/homestead/deploy/vps/.env "$DIR/config/homestead.env.protected"
  chmod 600 "$DIR/config/homestead.env.protected"
  echo "ENV_COPY=PROTECTED mode=600"
else
  echo "ENV_COPY=KEYS_AND_HASH_ONLY (set INCLUDE_ENV_COPY=YES for mode-600 full copy)"
fi

N8N_DIR=$(docker inspect n8n_n8n --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' 2>/dev/null || true)
if [ -n "$N8N_DIR" ]; then
  echo "N8N_COMPOSE_DIR=$N8N_DIR" > "$DIR/config/n8n-compose-location.txt"
  if [ -f "$N8N_DIR/docker-compose.yml" ]; then
    cp "$N8N_DIR/docker-compose.yml" "$DIR/config/n8n-docker-compose.yml"
  fi
  if [ -f "$N8N_DIR/.env" ]; then
    awk -F= '/^[A-Za-z_][A-Za-z0-9_]*=/{print $1}' "$N8N_DIR/.env" | sort > "$DIR/config/n8n-env-keys.txt"
    sha256sum "$N8N_DIR/.env" | awk '{print $1}' > "$DIR/config/n8n-env.sha256"
  fi
fi

echo "$DIR" > /opt/backups/concierge-n8n-pre-LATEST.path
echo "BACKUP_OK $DIR"
echo "NEXT=only after backup verify: deploy code still on AI_CONCIERGE_ENGINE=legacy"
