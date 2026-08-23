#!/bin/bash
set -euo pipefail
mkdir -p /opt/backups/homestead/pre-wave-e
STAMP=$(date +%Y%m%d-%H%M)
cp -a /opt/apps/homestead/data/homestead.sqlite "/opt/backups/homestead/pre-wave-e/homestead-${STAMP}.sqlite"
echo "BACKUP=/opt/backups/homestead/pre-wave-e/homestead-${STAMP}.sqlite"
docker exec homestead_web node -e 'const Database=require("better-sqlite3"); const db=new Database("/app/data/homestead.sqlite"); console.log("INTEGRITY="+db.pragma("integrity_check",{simple:true}));'
echo BACKUP_DONE
