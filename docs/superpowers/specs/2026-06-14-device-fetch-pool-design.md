# Device Fetch Pool — Design

> Status: **Draft for review** · Date: 2026-06-14 · Subsystem: `apps/data-pipeline`
> Author: brainstormed with Claude Code

## 1. Summary

Use the company's **60 MDM-managed (device-owner) Android devices** as a distributed,
best-effort **fetch transport** for the data pipeline. Each device pulls a small batch of
**known URLs** from a coordinator on the Cloudflare Worker, renders each in an **off-screen
WebView** (real mobile IP, real Chromium fingerprint), captures the **post-JavaScript DOM
text**, and pushes it back to the Worker. The Worker stores the raw payload and feeds it into
the **existing** extract → normalize → fingerprint → vectorize pipeline.

The device pool exists for exactly one reason: **sources that block datacenter IPs**
(DataDome / Cloudflare-managed bot management). Real mobile IPs + on-device Chromium are the
lever that the prototype's `FINDINGS.md` proved is required for those sources. Everything the
pipeline can already pull from the Worker (the open/bulk tier) stays on the Worker — the device
pool does **not** replace it.

## 2. Goals / Non-goals

**Goals**
- Refresh a **curated, known set of URLs** on a best-effort cadence from real mobile IPs.
- Be a **polite guest**: business operations on each device always take priority (battery first).
- Keep parsing **server-side** so connector/selector changes never require redeploying the app.
- Reuse the existing pipeline envelope (`PulledRecord` / `content_hash` / `sourceFingerprint`).

**Non-goals (this spec)**
- **No discovery / crawling.** One page, one visit per URL. (Possible later phase.)
- **No consumer-device fetching.** Captured separately in §12 as a gated follow-up.
- **No bulk ingestion** through devices — the open/bulk spine stays on DuckDB-over-Parquet.
- **No ToS circumvention of red-tier sources.** Target allowlist is governed by the catalog tiers
  (`docs/research/travel-data-sources-catalog.md`); permitted-but-IP-gated sources only.

## 3. Decisions captured (from brainstorming)

| Topic | Decision |
|-------|----------|
| Fleet | 60 devices, **mixed** use (some idle/dockable, some active business devices) |
| MDM | **Fully managed / device-owner** — silent install, managed config, battery-opt exemption, kiosk available |
| Targets | **Hard IP/fingerprint-gated sites** — requires WebView (JS execution) |
| Job nature | **Refresh a known URL set** (no discovery) |
| Execution model | **Option A** — overlay WebView inside a foreground service (kiosk mode a later opt-in flag) |
| Connectivity | **Metered/cellular as usual**, SIM assumed unlimited for now |
| Throttle | **Battery/business-priority only** — no data budget, no coordinator backpressure |
| Captured data | **Text only** — block images/CSS/fonts/media; **keep JS + its XHR/fetch**; capture post-JS DOM |
| Parsing | **Server-side** on the Worker (devices stay dumb) |

## 4. Architecture

```
┌─────────────────────────┐         ┌───────────────────────────────────────┐
│  Android Pool App         │ lease  │   Coordinator (data-pipeline Worker)   │
│  Kotlin · device-owner     │ ─────► │   POST /pool/lease                     │
│  60 devices                │        │   POST /pool/results                   │
│                            │ ◄───── │   POST /pool/heartbeat                 │
│  WorkManager (~15m floor)   │ jobs  │                                        │
│   └─ battery/guest gate      │       │   D1: url_registry + lease             │
│       └─ Foreground Service  │ ─────►│   R2: raw post-JS DOM (gzipped)        │
│           └─ off-screen      │ result└──────────────────┬─────────────────────┘
│              1px WebView      │                          │ existing pipeline
│               render 1 URL    │                         ▼
│               capture DOM text │       extract-critical-info → normalize →
│               upload            │      fingerprint → Vectorize (UNCHANGED)
└─────────────────────────┘
```

Two new components (coordinator endpoints + Android app); the downstream pipeline is untouched.

## 5. Coordinator (new endpoints on the existing Worker)

All endpoints require a per-device bearer token (see §9). JSON in/out; HTML payloads gzipped.

