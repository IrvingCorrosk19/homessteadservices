#!/usr/bin/env python3
import os
import shutil
import sqlite3
import time
from pathlib import Path

stamp = time.strftime("%Y%m%d-%H%M")
src = Path("/opt/apps/homestead/data/homestead.sqlite")
dest_dir = Path("/opt/backups/homestead/pre-wave-f")
dest_dir.mkdir(parents=True, exist_ok=True)
dest = dest_dir / f"homestead-{stamp}.sqlite"
shutil.copy2(src, dest)
db = sqlite3.connect(str(dest))
print("INTEGRITY=" + db.execute("PRAGMA integrity_check").fetchone()[0])
print("BACKUP=" + str(dest))
print("SIZE=" + str(dest.stat().st_size))
