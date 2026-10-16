#!/bin/sh
# READ-ONLY verification that shared n8n 2.3.6 exposes $vars and Homestead
# workflows already resolve them. Does NOT import/activate/edit/delete workflows.
# Never prints secret values — only key names and value lengths.
set -eu

echo "=== n8n shared \$vars / credentials probe (readonly) ==="
echo "at=$(TZ=America/Panama date -Iseconds)"

echo ""
echo "--- version / block-env ---"
docker exec n8n_n8n n8n --version 2>/dev/null || docker exec n8n_n8n sh -c 'n8n --version' || true
docker exec n8n_n8n sh -c 'printenv N8N_BLOCK_ENV_ACCESS_IN_NODE N8N_VERSION GENERIC_TIMEZONE 2>/dev/null | sed "s/=.*/=SET/" || true'
# Print presence of block flag without assuming name
docker exec n8n_n8n sh -c 'printenv | awk -F= "/BLOCK_ENV|N8N_VERSION|GENERIC_TIMEZONE/{print \$1\"=SET\"}" | sort'

echo ""
echo "--- variables table (names + lengths only) ---"
docker exec n8n_postgres psql -U n8nuser -d n8n -v ON_ERROR_STOP=1 -c "
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'variables'
ORDER BY ordinal_position;
"

docker exec n8n_postgres psql -U n8nuser -d n8n -v ON_ERROR_STOP=1 -At -c "
SELECT 'VAR|' || COALESCE(key, id::text) || '|len=' || COALESCE(length(value::text),0)
FROM variables
ORDER BY 1;
" 2>/dev/null || docker exec n8n_postgres psql -U n8nuser -d n8n -At -c "
SELECT 'VAR|' || COALESCE(key, \"key\", id::text) || '|len=' || COALESCE(length(value::text),0)
FROM variables
ORDER BY 1;
"

echo ""
echo "--- credentials_entity count (no values) ---"
docker exec n8n_postgres psql -U n8nuser -d n8n -At -c "SELECT 'CREDENTIALS_COUNT=' || COUNT(*) FROM credentials_entity;"

echo ""
echo "--- Homestead workflows using \$vars (names only) ---"
docker exec n8n_postgres psql -U n8nuser -d n8n -At -c "
SELECT 'WF|' || id || '|' || name || '|active=' || active || '|vars_refs=' ||
  (CASE WHEN nodes::text LIKE '%\$vars.%' THEN 'yes' ELSE 'no' END) || '|env_refs=' ||
  (CASE WHEN nodes::text LIKE '%\$env.%' THEN 'yes' ELSE 'no' END)
FROM workflow_entity
WHERE name ILIKE 'HOMESTEAD%'
ORDER BY name;
"

echo ""
echo "--- required vars for Concierge (presence) ---"
docker exec n8n_postgres psql -U n8nuser -d n8n -At -c "
SELECT 'NEED|' || k || '|' || CASE WHEN EXISTS (
  SELECT 1 FROM variables v
  WHERE COALESCE(v.key, '') = k AND COALESCE(length(v.value::text),0) > 0
) THEN 'PRESENT' ELSE 'MISSING' END
FROM (VALUES
  ('HOMESTEAD_WEBHOOK_SECRET'),
  ('TELEGRAM_BOT_TOKEN'),
  ('TELEGRAM_WEBHOOK_SECRET'),
  ('HOMESTEAD_TELEGRAM_CHAT_ID'),
  ('CONCIERGE_INTERNAL_SECRET'),
  ('HOMESTEAD_INTERNAL_BASE')
) AS t(k);
"

echo ""
echo "--- proof \$vars resolve in live Homestead path (exec success, no payloads) ---"
docker exec n8n_postgres psql -U n8nuser -d n8n -At -c "
SELECT 'EXEC|' || w.name || '|status=' || e.status || '|finished=' || COALESCE(e.\"finished\"::text,'') || '|at=' || COALESCE(e.\"startedAt\"::text,'')
FROM execution_entity e
JOIN workflow_entity w ON w.id = e.\"workflowId\"
WHERE w.name ILIKE 'HOMESTEAD%'
  AND e.status IN ('success','error')
ORDER BY e.\"startedAt\" DESC NULLS LAST
LIMIT 8;
"

echo ""
echo "--- concierge webhook collision ---"
docker exec n8n_postgres psql -U n8nuser -d n8n -At -c "
SELECT 'HOOK|' || COALESCE(webhook_path,'(none)') || '|wf=' || COALESCE(w.name,'?')
FROM webhook_entity wh
LEFT JOIN workflow_entity w ON w.id = wh.\"workflowId\"
WHERE COALESCE(webhook_path,'') ILIKE '%concierge%'
   OR COALESCE(w.name,'') ILIKE '%concierge%';
SELECT 'HOOK_COUNT_CONCIERGE=' || COUNT(*)
FROM webhook_entity wh
LEFT JOIN workflow_entity w ON w.id = wh.\"workflowId\"
WHERE COALESCE(webhook_path,'') ILIKE '%concierge%'
   OR COALESCE(w.name,'') ILIKE '%concierge%';
"

echo ""
echo "VARS_PROBE_DONE"
echo "Secrets never printed. Do not import Concierge workflow in this script."
