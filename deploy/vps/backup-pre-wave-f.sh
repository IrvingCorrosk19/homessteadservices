#!/bin/bash
set -euo pipefail
STAMP=$(date +%Y%m%d-%H%M)
DIR=/opt/backups/homestead/pre-wave-f
mkdir -p "$DIR"
DB=/opt/apps/homestead/data/homestead.sqlite
cp -a "$DB" "$DIR/homestead-$STAMP.sqlite"
python3 - <<PY
import sqlite3
db=sqlite3.connect("$DIR/homestead-$STAMP.sqlite")
print("INTEGRITY="+db.execute("PRAGMA integrity_check").fetchone()[0])
print("BACKUP=$DIR/homestead-$STAMP.sqlite")
PY
