# n8n vars probe (isolated + shared status)

- Isolated health: up
- Prod JSON uses `$vars` only: checked
- Concierge variables in isolated DB: CONCIERGE_INTERNAL_SECRET:len=48, HOMESTEAD_INTERNAL_BASE:len=21
- Shared 2.3.6 live resolve: **BLOCKED** this session (SSH). Script ready: `deploy/vps/verify-n8n-vars-readonly.sh`
- Secrets: never printed; store in n8n Variables / protected env — not workflow JSON
