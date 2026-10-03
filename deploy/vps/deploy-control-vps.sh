#!/bin/sh
set -eu
SHA="${1:-}"
if [ -z "$SHA" ]; then
  echo "usage: deploy-control-vps.sh <commit-sha>" >&2
  exit 2
fi
STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP=/opt/backups/homestead-pre-control-$STAMP
RESTORE=/tmp/hs-restore-test-$STAMP
mkdir -p "$BACKUP" "$RESTORE"
echo "BACKUP_DIR=$BACKUP"
echo "DEPLOY_SHA=$SHA"

echo "=== tag previous image ==="
docker tag homestead-homestead_web:latest "homestead-homestead_web:pre-control-$STAMP"
docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' | grep homestead | head

echo "=== WAL-safe sqlite + media ==="
python3 - <<PY
import os, sqlite3, shutil, json, hashlib
from datetime import datetime, timezone
src="/opt/apps/homestead/data/homestead.sqlite"
dst="$BACKUP/homestead.sqlite"
os.makedirs("$BACKUP", exist_ok=True)
s=sqlite3.connect(src)
d=sqlite3.connect(dst)
s.backup(d)
s.close(); d.close()
c=sqlite3.connect(dst)
integrity=c.execute("PRAGMA integrity_check").fetchone()[0]
counts={
  "service_requests": c.execute("SELECT COUNT(*) FROM service_requests").fetchone()[0],
  "revenue_appointments": c.execute("SELECT COUNT(*) FROM revenue_appointments").fetchone()[0],
  "content_jobs": c.execute("SELECT COUNT(*) FROM content_jobs").fetchone()[0],
}
c.close()
copied={}
for sub in ["photos","content","concierge","jobs"]:
    p=f"/opt/apps/homestead/data/{sub}"
    if os.path.isdir(p):
        shutil.copytree(p, f"$BACKUP/{sub}", dirs_exist_ok=True)
        n=0
        for root,_,files in os.walk(f"$BACKUP/{sub}"):
            n += len(files)
        copied[sub]=n
if os.path.isfile("/opt/apps/homestead/deploy/vps/.env"):
    shutil.copy2("/opt/apps/homestead/deploy/vps/.env", "$BACKUP/env.preserve")
h=hashlib.sha256(open(dst,"rb").read()).hexdigest()
open("$BACKUP/manifest.json","w").write(json.dumps({
  "at": datetime.now(timezone.utc).isoformat(),
  "integrity": integrity,
  "sha256": h,
  "counts": counts,
  "copied": copied,
  "sha": "$SHA",
}, indent=2))
print("INTEGRITY", integrity)
print("SHA256", h)
print("COUNTS", counts)
print("COPIED", copied)
if integrity != "ok":
    raise SystemExit(3)
print("SQLITE_BACKUP_OK")
PY

echo "=== isolated restore (never onto production) ==="
python3 - <<PY
import os, sqlite3, shutil, json
os.makedirs("$RESTORE", exist_ok=True)
shutil.copy2("$BACKUP/homestead.sqlite", "$RESTORE/homestead.sqlite")
c=sqlite3.connect("$RESTORE/homestead.sqlite")
print("RESTORE_INTEGRITY", c.execute("PRAGMA integrity_check").fetchone()[0])
print("RESTORE_REQUESTS", c.execute("SELECT COUNT(*) FROM service_requests").fetchone()[0])
print("RESTORE_APPOINTMENTS", c.execute("SELECT COUNT(*) FROM revenue_appointments").fetchone()[0])
print("RESTORE_CONTENT", c.execute("SELECT COUNT(*) FROM content_jobs").fetchone()[0])
c.close()
print("RESTORE_ISOLATED_OK", "$RESTORE")
print("PRODUCTION_DB_UNTOUCHED", os.path.isfile("/opt/apps/homestead/data/homestead.sqlite"))
PY

