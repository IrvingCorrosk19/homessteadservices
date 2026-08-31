# Post-Go-Live 24-Hour Check

Run approximately **24 hours** after controlled go-live (America/Panama).

## Quick checks

```bash
curl -sS -o /dev/null -w 'health:%{http_code}\n' https://homestead.lat/api/health
curl -sS -o /dev/null -w 'ready:%{http_code}\n' https://homestead.lat/api/ready
curl -sS -o /dev/null -w 'home:%{http_code}\n' https://homestead.lat/
```

## VPS checks

```bash
docker ps --filter name=homestead_web
docker inspect homestead_web --format '{{.State.Status}} restarts={{.RestartCount}}'
df -h /opt/apps/homestead/data
ls -lt /opt/backups | head
python3 -c "import sqlite3; c=sqlite3.connect('file:/opt/apps/homestead/data/homestead.sqlite?mode=ro', uri=True); print('integrity', c.execute('PRAGMA integrity_check').fetchone()[0])"
```

## Operational

| Check | Pass criteria |
|-------|----------------|
| Health | HTTP 200 |
| Readiness | HTTP 200, database ok |
| Scheduler | `last_scheduler_at` < 2h stale |
| Outbox pending | < 50 or explainable |
| Outbox failed | 0 or investigated |
| Open signals | no storm (>20 unexplained) |
| Container restarts | 0 unexpected |
| Latest backup | < 26h old |
| HTTP 5xx in logs | none unexplained |

## External monitor

Confirm uptime monitor on `https://homestead.lat/api/health` is alerting if configured.

## Record

Update `docs/AUDIT/HOMESTEAD-POST-GO-LIVE-STABILIZATION-CERTIFICATION.md` section **Temporal Follow-Up** with date/time and results.