### `POST /pool/lease`
Request:
```jsonc
{ "deviceId": "dev-017", "battery": { "pct": 82, "charging": true },
  "appForeground": false, "maxUrls": 5 }
```
Response — up to `min(maxUrls, X_config)` jobs whose host is on the server allowlist:
```jsonc
{ "jobs": [
  { "leaseId": "lse_…", "url": "https://…", "host": "example.com",
    "engine": "webview", "waitForSelector": ".listing", "dwellMs": 4000 }
] }
```
Each job creates a `lease` row with a **visibility timeout** (default 5 min). The coordinator
applies **per-host global pacing** across the fleet — it will not hand the same host to many
devices at once, and it rotates which device draws which host.

### `POST /pool/results`
One call per completed lease (idempotent on `leaseId`):
```jsonc
{ "leaseId": "lse_…", "status": 200, "finalUrl": "https://…",
  "title": "…", "challenge": null, "gzippedDomBase64": "…",
  "timings": { "loadMs": 1830, "totalMs": 6120 } }
```
Worker stores the DOM payload in **R2** (`pool/<record_uuid>/<ts>.html.gz`), marks the lease
done, and enqueues the payload for the existing extractor. `challenge` (non-null) is recorded
and triggers host backoff (§8) instead of being treated as a successful fetch.

### `POST /pool/heartbeat`
Liveness + "skip me" signal (low battery / busy). Optional; lease visibility-timeout is the
real safety net.

## 6. Data model

**D1 — `url_registry`**: `url` (pk), `host`, `enabled`, `tier`, `last_fetched_at`,
`content_hash`, `next_due_at`, `consecutive_challenges`, `backoff_until`.

**D1 — `lease`**: `lease_id` (pk), `url`, `device_id`, `state` (`open`|`done`|`expired`),
`expires_at`, `created_at`.

**R2**: raw post-JS DOM, gzipped, keyed by `record_uuid` + timestamp. Text/markup only — no
images or styling ever transit or persist.

**Reused as-is**: `PulledRecord` / `content_hash` / `sourceFingerprint` and `looksLikeChallenge`
from `apps/data-pipeline/scripts/connectors/core/`, plus the entire downstream pipeline.

## 7. Android pool app (Kotlin, native)

Native (not Flutter): a headless background fetcher needs tight control of WorkManager,
WindowManager, and DevicePolicy, and there is no consumer UI.

**Why an off-screen WebView in a foreground service:** WebView is a UI View, not a headless
engine. To run JS and render reliably it must be attached to a window with a real surface; a
`WorkManager` worker has no window. So WorkManager *schedules*, a **foreground service** keeps
the process alive, and a **1px off-screen WebView attached via WindowManager** provides the real
surface. Requires `SYSTEM_ALERT_WINDOW`, allowlistable under device-owner — **verify the exact
grant path with the deployed MDM**. Android 14+ requires a declared foreground-service type.

**Per-URL render flow:** load → block non-text subresources (§ below) → wait for
`waitForSelector` / network-idle → dismiss consent banner + brief human dwell (porting the
philosophy in `scripts/connectors/core/browser.ts`) → capture
`document.documentElement.outerHTML` → upload → tear down WebView → next.

**Resource policy (`WebViewClient.shouldInterceptRequest`):**
- **Block:** images, CSS/stylesheets, fonts, media, known ad/analytics/tracker domains.
- **Keep:** JavaScript and its XHR/`fetch` — data is often populated by JS after first paint.
  Also keep first-party / bot-management JS (DataDome/Cloudflare challenge scripts load from
  their own domains; blocking them = instant fail).
- **Capture:** the post-JS DOM (text/markup). Blocking CSS removes styling bytes, not content.
- Reuse WebView disk cache for repeat static JS; abort once the target selector is present.

**Caveat:** blocking CSS very occasionally perturbs a site enough to matter, but the
anti-bot-relevant signals (JS execution, TLS fingerprint, real mobile IP) are all preserved, so
the risk is low. The framework's `looksLikeChallenge` detects when it does go wrong.

**Config via MDM managed config** (no rebuild to tune): coordinator URL, device token, `X`
(max URLs/lease), battery floor, charging-required flag, yield-to-foreground flag, host
allowlist mirror, render timeout.

## 8. Execution model — polite-guest cadence

