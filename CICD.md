# CI/CD — CircleCI

The whole monorepo is one CircleCI project. The challenge is that it holds five
subsystems in different languages; we never want a Dart change to rebuild the
Workers, or a single Worker change to rebuild everything. CircleCI's **dynamic
configuration** solves this cleanly.

## How it works: two-layer dynamic config

1. **Setup pipeline** — `.circleci/config.yml` (`setup: true`). It does no real
   work. It runs the [`circleci/path-filtering`](https://circleci.com/developer/orbs/orb/circleci/path-filtering)
   orb, which inspects the changed files and sets one boolean **pipeline
   parameter** per subsystem.
2. **Continuation pipeline** — `.circleci/continue-config.yml`. `path-filtering`
   (via the `continuation` orb under the hood) hands control here with those
   parameters set. Each workflow has a `when:` guard, so only the affected
   subsystems run.

```
push ─▶ config.yml (setup) ─▶ path-filtering maps changed paths to params
                                      │
                                      ▼
                            continue-config.yml
              ┌──────────┬──────────┬──────────┬──────────┬──────────┐
           proto?    consumer-api?  merchant-api?  data-pipeline?  web?  app?
              ▼          ▼            ▼              ▼            ▼      ▼
           buf lint/   lint/test/   lint/test/    lint/test/   build/  flutter/
           breaking    deploy       deploy        deploy       deploy  shorebird
```

## Path → parameter mapping

| Changed path (regex) | Pipeline parameter | Runs |
|----------------------|--------------------|------|
| `proto/.*` | `proto_changed` | `buf lint` + `buf breaking` + `buf generate` drift check |
| `packages/.*` | `packages_changed` | all TS apps (shared code) |
| `apps/consumer-api/.*` | `consumer_api_changed` | consumer-api lint/test/deploy |
| `apps/merchant-api/.*` | `merchant_api_changed` | merchant-api lint/test/deploy |
| `apps/data-pipeline/.*` | `data_pipeline_changed` | data-pipeline lint/test/deploy |
| `apps/merchant-web/.*` | `merchant_web_changed` | Next.js build + R2 deploy |
| `apps/consumer-app/.*` | `consumer_app_changed` | flutter test/build + Shorebird |

### Fan-out rule (the important part)

`proto/` and `packages/` are upstream of the TS apps. A change there must
rebuild every dependent. So each TS app's workflow guard is an **OR**:

```
when: proto_changed OR packages_changed OR <this_app>_changed
```

This is the single rule that keeps a polyglot monorepo correct: shared changes
fan out, isolated changes stay isolated.

## Per-language toolchains (executors)

| Job | Executor | Toolchain |
|-----|----------|-----------|
| proto checks | Docker `bufbuild/buf` (or `cimg/base` + buf) | Buf CLI |
| Workers (consumer-api, merchant-api, data-pipeline) | Docker `cimg/node` | pnpm + Wrangler |
| merchant-web | Docker `cimg/node` | pnpm + Next.js + Wrangler |
| consumer-app (test/Android) | Docker `cimg/android` + `circleci/flutter` orb | Flutter SDK + Gradle + Shorebird CLI |
| consumer-app (iOS) | `macos` executor + Xcode | Flutter SDK + Fastlane + Shorebird CLI |

## Deploy gating & secrets

- **Branch gating:** test on every push; deploy Workers only from `main`.
- **Mobile releases** run on git tags (e.g. `app-v*`), not every push.
- **Secrets via CircleCI Contexts**, not in config:
  - `cloudflare` context → `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
  - `shorebird` context → `SHOREBIRD_TOKEN`
  - `mobile-signing` context → Android keystore / iOS signing material
- **Workers deploy** = `wrangler deploy` per app; **merchant-web** = static
  export → R2 (`wrangler deploy` of the static-asset Worker).

## Caching

- pnpm store keyed on `pnpm-lock.yaml` (handled by the `circleci/node` orb).
- Dart `.pub-cache` and Gradle caches for the Flutter jobs.

## Why this stays maintainable

Adding a sixth subsystem is mechanical: add one `mapping` line in
`config.yml`, one parameter + one guarded workflow in `continue-config.yml`.
No existing job changes. Each subsystem keeps its own executor and toolchain, so
languages never collide.

See `.circleci/config.yml` (setup) and `.circleci/continue-config.yml`
(continuation) for the baseline implementation.
