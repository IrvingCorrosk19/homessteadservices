#!/usr/bin/env python3
"""In-place n8n update using base64 JSON so $vars in nodes cannot break SQL."""
import base64
import json
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path

KEEP = {
    "HOMESTEAD — Content Scheduler": {
        "id": "nGiCm9Yt3PzPzDP9",
        "file": "/opt/apps/homestead/n8n/homestead-n8n-content-scheduler.json",
    },
    "HOMESTEAD — Marketing Analytics Collector": {
        "id": "ZiQfUIPtEq3RsqVW",
        "file": "/opt/apps/homestead/n8n/homestead-n8n-analytics-collector.json",
    },
    "HOMESTEAD — Weekly Marketing Report": {
        "id": "aSGBqm6D5SjSsYGL",
        "file": "/opt/apps/homestead/n8n/homestead-n8n-weekly-report.json",
    },
}


def psql(sql: str) -> str:
    return subprocess.check_output(
        [
            "docker",
            "exec",
            "-i",
            "n8n_postgres",
            "psql",
            "-U",
            "n8nuser",
            "-d",
            "n8n",
            "-v",
            "ON_ERROR_STOP=1",
            "-At",
            "-c",
            sql,
        ],
        text=True,
    ).strip()


def b64(data: object) -> str:
    raw = json.dumps(data, ensure_ascii=False).encode("utf-8")
    return base64.b64encode(raw).decode("ascii")


stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
backup_dir = Path(f"/opt/backups/n8n/content-inplace-{stamp}")
backup_dir.mkdir(parents=True, exist_ok=True)
print("BACKUP_DIR", backup_dir)

before = psql(
    "SELECT id||'|'||name||'|'||active FROM workflow_entity WHERE name ILIKE '%HOMESTEAD%' ORDER BY name;"
)
print("BEFORE\n" + before)
(backup_dir / "before.txt").write_text(before + "\n", encoding="utf-8")

for name, meta in KEEP.items():
    n = int(psql(f"SELECT COUNT(*) FROM workflow_entity WHERE name = '{name}';") or "0")
    if n != 1:
        raise SystemExit(f"REFUSE count {name}={n}")
    live_id = psql(f"SELECT id FROM workflow_entity WHERE name = '{name}';")
    if live_id != meta["id"]:
        raise SystemExit(f"REFUSE id {name} live={live_id}")
    src = json.loads(Path(meta["file"]).read_text(encoding="utf-8"))
    if src.get("name") != name:
        raise SystemExit("JSON name mismatch")
    Path(backup_dir / f"{meta['id']}-nodes-pre.json").write_text(
        psql(f"SELECT nodes::text FROM workflow_entity WHERE id='{meta['id']}';"),
        encoding="utf-8",
    )
    version_id = str(uuid.uuid4())
    nodes_b64 = b64(src["nodes"])
    conn_b64 = b64(src["connections"])
    sql = f"""
BEGIN;
INSERT INTO workflow_history ("versionId","workflowId",authors,"createdAt","updatedAt",nodes,connections,name,autosaved)
VALUES (
  '{version_id}',
  '{meta['id']}',
  '',
  NOW(),
  NOW(),
  convert_from(decode('{nodes_b64}','base64'),'UTF8')::json,
  convert_from(decode('{conn_b64}','base64'),'UTF8')::json,
  '{name}',
  false
);
UPDATE workflow_entity SET
  nodes = convert_from(decode('{nodes_b64}','base64'),'UTF8')::json,
  connections = convert_from(decode('{conn_b64}','base64'),'UTF8')::json,
  "versionId" = '{version_id}',
  "activeVersionId" = '{version_id}',
  "versionCounter" = "versionCounter" + 1,
  active = true,
  "updatedAt" = NOW()
WHERE id = '{meta['id']}' AND name = '{name}';
COMMIT;
"""
    sql_path = Path(f"/tmp/n8n-update-{meta['id']}.sql")
    sql_path.write_text(sql, encoding="utf-8")
    subprocess.check_call(["docker", "cp", str(sql_path), f"n8n_postgres:/tmp/n8n-update-{meta['id']}.sql"])
    subprocess.check_call(
        [
            "docker",
            "exec",
            "n8n_postgres",
            "psql",
            "-U",
            "n8nuser",
            "-d",
            "n8n",
            "-v",
            "ON_ERROR_STOP=1",
            "-f",
            f"/tmp/n8n-update-{meta['id']}.sql",
        ]
    )
    print("UPDATED", name, "version", version_id)
    pub = subprocess.run(
        [
            "docker",
            "exec",
            "-u",
            "node",
            "n8n_n8n",
            "n8n",
            "publish:workflow",
            f"--id={meta['id']}",
            f"--versionId={version_id}",
        ],
        text=True,
        capture_output=True,
    )
    print("PUBLISH", name, pub.returncode)
    if pub.returncode != 0:
        print((pub.stdout or "")[-400:])
        print((pub.stderr or "")[-400:])

after = psql(
    "SELECT id||'|'||name||'|'||active FROM workflow_entity WHERE name ILIKE '%HOMESTEAD%' ORDER BY name;"
)
print("AFTER\n" + after)
if after.count("HOMESTEAD") != 5:
    raise SystemExit("UNEXPECTED HOMESTEAD WORKFLOW COUNT")
for name, meta in KEEP.items():
    nodes_now = psql(f"SELECT nodes::text FROM workflow_entity WHERE id='{meta['id']}';")
    if "Normalizar respuesta" not in nodes_now:
        raise SystemExit(f"MISSING NORM NODE {name}")
    still = psql(f"SELECT id FROM workflow_entity WHERE name = '{name}';")
    if still != meta["id"]:
        raise SystemExit(f"ID CHANGED {name}")
    n = int(psql(f"SELECT COUNT(*) FROM workflow_entity WHERE name = '{name}';"))
    if n != 1:
        raise SystemExit(f"DUPLICATE {name}")
print("N8N_INPLACE_OK")
