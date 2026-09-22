#!/bin/sh
set -e
STAMP=$(date -u +%Y%m%d-%H%M%S)
DIR=/opt/backups/homestead-pre-content-meta-$STAMP
mkdir -p "$DIR"
python3 -c "import sqlite3,sys; src=sqlite3.connect('/opt/apps/homestead/data/homestead.sqlite'); dst=sqlite3.connect(sys.argv[1]); src.backup(dst); src.close(); c=sqlite3.connect(sys.argv[1]); print('INTEGRITY', c.execute('PRAGMA integrity_check').fetchone()[0]); print('REQUESTS', c.execute('SELECT COUNT(*) FROM service_requests').fetchone()[0]); print('APPOINTMENTS', c.execute('SELECT COUNT(*) FROM revenue_appointments').fetchone()[0]); print('CONTENT_JOBS', c.execute('SELECT COUNT(*) FROM content_jobs').fetchone()[0]); c.close(); print('SQLITE_BACKUP_OK')" "$DIR/homestead.sqlite"
cp -a /opt/apps/homestead/deploy/vps/.env /tmp/homestead.env.preserve
cp -a /opt/apps/homestead/deploy/vps/.env "$DIR/env.preserve"
awk -F= '/^[A-Za-z_][A-Za-z0-9_]*=/{print $1}' /opt/apps/homestead/deploy/vps/.env > "$DIR/env.keys.txt"
# Operational flags only
python3 - <<'PY'
from pathlib import Path
wanted = {}
for line in Path("/opt/apps/homestead/deploy/vps/.env").read_text(encoding="utf-8", errors="replace").splitlines():
    if not line or line.lstrip().startswith("#") or "=" not in line:
        continue
    k, _, v = line.partition("=")
    if k in ("CONTENT_DRY_RUN", "CONTENT_MODE"):
        wanted[k] = v.strip().strip('"').strip("'")
print("CONTENT_DRY_RUN", wanted.get("CONTENT_DRY_RUN", "MISSING"))
print("CONTENT_MODE", wanted.get("CONTENT_MODE", "MISSING"))
if wanted.get("CONTENT_DRY_RUN", "true").lower() == "false":
    raise SystemExit("REFUSE_DEPLOY CONTENT_DRY_RUN is false")
if wanted.get("CONTENT_MODE", "ASSISTED") not in ("", "ASSISTED"):
    print("WARN CONTENT_MODE not ASSISTED")
PY
test -f /tmp/homestead-deploy.tar.gz
mkdir -p /opt/apps/homestead
tar -xzf /tmp/homestead-deploy.tar.gz -C /opt/apps/homestead
rm -f /tmp/homestead-deploy.tar.gz
mkdir -p /opt/apps/homestead/deploy/vps
cp -a /tmp/homestead.env.preserve /opt/apps/homestead/deploy/vps/.env
rm -f /tmp/homestead.env.preserve
test -f /opt/apps/homestead/src/lib/content-publish-policy.ts
test -f /opt/apps/homestead/src/app/api/content/media/route.ts
test -f /opt/apps/homestead/src/app/api/internal/content/meta-status/route.ts
grep -q 'CONTENT_PUBLISH_ENABLED' /opt/apps/homestead/deploy/vps/docker-compose.yml
grep -q 'FACEBOOK_PAGE_ID' /opt/apps/homestead/deploy/vps/docker-compose.yml
test -f /opt/apps/homestead/deploy/vps/.env
cd /opt/apps/homestead/deploy/vps
docker compose --project-name homestead build homestead_web
docker rm -f homestead_web || true
docker compose --project-name homestead up -d homestead_web
i=0
while [ "$i" -lt 30 ]; do
  i=$((i + 1))
  st=$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' homestead_web 2>/dev/null || echo unknown)
  echo "t=${i} status=${st}"
  echo "$st" | grep -q 'running healthy' && break
  sleep 5
done
curl -sS -o /dev/null -w "loopback:%{http_code}\n" http://127.0.0.1:3091/api/health
curl -sS -o /dev/null -w "public:%{http_code}\n" https://homestead.lat/api/health
python3 - <<'PY'
import sqlite3
c=sqlite3.connect('/opt/apps/homestead/data/homestead.sqlite')
print('LIVE_REQUESTS', c.execute('SELECT COUNT(*) FROM service_requests').fetchone()[0])
print('LIVE_APPOINTMENTS', c.execute('SELECT COUNT(*) FROM revenue_appointments').fetchone()[0])
print('LIVE_INTEGRITY', c.execute('PRAGMA integrity_check').fetchone()[0])
cols=[r[1] for r in c.execute('PRAGMA table_info(content_jobs)')]
print('LIVE_ONCE_COL', 'live_once' in cols)
print('APPROVED_VERSION_COL', 'approved_version' in cols)
c.close()
PY
echo "CONTENT_DRY_RUN=$(docker exec homestead_web printenv CONTENT_DRY_RUN)"
echo "CONTENT_MODE=$(docker exec homestead_web printenv CONTENT_MODE)"
echo "CONTENT_PUBLISH_ENABLED=$(docker exec homestead_web printenv CONTENT_PUBLISH_ENABLED)"
echo BACKUP_DIR=$DIR
echo DEPLOY_OK