The pool app is a **guest**; business operations always win. Throttle is **battery + device
state only** (SIM unlimited → no data budget, no backpressure).

**Per WorkManager wake (~15 min floor):**
1. Evaluate **favourable state**:
   - **Charging** → favourable (battery replenishing, device usually idle/docked); **or**
   - **On battery AND ≥ floor** (default 60%, managed-config) **AND** (by default) the business
     app is **not** in active foreground use.
2. **Not favourable → do nothing this cycle.** No lease, no render.
3. **Favourable →** lease up to **X** URLs, render + upload each, then stop the service.
4. **Stand down immediately** if, mid-batch, battery drops below floor, the charger is pulled, or
   the business app comes to the foreground.

All thresholds are managed-config so ops can tune per device role. Net effect: active business
phones contribute mostly while charging/idle (often overnight); dockable devices carry daytime
load. No central scheduler — each device self-selects.

## 9. Security

- **Per-device bearer token** provisioned via MDM managed config; rotatable via MDM.
- **Server-side host allowlist is also an SSRF guard:** the coordinator only ever leases URLs
  whose host is allowlisted, so a device can never be handed an arbitrary or internal URL and the
  app cannot be repurposed as an open proxy.
- Result payloads are **size-capped** and **content-type-checked** before R2 storage.
- TLS everywhere; R2 objects are private behind the Worker.

## 10. Error & resilience

- **Challenge walls** (`looksLikeChallenge`) are reported as `challenge`, never as success;
  the host gets **exponential backoff** (`backoff_until`) and repeated walls flag the source for
  partnership-or-skip review.
- **Dropped leases** (device crash/offline) are reclaimed by the **visibility timeout**.
- **Idempotent results** on `leaseId` so a network retry can't double-write.
- **Per-URL render timeout** (~25s, matching the connector default) prevents a hung WebView from
  stalling the batch.

## 11. Testing & rollout

- **Coordinator (Vitest, existing harness):** lease issuance, visibility-timeout reclaim,
  idempotent results, allowlist rejection, host backoff/pacing — all pure, no device needed.
- **Pipeline integration:** feed a captured DOM fixture through `/pool/results`; assert it lands
  in R2 and yields the right `PulledRecord` + `content_hash` via the existing extractor.
- **Android (instrumented, one device first):** overlay WebView attaches, renders a known
  JS-heavy page with non-text resources blocked, captures non-empty post-JS DOM, uploads.
  Validate the `SYSTEM_ALERT_WINDOW` grant + off-screen render path on real hardware before any
  fleet rollout.
- **Staged rollout:** 1 device → 5 mixed-state devices → full 60 via MDM, watching per-host
  request rates and challenge rates at each step.

## 12. Follow-up (separate, gated spec): consumer edge-hydration

Not in scope here; recorded so it isn't lost. The consumer app may reuse the **result envelope**
and **`/results` upload contract**, but with a fundamentally different trigger:

- **Foreground + user-triggered only.** Fetch happens only when a user performs a search and is
  served data relevant to **their own query** — never a background queue. (Background queue-driven
  fetching on consumer devices is **proxyware** and an app-store-removal risk; explicitly out.)
- **Guardrails:** bind the fetch to the user's actual query (not query + side-list); disclose in
  the privacy policy; same host allowlist (no red-tier); serve cached results immediately and
  fetch-and-contribute in the foreground (a WebView render is seconds-slow).
- **Gated on:** legal/policy review **and** the consumer app actually being built (it is not yet).

## 13. Build order

1. **Coordinator + D1 schema + R2 wiring** on the Worker — testable via `curl`, no device needed.
   Foundation; useful even before the app exists.
2. **Android pool app** against the live coordinator.
3. **MDM packaging + staged rollout.**

## 14. Open questions / risks

- **`SYSTEM_ALERT_WINDOW` grant path** under the specific MDM — confirm before building §7.
- **CGNAT:** 60 SIMs may egress through fewer distinct public IPs than 60; reputation is still
  mobile-grade (the property that matters), but coordinator per-host pacing remains important.
- **Foreground-service type** justification for Android 14+ review (`dataSync` vs `specialUse`).
- **Allowlist governance:** who curates `url_registry` against the catalog tiers, and how.
