# BACKUP MANIFEST — pre Marketing Intelligence Engine

DATE: 2026-08-20T21:14 America/Panama

PRE_IMPLEMENTATION_BACKUP = PASS

## Git

- BRANCH: `main`
- HEAD (freeze): `cb266eade08253ff0e1a2b2dc8cec8b9997bc816`
- BACKUP BRANCH: `backup/pre-marketing-intelligence-20260820-2114`
- BACKUP TAG: `pre-marketing-intelligence-20260820-2114`
- PUSH: PASS (no force)

Untracked junk in repo root was **not** committed.

Restore: `git checkout pre-marketing-intelligence-20260820-2114`

## n8n (VPS, chmod 600, not in Git)

- `/opt/backups/pre-marketing-intelligence-20260820-2114/`
- Workflows exported: 14
- Dump `pg_restore -l`: 359 entries
- Telegram webhook path unchanged: `homestead-content-studio`

Homestead workflows preserved (not replaced):

| Name | Active |
| --- | --- |
| HOMESTEAD — Nueva solicitud → Telegram | yes |
| HOMESTEAD — Content Studio | yes |
| HOMESTEAD — Content Scheduler | yes (created earlier; not deleted) |

## Homestead SQLite / storage

- SQLite integrity: ok
- service_requests: 22
- content_jobs: 5
- photos files: 20
- content files: 41
- Instagram / Facebook tokens: NOT CONFIGURED

## Previous freezes (kept)

- `pre-smart-content-autopilot-20260820-2024` @ `68646eb`
- `pre-content-studio-v1-20260820-1916` @ `64b6f8c`

---

# BACKUP MANIFEST — pre Smart Content Autopilot


DATE: 2026-08-20T20:25:45-05:00 (America/Panama)

## Git

- BRANCH: `main`
- HEAD: `68646eb5b0081f0e759ebbdfdda804e25a914e61`
- BACKUP BRANCH: `backup/pre-smart-content-autopilot-20260820-2024`
- BACKUP TAG: `pre-smart-content-autopilot-20260820-2024`
- PUSH: PASS (no force)
- Uncommitted tracked changes: none
- Untracked junk (not committed): pdf / mp4 / docx / png / csv in repo root

Previous freeze (kept): tag `pre-content-studio-v1-20260820-1916` @ `64b6f8c`

No extra `chore(backup)` commit: working tree of tracked files was already clean at HEAD.

## n8n

- Engine: PostgreSQL (`n8n_postgres`), n8n 2.3.6
- Dump: `/opt/backups/pre-smart-content-autopilot-20260820-2025/n8n/n8n.dump` (185235 bytes, `pg_restore -l` = 359 entries, chmod 600, **not in Git**)
- Workflow export: same folder `n8n/workflow-export/all-workflows.json` (13 workflows, **VPS only**)
- Names index in Git: `backups/n8n/2026-08-20-2025/workflow-names.json`

Homestead workflows (do not replace):

| Name | Active | Webhook |
| --- | --- | --- |
| HOMESTEAD — Nueva solicitud → Telegram | yes | `homestead-service-request` |
| HOMESTEAD — Content Studio | yes | `homestead-content-studio` |

Other n8n workflows (BrokerPro / tests / inactive): not modified. `9TG_GATEWAY_V1` remains inactive.

## Database backup

- Homestead SQLite: `/opt/backups/pre-smart-content-autopilot-20260820-2025/homestead/homestead.sqlite`
- Integrity: ok
- service_requests: 21
- content_jobs: 4 (`HC-2026-000001` REJECTED, `000002` APPROVED, `000003` REJECTED, `000004` APPROVED)

## Image storage

- Live photos: `/opt/apps/homestead/data/photos` (20 files, ~12 MB)
- Live content: `/opt/apps/homestead/data/content` (35 files, ~28 MB)
- Inventory: `backups/n8n/2026-08-20-2025/storage-inventory.json`
- Copies: `photos.tar` + `content.tar` in the VPS backup folder

## Docker

- Homestead compose: `/opt/apps/homestead/deploy/vps/docker-compose.yml`
- Volume: `/opt/apps/homestead/data` → `/app/data`
- Container: `homestead_web` 127.0.0.1:3091

## Telegram / OpenAI / Meta

- Bot webhook: `n8n.autonomousflow.lat/webhook/homestead-content-studio` (pending 0)
- TELEGRAM_BOT_TOKEN: CONFIGURED
- TELEGRAM_WEBHOOK_SECRET: CONFIGURED
- OPENAI_API_KEY: CONFIGURED
- INSTAGRAM: NOT CONFIGURED
- FACEBOOK: NOT CONFIGURED

Homestead `.env` keys (values omitted): all present keys CONFIGURED. No Meta keys.

n8n variables: `TELEGRAM_BOT_TOKEN`, `HOMESTEAD_WEBHOOK_SECRET`, `TELEGRAM_WEBHOOK_SECRET`, `HOMESTEAD_TELEGRAM_CHAT_ID` = CONFIGURED.

## Env template

Repo: `.env.example` (no secrets).

## Restore instructions

1. Git: `git checkout pre-smart-content-autopilot-20260820-2024` (or SHA `68646eb`). Rebuild only `homestead_web`. **Do not delete** `/opt/apps/homestead/data`.
2. SQLite: restore `homestead.sqlite` from the VPS backup dir via Python `sqlite3.backup()` into `/opt/apps/homestead/data/homestead.sqlite` (container stopped or brief).
3. Photos/content: extract `photos.tar` / `content.tar` into `/opt/apps/homestead/data/` if files were lost.
4. n8n: `pg_restore` of `n8n.dump` into `n8n` DB, or reimport `n8n/homestead-n8n-telegram-workflow.json` and `n8n/homestead-n8n-content-studio.json`. Do not activate `9TG_GATEWAY_V1`. Recreate only Homestead webhooks.
5. Secrets stay in VPS `.env` / n8n variables; they were never in Git.

## Verification

| Check | Result |
| --- | --- |
| Workflow JSON valid | PASS (13 exported) |
| n8n dump non-empty | PASS (359 entries) |
| SQLite integrity | PASS |
| Git tag/branch = HEAD | PASS (`68646eb`) |
| Storage inventory | PASS |
| Manifest | PASS |

BACKUP VERIFIED = PASS
