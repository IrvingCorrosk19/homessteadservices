#!/bin/sh
# Read-only preflight for Concierge n8n go-live. Never prints secret values.
# Does not import/activate workflows, restart containers, or mutate DB.
set -eu

echo "=== CONCIERGE N8N PREFLIGHT (readonly) ==="
echo "at=$(TZ=America/Panama date -Iseconds)"

echo ""
echo "--- containers ---"
docker ps --filter name=homestead_web --format '{{.Names}} {{.Status}}' || true
docker ps --filter name=n8n_n8n --format '{{.Names}} {{.Status}} {{.Image}}' || true

echo ""
echo "--- homestead flag keys (presence only) ---"
docker exec homestead_web sh -c '
  for k in AI_CONCIERGE_ENABLED AI_CONCIERGE_ENGINE AI_CONCIERGE_N8N_MODE AI_CONCIERGE_DRY_RUN AI_CONCIERGE_CREATE_LEADS AI_CONCIERGE_TURN_TIMEOUT_MS CONCIERGE_INTERNAL_SECRET N8N_CONCIERGE_TURN_WEBHOOK_URL N8N_CONTROL_PUSH_WEBHOOK_URL N8N_HOMESTEAD_WEBHOOK_URL; do
    v=$(printenv "$k" 2>/dev/null || true)
    if [ -z "$v" ]; then
      echo "$k=MISSING"
    else
      case "$k" in
        *SECRET*|*TOKEN*|*PASS*)
          len=$(printf %s "$v" | wc -c | tr -d " ")
          echo "$k=SET len=$len"
          ;;
        N8N_CONCIERGE_TURN_WEBHOOK_URL|N8N_CONTROL_PUSH_WEBHOOK_URL|N8N_HOMESTEAD_WEBHOOK_URL)
          # host/path only — strip query; never dump credentials
          echo "$k=SET hostpath=$(printf %s "$v" | sed -E "s#^[a-z]+://##; s#[?#].*##")"
          ;;
        *)
          echo "$k=$v"
          ;;
      esac
    fi
  done
'

echo ""
echo "--- webhook path collision check (n8n postgres, names only) ---"
docker exec n8n_postgres psql -U n8nuser -d n8n -tAc "
SELECT COALESCE(w.name,'(no-name)'), COALESCE(webhook_path,'(none)'), w.active
FROM workflow_entity w
LEFT JOIN webhook_entity wh ON wh.\"workflowId\" = w.id
WHERE COALESCE(webhook_path,'') ILIKE '%concierge%'
   OR COALESCE(w.name,'') ILIKE '%concierge%'
ORDER BY 1;
" 2>/dev/null || echo "WARN: could not query webhook_entity (schema may differ)"

echo ""
echo "--- other homestead webhooks (must remain untouched) ---"
docker exec n8n_postgres psql -U n8nuser -d n8n -tAc "
SELECT COALESCE(w.name,'(no-name)'), COALESCE(webhook_path,'(none)'), w.active
FROM workflow_entity w
LEFT JOIN webhook_entity wh ON wh.\"workflowId\" = w.id
WHERE COALESCE(webhook_path,'') ILIKE '%homestead%'
ORDER BY 1;
" 2>/dev/null | head -40 || true

echo ""
echo "--- engine pin distribution (counts only) ---"
docker exec homestead_web node -e '
const Database=require("better-sqlite3");
const db=new Database("/app/data/homestead.sqlite");
const cols=db.prepare("PRAGMA table_info(concierge_conversations)").all().map(c=>c.name);
console.log("has_engine_col="+cols.includes("engine"));
if (cols.includes("engine")) {
  const rows=db.prepare("SELECT COALESCE(NULLIF(TRIM(engine),\"\"),\"(empty)\") AS e, COUNT(*) AS n FROM concierge_conversations GROUP BY 1 ORDER BY 2 DESC").all();
  console.log(JSON.stringify(rows));
} else {
  console.log("engine_col=absent (migration runs on first n8n turn code path)");
}
db.close();
' 2>/dev/null || echo "WARN: sqlite inspect failed"

echo ""
echo "--- connectivity homestead_web → n8n (TCP only) ---"
docker exec homestead_web sh -c 'wget -qO- --timeout=3 http://n8n:5678/healthz 2>/dev/null || wget -qO- --timeout=3 http://n8n_n8n:5678/healthz 2>/dev/null || echo N8N_HEALTH_UNREACHABLE'

echo ""
echo "--- connectivity n8n → homestead_web (TCP only) ---"
docker exec n8n_n8n sh -c 'wget -qO- --timeout=3 http://homestead_web:3000/api/health 2>/dev/null || echo HOMESTEAD_HEALTH_UNREACHABLE'

echo ""
echo "PREFLIGHT_DONE"
echo "Next: see docs/DEPLOY/HOMESTEAD-CONCIERGE-N8N-GO-LIVE.md — do not flip AI_CONCIERGE_ENGINE yet."