echo "=== preserve env and extract commit tree ==="
test -f /tmp/homestead-deploy.tar.gz
cp -a /opt/apps/homestead/deploy/vps/.env /tmp/homestead.env.preserve
tar -xzf /tmp/homestead-deploy.tar.gz -C /opt/apps/homestead --exclude='data' --exclude='deploy/vps/.env' --exclude='data/control-dev' --exclude='data/control-test'
rm -f /tmp/homestead-deploy.tar.gz
mkdir -p /opt/apps/homestead/deploy/vps
cp -a /tmp/homestead.env.preserve /opt/apps/homestead/deploy/vps/.env
rm -f /tmp/homestead.env.preserve
printf '%s\n' "$SHA" > /opt/apps/homestead/DEPLOYED_SHA
test -f /opt/apps/homestead/src/lib/control-service.ts
test -f /opt/apps/homestead/src/app/admin/contenido/page.tsx
test -f /opt/apps/homestead/public/admin/sw.js
test -f /opt/apps/homestead/deploy/vps/.env
grep -q 'admin_sessions' /opt/apps/homestead/src/lib/service-requests.ts
if grep -R "HOMESTEAD_CONTROL_ISOLATED=true" /opt/apps/homestead/deploy/vps/docker-compose.yml >/dev/null; then
  echo "isolated flag in compose" >&2
  exit 4
fi

echo "=== fix nightly backup owner/perms ==="
chown root:root /opt/apps/homestead/deploy/vps/production-backup.sh
chmod 750 /opt/apps/homestead/deploy/vps/production-backup.sh
if [ -f /opt/apps/homestead/scripts/production-backup.mjs ]; then
  chown root:root /opt/apps/homestead/scripts/production-backup.mjs
  chmod 640 /opt/apps/homestead/scripts/production-backup.mjs
fi
ls -l /opt/apps/homestead/deploy/vps/production-backup.sh
crontab -l | grep -F "homestead-production-backup" >/dev/null
if DATA_DIR=/opt/apps/homestead/data BACKUP_DIR=/opt/backups BACKUP_RETAIN_COUNT=7 \
  /opt/apps/homestead/deploy/vps/production-backup.sh; then
  echo "NIGHTLY_BACKUP_FIXED=1"
else
  echo "NIGHTLY_BACKUP_VERIFY_FAIL=1"
fi

echo "=== replace only homestead_web ==="
cd /opt/apps/homestead/deploy/vps
docker compose --project-name homestead build homestead_web
docker compose --project-name homestead up -d --no-deps --force-recreate homestead_web
i=0
while [ "$i" -lt 40 ]; do
  i=$((i + 1))
  st=$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' homestead_web 2>/dev/null || echo unknown)
  echo "t=${i} status=${st}"
  echo "$st" | grep -q 'running healthy' && break
  sleep 5
done
curl -sS -m 20 -o /dev/null -w "loopback_health:%{http_code}\n" http://127.0.0.1:3091/api/health
curl -sS -m 20 -o /dev/null -w "loopback_ready:%{http_code}\n" http://127.0.0.1:3091/api/ready
curl -sS -m 20 -o /dev/null -w "public_health:%{http_code}\n" https://homestead.lat/api/health
echo "HOMESTEAD_CONTROL_ISOLATED=$(docker exec homestead_web printenv HOMESTEAD_CONTROL_ISOLATED || echo ABSENT)"
echo "CONTENT_DRY_RUN=$(docker exec homestead_web printenv CONTENT_DRY_RUN)"
echo "CONTENT_PUBLISH_ENABLED=$(docker exec homestead_web printenv CONTENT_PUBLISH_ENABLED)"
echo "IMAGE=$(docker inspect -f '{{.Image}}' homestead_web)"
echo "DEPLOYED_SHA=$(cat /opt/apps/homestead/DEPLOYED_SHA)"
python3 - <<'PY'
import sqlite3
c=sqlite3.connect('/opt/apps/homestead/data/homestead.sqlite')
print('LIVE_INTEGRITY', c.execute('PRAGMA integrity_check').fetchone()[0])
print('LIVE_REQUESTS', c.execute('SELECT COUNT(*) FROM service_requests').fetchone()[0])
print('LIVE_APPOINTMENTS', c.execute('SELECT COUNT(*) FROM revenue_appointments').fetchone()[0])
print('LIVE_CONTENT', c.execute('SELECT COUNT(*) FROM content_jobs').fetchone()[0])
try:
    print('LIVE_SESSIONS', c.execute('SELECT COUNT(*) FROM admin_sessions').fetchone()[0])
except Exception as e:
    print('LIVE_SESSIONS', type(e).__name__)
c.close()
PY
echo BACKUP_DIR=$BACKUP
echo ROLLBACK_IMAGE=homestead-homestead_web:pre-control-$STAMP
echo DEPLOY_OK
