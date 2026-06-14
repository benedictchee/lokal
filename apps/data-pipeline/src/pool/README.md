# Device Fetch Pool — Coordinator

Worker endpoints that let MDM-managed Android devices lease known URLs, return the
rendered DOM, and feed the existing pipeline. Spec:
`docs/superpowers/specs/2026-06-14-device-fetch-pool-design.md`.

## Endpoints (all require `Authorization: Bearer <device-token>`)

- `POST /pool/lease` — body `{ battery?, appForeground?, maxUrls? }` → `{ jobs: LeaseJob[] }`.
  One URL per host per batch (fleet pacing); honours per-URL `next_due` and host backoff.
- `POST /pool/results` — body `{ leaseId, status, challenge, gzippedDomBase64, timings }`.
  Stores the gzipped DOM in R2 (`pool/<urlhash>/<ts>.html.gz`), content-hashes it (`fnv1a`),
  updates the registry, and closes the lease. Idempotent per lease. `challenge` → host backoff.
- `POST /pool/heartbeat` — liveness; `{ ok: true }` when authenticated.

## State (in the `GROUPS` D1 database; migration `0003_pool.sql`)

- `pool_device` — device_id + SHA-256 of its token (raw token never stored).
- `pool_url_registry` — the curated URL list + change-detection state (content_hash, next_due, backoff).
- `pool_lease` — open/done/expired with a visibility timeout (`POOL.LEASE_TTL_SEC`).

## Provision a device + seed URLs

```
tsx scripts/pool-seed.ts <deviceId> <rawToken> <url> [url...] > seed.sql
wrangler d1 execute travel-groups --local --file=seed.sql   # drop --local for prod
```

## Tunables

See `src/pool/config.ts` (`POOL.*`): lease TTL, max URLs/lease, backoff base/cap, refresh interval.

## Not here

The Android pool app and MDM rollout are separate subsystems/plans. Target-URL governance
must respect the catalog tiers (`docs/research/travel-data-sources-catalog.md`): permitted,
IP-reputation-gated sources only — never red-tier.
