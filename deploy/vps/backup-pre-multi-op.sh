#!/bin/bash
set -euo pipefail
mkdir -p /opt/backups/homestead/pre-telegram-multi-operator-v1
STAMP=$(date +%Y%m%d-%H%M)
SRC=/opt/apps/homestead/data/homestead.sqlite
DEST="/opt/backups/homestead/pre-telegram-multi-operator-v1/homestead-${STAMP}.sqlite"
cp -a "$SRC" "$DEST"
echo "BACKUP=$DEST"
docker exec homestead_web node -e 'const Database=require("better-sqlite3"); const db=new Database("/app/data/homestead.sqlite"); console.log("INTEGRITY="+db.pragma("integrity_check",{simple:true}));'
ls -la /opt/backups/homestead/pre-telegram-multi-operator-v1/ | tail -5
grep -E '^HOMESTEAD_TELEGRAM_(ADMIN_CHAT_IDS|CHAT_ID)=' /opt/apps/homestead/deploy/vps/.env \
  | sed -E 's/=.*/=***MASKED***/' || true
echo BACKUP_DONE
