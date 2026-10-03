#!/bin/sh
# Online SQLite backup + business files for VPS cron.
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DATA_DIR="${DATA_DIR:-/opt/apps/homestead/data}"
BACKUP_DIR="${BACKUP_DIR:-/opt/backups}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
DEST="$BACKUP_DIR/$STAMP"
export DATA_DIR
export BACKUP_RETAIN_COUNT="${BACKUP_RETAIN_COUNT:-7}"

ran=0
if command -v node >/dev/null 2>&1; then
  if node "$ROOT/scripts/production-backup.mjs" --dest "$DEST"; then
    ran=1
  fi
fi
if [ "$ran" -ne 1 ]; then
  python3 -c "
import sqlite3, shutil, json, os
from datetime import datetime, timezone
dest='$DEST'
os.makedirs(dest, exist_ok=True)
src='$DATA_DIR/homestead.sqlite'
dst=dest+'/homestead.sqlite'
s=sqlite3.connect(src); d=sqlite3.connect(dst); s.backup(d); s.close(); d.close()
c=sqlite3.connect(dst); integrity=c.execute('PRAGMA integrity_check').fetchone()[0]; c.close()
if integrity != 'ok':
    raise SystemExit('integrity_check_failed')
for sub in ['photos','content','concierge','jobs']:
 p='$DATA_DIR/'+sub
 if os.path.isdir(p): shutil.copytree(p, dest+'/'+sub, dirs_exist_ok=True)
at=datetime.now(timezone.utc).isoformat()
open(dest+'/manifest.json','w').write(json.dumps({'at':at,'integrity':integrity}))
live=sqlite3.connect('$DATA_DIR/homestead.sqlite')
live.execute('INSERT INTO automation_engine_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at', ('last_backup_at', at, at))
live.commit(); live.close()
print('BACKUP_OK',dest,integrity)
"
fi
echo "Backup complete: $DEST"
