# Claude.md

Project memory for the travel marketplace monorepo. Loaded every session — keep
it short and high-signal.

## What this is

A travel marketplace built as a monorepo of **five subsystems**. Consumers
browse and purchase from merchants; merchants manage their accounts and SKUs; a
background pipeline scrapes and vectorizes data to power AI features.

| # | Subsystem | Path | Stack |
|---|-----------|------|-------|
| 1 | Consumer mobile app | `apps/consumer-app/` | Flutter + Shorebird (OTA updates) |
| 2 | Consumer API | `apps/consumer-api/` | Cloudflare Worker + D1 |
| 3 | Merchant API | `apps/merchant-api/` | Cloudflare Worker + D1 |
| 4 | Data pipeline | `apps/data-pipeline/` | Cloudflare Worker + Vectorize + Queues + cron |
| 5 | Merchant web console | `apps/merchant-web/` | Next.js static export + R2 |

See `Directory.md` for the full layout, `DataFormat.md` for the schema/RPC
contract, and `CICD.md` for the CircleCI pipeline.

## Non-negotiable conventions

- **`proto/` is the single source of truth** for all cross-subsystem data.
  Define a message once; never hand-roll a parallel JSON shape.
- **All inter-subsystem RPC uses the Connect protocol.** Clients: connect-dart
  (Flutter), connect-es (TS). Servers: connect-es on Workers.
- **Never hand-edit generated code** in `packages/proto-ts/` or
  `packages/proto-dart/`. Run `buf generate` instead.
- **Apps depend on `packages/*`, never on each other.**

## Baseline tooling

- **TS workspace:** pnpm workspaces (`apps/*` + `packages/*`), optional Turborepo.
- **Schema:** Buf (`buf generate`, `buf lint`, `buf breaking`).
- **Workers:** Wrangler per app (`infra/` + per-app `wrangler.jsonc`).
- **Mobile:** Flutter toolchain + Shorebird CLI (stands outside the pnpm workspace).
- **CI/CD:** CircleCI dynamic config — a setup pipeline maps changed paths to
  parameters, then runs only the affected subsystems. See `CICD.md`.

## Intended local workflow

> These are the target commands; they become real as each subsystem lands.

```
pnpm install            # install TS workspace deps
buf generate            # regenerate proto-ts + proto-dart from proto/
pnpm --filter <app> dev # run a Worker / Next.js app locally (wrangler dev / next dev)
cd apps/consumer-app && flutter run   # run the mobile app
```

## Status

Greenfield, in planning. Subsystems are designed and built one at a time, each
with its own spec → plan → implementation cycle. No build order is fixed yet —
that is the next decision.
