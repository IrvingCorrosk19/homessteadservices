#!/bin/sh
set -e
mkdir -p /opt/apps/homestead
tar -xzf /tmp/homestead-deploy.tar.gz -C /opt/apps/homestead
rm -f /tmp/homestead-deploy.tar.gz
test -f /opt/apps/homestead/package.json
test -f /opt/apps/homestead/src/lib/appointment-time.ts
test -f /opt/apps/homestead/src/app/admin/citas/page.tsx
cd /opt/apps/homestead/deploy/vps
docker compose --project-name homestead build homestead_web
docker rm -f homestead_web
docker compose --project-name homestead up -d homestead_web
sleep 4
curl -sS -o /dev/null -w "loopback:%{http_code}\n" http://127.0.0.1:3091/ || true
docker ps --filter name=homestead_web --format "{{.Names}} {{.Status}} {{.Ports}}"
echo DEPLOY_OK
