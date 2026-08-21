#!/bin/sh
set -e
STAMP=pre-appointments-calendar-20260820-2300
DIR=/opt/backups/$STAMP
mkdir -p "$DIR"
python3 - <<'PY'
import sqlite3
src_path = "/opt/apps/homestead/data/homestead.sqlite"
dst_path = "/opt/backups/pre-appointments-calendar-20260820-2300/homestead.sqlite"
src = sqlite3.connect(src_path)
dst = sqlite3.connect(dst_path)
with dst:
    src.backup(dst)
src.close()
check = sqlite3.connect(dst_path)
print("INTEGRITY", check.execute("PRAGMA integrity_check").fetchone()[0])
print("APPOINTMENTS", check.execute("SELECT COUNT(*) FROM revenue_appointments").fetchone()[0])
print("REQUESTS", check.execute("SELECT COUNT(*) FROM service_requests").fetchone()[0])
check.close()
print("SQLITE_BACKUP_OK")
PY
ls -lh "$DIR"
