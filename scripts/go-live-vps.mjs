#!/usr/bin/env node
/**
 * Controlled go-live VPS orchestration helper.
 * Run locally; connects via SSH env vars (never logs secret values).
 *
 * Required env:
 *   HOMESTEAD_VPS_HOST (default root@164.68.99.83)
 *   HOMESTEAD_VPS_PASSWORD
 *   HOMESTEAD_VPS_HOSTKEY (optional)
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const evidenceDir = join(root, "data", "go-live-cert");
mkdirSync(evidenceDir, { recursive: true });

const host = process.env.HOMESTEAD_VPS_HOST || "root@164.68.99.83";
const password = process.env.HOMESTEAD_VPS_PASSWORD || "";
const hostkey =
  process.env.HOMESTEAD_VPS_HOSTKEY ||
  "ssh-ed25519 SHA256:fXnxiWr5sqazM3xRId7HtcseAZ0XHcJ2BBIuPsLt2J0";
const plink =
  process.platform === "win32"
    ? "C:\\Program Files\\PuTTY\\plink.exe"
    : "plink";
const pscp =
  process.platform === "win32"
    ? "C:\\Program Files\\PuTTY\\pscp.exe"
    : "pscp";

function fail(msg) {
  console.error("GO_LIVE_FAIL", msg);
  process.exit(1);
}

if (!password) fail("HOMESTEAD_VPS_PASSWORD required");

function remote(cmd, label) {
  const args = ["-ssh", `-pw`, password, "-batch", "-hostkey", hostkey, host, cmd];
  const r = spawnSync(plink, args, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  const out = `${r.stdout || ""}${r.stderr || ""}`.trim();
  writeFileSync(join(evidenceDir, `${label}.log`), out);
  if (r.status !== 0) {
    console.error(label, "REMOTE_FAIL", r.status);
    console.error(out.slice(0, 2000));
    process.exit(1);
  }
  return out;
}

function upload(local, remotePath) {
  const args = ["-pw", password, "-batch", "-hostkey", hostkey, local, `${host}:${remotePath}`];
  const r = spawnSync(pscp, args, { encoding: "utf8" });
  if (r.status !== 0) fail(`upload ${remotePath}`);
}

const wave = process.argv[2] || "snapshot";

if (wave === "snapshot") {
  const out = remote(
    `set -e
echo "=== SNAPSHOT $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
docker ps --filter name=homestead_web --format 'CONTAINER {{.Names}} {{.Status}} {{.Image}}'
docker inspect homestead_web --format 'MOUNT {{range .Mounts}}{{.Source}}:{{.Destination}} {{end}}' 2>/dev/null || echo MOUNT unknown
curl -sS -o /dev/null -w 'LOOPBACK_HOME %{http_code}\\n' http://127.0.0.1:3091/ || true
curl -sS -o /dev/null -w 'LOOPBACK_HEALTH %{http_code}\\n' http://127.0.0.1:3091/api/health 2>/dev/null || echo 'LOOPBACK_HEALTH missing'
curl -sS -o /dev/null -w 'LOOPBACK_READY %{http_code}\\n' http://127.0.0.1:3091/api/ready 2>/dev/null || echo 'LOOPBACK_READY missing'
curl -sS -o /dev/null -w 'HTTPS_HOME %{http_code}\\n' https://homestead.lat/ || true
python3 - <<'PY'
import sqlite3, os, hashlib
db='/opt/apps/homestead/data/homestead.sqlite'
if not os.path.exists(db):
    print('DB missing')
    raise SystemExit(1)
con=sqlite3.connect(f'file:{db}?mode=ro', uri=True)
print('INTEGRITY', con.execute('PRAGMA integrity_check').fetchone()[0])
for t,s in [
 ('service_requests','SELECT COUNT(*) FROM service_requests'),
 ('revenue_leads','SELECT COUNT(*) FROM revenue_leads'),
 ('revenue_appointments','SELECT COUNT(*) FROM revenue_appointments'),
 ('operational_signals','SELECT COUNT(*) FROM operational_signals WHERE status=\\'OPEN\\''),
 ('automation_outbox_pending','SELECT COUNT(*) FROM automation_outbox WHERE status=\\'PENDING\\''),
 ('automation_outbox_failed','SELECT COUNT(*) FROM automation_outbox WHERE status=\\'FAILED\\''),
 ('test_leads','SELECT COUNT(*) FROM revenue_leads WHERE is_test=1'),
]:
    try: print(t.upper(), con.execute(s).fetchone()[0])
    except Exception as e: print(t.upper(), 'ERR')
h=hashlib.sha256(open(db,'rb').read()).hexdigest()
print('DB_SHA256', h[:16]+'…')
con.close()
PY
if [ -f /opt/apps/homestead/deploy/vps/.env ]; then
  echo ENV_KEYS
  awk -F= '/^[A-Za-z_][A-Za-z0-9_]*=/{print $1}' /opt/apps/homestead/deploy/vps/.env | sort
fi
`,
    "pre-snapshot",
  );
  console.log(out);
  console.log("SNAPSHOT_OK");
}

if (wave === "env-audit") {
  const out = remote(
    `python3 - <<'PY'
import re, pathlib
p=pathlib.Path('/opt/apps/homestead/deploy/vps/.env')
req=[
 'ADMIN_PASSWORD','ADMIN_SESSION_SECRET','OPENAI_API_KEY','DATA_DIR',
 'TELEGRAM_BOT_TOKEN','HOMESTEAD_TELEGRAM_CHAT_ID','N8N_HOMESTEAD_WEBHOOK_URL',
 'N8N_HOMESTEAD_WEBHOOK_SECRET','SMTP_HOST','SMTP_USER','SMTP_PASS',
 'CONTENT_DRY_RUN','AI_CONCIERGE_DRY_RUN','REVENUE_ENGINE_DRY_RUN',
 'AUTONOMOUS_OPERATIONS_DRY_RUN','AUTONOMOUS_LOW_RISK_ACTIONS_ENABLED',
 'AUTONOMOUS_OPERATIONS_ENABLED','NEXT_PUBLIC_SITE_URL'
]
vals={}
if p.exists():
    for line in p.read_text().splitlines():
        if '=' in line and not line.strip().startswith('#'):
            k,v=line.split('=',1)
            vals[k.strip()]=v.strip()
for k in req:
    v=vals.get(k,'')
    if not v:
        print(k, 'MISSING')
    elif k=='ADMIN_SESSION_SECRET' and len(v)<32:
        print(k, 'INVALID_FORMAT')
    else:
        print(k, 'PRESENT')
PY`,
    "env-audit",
  );
  console.log(out);
}

if (wave === "backup") {
  const out = remote(
    `set -e
STAMP=20260831-golive-pre
DEST=/opt/backups/$STAMP
mkdir -p "$DEST"
python3 -c "import sqlite3,shutil,json,hashlib,os; from datetime import datetime,timezone; dest='/opt/backups/20260831-golive-pre'; os.makedirs(dest,exist_ok=True); src='/opt/apps/homestead/data/homestead.sqlite'; dst=dest+'/homestead.sqlite'; s=sqlite3.connect(src); d=sqlite3.connect(dst); s.backup(d); s.close(); d.close(); c=sqlite3.connect(dst); integrity=c.execute('PRAGMA integrity_check').fetchone()[0]; counts=dict((t,c.execute('SELECT COUNT(*) FROM '+t).fetchone()[0]) for t in ['service_requests','revenue_leads','revenue_appointments']); c.close(); sha=hashlib.sha256(open(dst,'rb').read()).hexdigest(); open(dest+'/manifest.json','w').write(json.dumps({'at':datetime.now(timezone.utc).isoformat(),'integrity':integrity,'counts':counts,'sha256_prefix':sha[:16]}));
import os,shutil
for d in ['photos','content','concierge','jobs']:
 p='/opt/apps/homestead/data/'+d
 if os.path.isdir(p): shutil.copytree(p, dest+'/'+d, dirs_exist_ok=True)
print('BACKUP_OK',dest,integrity,counts)"
ls -lh "$DEST"
`,
    "pre-backup",
  );
  console.log(out);
  if (!out.includes("BACKUP_OK") || !out.includes("ok")) fail("backup verification failed");
  console.log("BACKUP_OK");
}

if (wave === "deploy") {
  const archive = process.argv[3];
  if (!archive || !existsSync(archive)) fail("deploy requires archive path");
  const hash = createHash("sha256").update(readFileSync(archive)).digest("hex");
  writeFileSync(join(evidenceDir, "artifact-sha256.txt"), hash);
  console.log("ARTIFACT_SHA256", hash);
  upload(archive, "/tmp/homestead-deploy.tar.gz");
  const out = remote(
    `set -e
mkdir -p /opt/apps/homestead
tar -xzf /tmp/homestead-deploy.tar.gz -C /opt/apps/homestead
rm -f /tmp/homestead-deploy.tar.gz
test -f /opt/apps/homestead/src/app/api/health/route.ts
test -f /opt/apps/homestead/scripts/production-backup.mjs
cd /opt/apps/homestead/deploy/vps
export NEXT_PUBLIC_SITE_URL=https://homestead.lat
docker compose --project-name homestead build homestead_web
docker rm -f homestead_web 2>/dev/null || true
docker compose --project-name homestead up -d homestead_web
sleep 8
curl -sS -o /dev/null -w 'HEALTH %{http_code}\\n' http://127.0.0.1:3091/api/health
curl -sS http://127.0.0.1:3091/api/ready | head -c 500; echo
docker ps --filter name=homestead_web --format 'STATUS {{.Names}} {{.Status}}'
`,
    "deploy",
  );
  console.log(out);
  console.log("DEPLOY_OK");
}

if (wave === "post-backup") {
  const out = remote(
    `set -e
DEST=/opt/backups/20260831-golive-post
mkdir -p "$DEST"
python3 -c "import sqlite3,shutil,json,hashlib,os; from datetime import datetime,timezone; dest='/opt/backups/20260831-golive-post'; os.makedirs(dest,exist_ok=True); src='/opt/apps/homestead/data/homestead.sqlite'; dst=dest+'/homestead.sqlite'; s=sqlite3.connect(src); d=sqlite3.connect(dst); s.backup(d); s.close(); d.close(); c=sqlite3.connect(dst); integrity=c.execute('PRAGMA integrity_check').fetchone()[0]; counts=dict((t,c.execute('SELECT COUNT(*) FROM '+t).fetchone()[0]) for t in ['service_requests','revenue_leads','revenue_appointments']); c.close(); open(dest+'/manifest.json','w').write(json.dumps({'at':datetime.now(timezone.utc).isoformat(),'integrity':integrity,'counts':counts})); 
import os,shutil
for d in ['photos','content','concierge','jobs']:
 p='/opt/apps/homestead/data/'+d
 if os.path.isdir(p): shutil.copytree(p, dest+'/'+d, dirs_exist_ok=True)
print('POST_BACKUP_OK',dest,integrity)"
python3 -c "import sqlite3; c=sqlite3.connect('/opt/apps/homestead/data/homestead.sqlite'); c.execute(\\\"UPDATE revenue_leads SET is_test=1 WHERE lead_id IN ('HS-2026-000109','HS-2026-000110','HS-2026-000111')\\\"); c.execute(\\\"UPDATE service_requests SET name='HOMESTEAD GO-LIVE CANARY' WHERE public_id IN ('HS-2026-000109','HS-2026-000110','HS-2026-000111')\\\"); c.commit(); print('CANARY_CLEANUP_OK')\\\"
crontab -l 2>/dev/null | grep -i backup || echo BACKUP_CRON_NOT_CONFIGURED
ls -lh "$DEST" | head
`,
    "post-backup",
  );
  console.log(out);
  console.log("POST_BACKUP_OK");
}

if (wave === "post-check") {
  const out = remote(
    `set -e
curl -sS -o /dev/null -w 'HEALTH %{http_code}\\n' http://127.0.0.1:3091/api/health
curl -sS http://127.0.0.1:3091/api/ready
echo
curl -sS -o /dev/null -w 'HTTPS %{http_code}\\n' https://homestead.lat/
curl -sS -o /dev/null -w 'HTTPS_HEALTH %{http_code}\\n' https://homestead.lat/api/health
python3 - <<'PY'
import sqlite3
c=sqlite3.connect('file:/opt/apps/homestead/data/homestead.sqlite?mode=ro', uri=True)
print('POST_INTEGRITY', c.execute('PRAGMA integrity_check').fetchone()[0])
for t,s in [
 ('service_requests','SELECT COUNT(*) FROM service_requests'),
 ('revenue_leads','SELECT COUNT(*) FROM revenue_leads'),
 ('revenue_appointments','SELECT COUNT(*) FROM revenue_appointments'),
]:
 print(t.upper(), c.execute(s).fetchone()[0])
PY
`,
    "post-check",
  );
  console.log(out);
  console.log("POST_CHECK_OK");
}
