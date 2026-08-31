#!/usr/bin/env python3
import sqlite3
c = sqlite3.connect("/opt/apps/homestead/data/homestead.sqlite")
ids = ("HS-2026-000109", "HS-2026-000110", "HS-2026-000111")
c.execute(
    f"UPDATE revenue_leads SET is_test=1 WHERE lead_id IN ({','.join('?'*len(ids))})",
    ids,
)
c.execute(
    f"UPDATE service_requests SET name='HOMESTEAD GO-LIVE CANARY' WHERE public_id IN ({','.join('?'*len(ids))})",
    ids,
)
c.commit()
print("CANARY_CLEANUP_OK", ids)
