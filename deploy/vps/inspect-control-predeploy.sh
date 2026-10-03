#!/bin/sh
set -eu
echo "=== host ==="
hostname
date
echo "=== disk ==="
df -h / /opt /var /tmp | sed -n '1,8p'
echo "=== compose service ==="
docker ps --filter name=homestead_web --format '{{.Names}} {{.Image}} {{.Status}} {{.Ports}}'
echo "=== images ==="
docker images --format '{{.Repository}}:{{.Tag}} {{.ID}} {{.CreatedSince}}' | grep -i homestead | head
echo "=== volume / data ==="
ls -ld /opt/apps/homestead /opt/apps/homestead/data /opt/apps/homestead/data/homestead.sqlite 2>/dev/null || true
ls -lh /opt/apps/homestead/data/homestead.sqlite* 2>/dev/null || true
echo "=== env flags (names only) ==="
docker exec homestead_web sh -c 'printf "NODE_ENV=%s\nDATA_DIR=%s\nCONTENT_DRY_RUN=%s\nCONTENT_MODE=%s\nCONTENT_PUBLISH_ENABLED=%s\nHOMESTEAD_CONTROL_ISOLATED=%s\nNEXT_PUBLIC_HOMESTEAD_CONTROL_ISOLATED=%s\nADMIN_PASSWORD=%s\nADMIN_SESSION_SECRET=%s\nFACEBOOK_PAGE_ID=%s\nINSTAGRAM_ACCOUNT_ID=%s\nMETA_PAGE_ACCESS_TOKEN=%s\nMETA_GRAPH_VERSION=%s\n" "$NODE_ENV" "$DATA_DIR" "$CONTENT_DRY_RUN" "$CONTENT_MODE" "$CONTENT_PUBLISH_ENABLED" "${HOMESTEAD_CONTROL_ISOLATED:-ABSENT}" "${NEXT_PUBLIC_HOMESTEAD_CONTROL_ISOLATED:-ABSENT}" "$( [ -n "$ADMIN_PASSWORD" ] && echo SET || echo EMPTY )" "$( [ -n "$ADMIN_SESSION_SECRET" ] && echo SET || echo EMPTY )" "$( [ -n "$FACEBOOK_PAGE_ID" ] && echo SET || echo EMPTY )" "$( [ -n "$INSTAGRAM_ACCOUNT_ID" ] && echo SET || echo EMPTY )" "$( [ -n "$META_PAGE_ACCESS_TOKEN" ] && echo SET || echo EMPTY )" "${META_GRAPH_VERSION:-ABSENT}"'
echo "=== nginx homestead ==="
grep -R "homestead.lat\|3091" /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null | head -20 || true
echo "=== nightly backup ==="
ls -l /opt/apps/homestead/deploy/vps/production-backup.sh /opt/apps/homestead/scripts/production-backup.mjs 2>/dev/null || true
crontab -l 2>/dev/null | grep -i -E "backup|homestead" || true
ls -ld /opt/backups 2>/dev/null || true
ls -lt /opt/backups 2>/dev/null | head -12 || true
echo "=== scheduler / content counts ==="
python3 - <<'PY'
import sqlite3
c=sqlite3.connect('/opt/apps/homestead/data/homestead.sqlite')
print('integrity', c.execute('PRAGMA integrity_check').fetchone()[0])
for t in ['service_requests','revenue_appointments','content_jobs','content_publications','control_intake_items','admin_sessions']:
    try:
        print(t, c.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0])
    except Exception as e:
        print(t, 'MISSING', type(e).__name__)
try:
    print('due_scheduled', c.execute("SELECT COUNT(*) FROM content_jobs WHERE status='SCHEDULED'").fetchone()[0])
    print('publishing', c.execute("SELECT COUNT(*) FROM content_publications WHERE status='PUBLISHING'").fetchone()[0])
except Exception as e:
    print('content_query', type(e).__name__)
c.close()
PY
echo "=== health ==="
curl -sS -m 15 -o /tmp/hs-health.json -w "loopback_health:%{http_code}\n" http://127.0.0.1:3091/api/health || true
curl -sS -m 15 -o /tmp/hs-ready.json -w "loopback_ready:%{http_code}\n" http://127.0.0.1:3091/api/ready || true
python3 - <<'PY'
import json
for name in ['/tmp/hs-health.json','/tmp/hs-ready.json']:
    try:
        data=json.load(open(name))
        print(name, {k:data.get(k) for k in list(data)[:12]})
    except Exception as e:
        print(name, type(e).__name__)
PY
echo INSPECT_OK
