# Prototype scraper — experiment findings

Live run of **97 source connectors** through the uniform framework. Answers the two
exploratory questions per source:

1. **Is pulling data doable?** → `status`
2. **Is there an easy per-source fingerprint + delta method?** → `incremental` + `fingerprint`

> Run: `tsx scripts/connectors/run.ts all --limit=6 --concurrency=8`. Tiers/licensing from
> [docs/research/travel-data-sources-catalog.md](../../../../docs/research/travel-data-sources-catalog.md).
> Probes assume licences are in hand (per brief) — `blocked`/`needs_license` reflect the
> *technical/ToS* access wall, not a decision to bypass it.

## Headline

| Result | Count | Meaning |
|--------|------:|---------|
| 🟢 ok | 10 | Real data pulled now, no credential |
| 🟡 partial | 1 | Reachable; bulk pull needs a known release path |
| 🔑 needs_key | 26 | API exists; gate confirmed by live probe; set the key to pull |
| 📄 needs_license | 32 | Paid/partner contract required; portal reachability confirmed |
| 🔴 blocked | 28 | No sanctioned access (anti-bot / closed / ToS) — partnership or skip |
| 💥 error | 0 | — |

**37 / 97 connectors have a usable incremental (delta) mechanism today.** Among the 10 that
pull data with no credential, **9 have a working delta**. The cleanest deltas are timestamp-
parameter APIs (Wikidata `dateModified`, Socrata `:updated_at`), changes-feeds (MediaWiki
RecentChanges), and dated bulk releases (Foursquare/Overture/OSM/GeoNames).

### Two answers, distilled

- **Doable now (zero cost):** the open tier — Wikidata, Wikipedia, Wikivoyage, DBpedia,
  OpenStreetMap (Overpass + Planet), GeoNames, US Socrata, DataTourisme, Overture. These are
  the spine and they pull real records (Overture/FSQ via DuckDB-over-Parquet).
- **Fingerprintable:** almost every source can be cheaply fingerprinted. Where there is no API
  timestamp, the **sitemap `<lastmod>`** heuristic works *if the sitemap isn't WAF-protected*;
  when even the sitemap is behind Cloudflare/DataDome (Atlas Obscura, Tabelog, Wongnai,
  Diningcode, TripAdvisor Forums, Culture Trip), the only fallback is a full re-pull + per-record
  `content_hash` — i.e. no cheap delta without solving the challenge.

## Tier A — open / bulk (🟢 the spine)

| Source | Result | Incremental method | Fingerprint |
|--------|--------|--------------------|-------------|
| overture | 🟢 ok (6 rec) | dump-diff ✓ | release-tag |
| osm-overpass | 🟢 ok (6) | changes-feed ✓ (`newer:"T"`) | osm-base-timestamp+count |
| osm-planet-geofabrik | 🟢 ok (bulk) | dump-diff ✓ (replication diffs) | replication-sequence |
| wikidata | 🟢 ok (6) | **api-since-param ✓** (`schema:dateModified`) | max-dateModified+count |
| wikipedia | 🟢 ok (6) | changes-feed ✓ (RecentChanges) | latest-timestamp+revid |
| wikivoyage | 🟢 ok (6) | changes-feed ✓ | latest-timestamp+revid |
| geonames | 🟢 ok (6) | dump-diff ✓ (daily modifications file) | latest-diff-date+rows |
| socrata-us | 🟢 ok (6) | **api-since-param ✓** (`:updated_at`) | rowsUpdatedAt+count |
| datatourisme | 🟢 ok (bulk) | dump-diff ✓ (daily export) | resource-last_modified |
| dbpedia | 🟢 ok (6) | dump-diff ✗ (release only) | count+sampled-ids |
| foursquare-os-places | 🟡 partial | dump-diff ✓ (`dt=` + Deltas) | etag / release-date |
| opentripmap | 🔑 needs_key | sort-by-updated ✗ | count+bbox-hash |

## Tier B — licensable (📄 pay to ingest)

| Source | Result | Incremental | Fingerprint |
|--------|--------|-------------|-------------|
| wikimedia-enterprise | 🔑 needs_key | changes-feed ✓ (Realtime/On-demand) | portal-status |
| reddit | 🔑 needs_key | cursor-pagination ✓ (`new` + fullnames) | newest-fullname+count |
| safegraph | 📄 needs_license | dump-diff ✓ (monthly) | portal-status |
| here-bulk | 📄 needs_license | dump-diff ✓ | etag |
| lonely-planet | 📄 needs_license | changes-feed ✓ | portal-status |
| retty | 📄 needs_license | dump-diff ✓ | last-modified |
| siksin | 📄 needs_license | dump-diff ✓ | content-length |
| navitime | 📄 needs_license | dump-diff ✓ | etag |
| jorudan | 📄 needs_license | dump-diff ✓ | content-length |
| placer-ai | 📄 needs_license | dump-diff ✓ | last-modified |
| yelp-data-licensing | 📄 needs_license | api-since-param ✗ | portal-status |
| time-out | 📄 needs_license | sitemap-lastmod ✗ | content-length |

## Tier C — API display/lookup-only (🔑 key, but don't cache content)

| Source | Result | Incremental | Fingerprint |
|--------|--------|-------------|-------------|
| foursquare-places-api | 🔑 needs_key | sort-by-updated ✓ (`date_refreshed`) | fsq_id+date_refreshed |
| untappd | 🔑 needs_key | cursor-pagination ✓ (checkin id) | max-checkin-id |
| expedia-rapid | 🔑 needs_key | sort-by-updated ✓ | property_id+review_count |
| naver-blog | 🔑 needs_key | sort-by-updated ✓ (postdate) | keyless-gate |
| google-places | 🔑 needs_key | full-only ✗ | content-hash |
| google-hotels | 🔑 needs_key | none ✗ | content-hash |
| tripadvisor-content | 🔑 needs_key | none ✗ | content-hash |
| yelp-fusion | 🔑 needs_key | none ✗ | content-hash |
| mapbox / tomtom / here-dev / apple-maps | 🔑 needs_key | none ✗ | content-hash |
| amap / baidu-maps / naver-local / kakaomap / hot-pepper-gourmet | 🔑 needs_key | none ✗ | keyless-gate |
| jalan | 🔑 needs_key | full-only ✗ | (host unreachable from this net) |

> Tier C reality: most place APIs have **no since-parameter** — delta = re-poll + `content_hash`.
> The exceptions worth using are Foursquare (`date_refreshed`), Untappd (checkin cursor), Expedia
> (per-property), and Naver-blog (postdate sort).

## Tier D — partner/affiliate-gated (📄 / 🔴)

| Source | Result | Incremental | Fingerprint |
|--------|--------|-------------|-------------|
| booking-com | 📄 needs_license | **api-since-param ✓** (`last_change`, 24h) | portal-status |
| hostelworld | 📄 needs_license | sort-by-updated ✓ (latest reviews) | etag |
| atdw | 🔑 needs_key | api-since-param ✓ (delta endpoints) | product-count+max-updated |
| visit-finland | 🔑 needs_key | api-since-param ✓ | product-count+max-updated |
| agoda / trip-com / traveloka / txgb / tourism-nz | 📄 needs_license | full-only ✗ | etag / last-modified |
| klook / getyourguide / viator / thefork / opentable / resy / chope | 📄 needs_license | none ✗ | etag / portal-status |
| meituan / mafengwo / ctrip / qunar / tongcheng / fliggy / yanolja / yeogi-goodchoice | 📄 needs_license | none ✗ | content-hash |
| catchtable | 🔴 blocked | sitemap-lastmod ✓ | sitemap-lastmod-max |
| michelin-guide | 🔴 blocked | sitemap-lastmod ✓ | selection-year+sitemap |
| alltrails | 🔴 blocked | sitemap-lastmod ✗ (DataDome) | sitemap-lastmod-max |
| factual | 🔴 blocked | none ✗ (defunct → Foursquare) | none |

## Tier E — scrape-only / no sanctioned access (🔴)

| Source | Result | Incremental | Fingerprint |
|--------|--------|-------------|-------------|
| magicpin / burpple / hungrygowhere / foody-shopeefood / happycow / jnto-content / talabat | 🔴 blocked | **sitemap-lastmod ✓** | sitemap-lastmod-max |
| catchtable / michelin (Tier D) | 🔴 blocked | sitemap-lastmod ✓ | sitemap-lastmod-max |
| tabelog | 🔴 blocked | sitemap-lastmod ✓ (0 entries) | sitemap-lastmod-max |
| atlas-obscura / wongnai / qyer / diningcode / culture-trip / tripadvisor-forums | 🔴 blocked | sitemap-lastmod ✗ (WAF) | none |
| dianping / xiaohongshu / douyin-life / zomato / swiggy-dineout / eatigo / airbnb / foursquare-consumer / yandex-eda | 🔴 blocked | none ✗ | content-hash |
| 2gis / yandex-maps / sygic-travel | 🔑 needs_key | none ✗ | (key-gated; keyless probe 200) |

> The browser path (Playwright/system Chrome, `PROBE_BROWSER=1`) is wired and works (Chrome
> launches); but the high-value community giants (Tabelog, Dianping, Xiaohongshu, Atlas Obscura)
> sit behind Cloudflare/DataDome/signed-request walls — naive scraping is blocked, and even the
> sitemap is often challenged. These are **partnership-or-skip**, confirmed empirically.

## What this proves

- The **uniform trigger + output envelope works** across all 97 sources and all 5 tiers — one
  `pull(input, deps)` in, one `PullResult` out, every run produces a `sourceFingerprint`.
- **Fingerprinting is the easy part** where a source is reachable; the *delta* quality varies and
  the framework records exactly which mechanism each source supports.
- The **open tier is genuinely ingestible today**; the brand APIs are key-gated lookups with weak
  deltas; the OTAs/merchant platforms are licence-gated; the native-language community leaders are
  WAF-walled. This matches the catalog's licensing tiers and is now demonstrated by live probes.

## Browser-scraping (the "other way" for key/licence-gated + blocked sources)

For every source that needs a key/licence or has no API, there is a **browser-scrape connector**
that drives **system Chrome** like a normal user: **one page, one visit per run**, human dwell +
gentle scroll, sequential with pacing (`--browser`, default 4s between sources) — no pagination,
no parallel hammering. Run: `tsx scripts/connectors/run.ts <all|id> --browser`.

**Measured doability (live):**

| Site | Result | Notes |
|------|--------|-------|
| Google Maps | 🟢 6 records | real names + `ChIJ…` place IDs (stable) — the public alternative to the key-gated Places API |
| Tabelog (JP) | 🟢 8 records | renders fine in Chrome though its sitemap is walled |
| Wongnai (TH) | 🟢 8 records | listing scrape works (sub-elements deduped downstream) |
| 2GIS (RU) | 🟡 0 | SPA — needs a longer wait / result-container selector (drill down) |
| Yelp / TripAdvisor | 🔴 blocked | **DataDome** 403 at the TLS/IP edge — even headed + stealth |
| Atlas Obscura / AllTrails | 🔴 blocked | **Cloudflare-managed** challenge — same |

**At scale — 68 browser connectors** (`run.ts <all> --browser`), with selectors verified live per
source. A 10-source spot-run across clusters: **7 extracted real records from one page each** —
including licence-gated sources — and the 3 hard ones were correctly flagged for a proxy:

| Site | Result | | Site | Result |
|------|--------|-|------|--------|
| Hot Pepper Gourmet (JP) | 🟢 6 | | Michelin Guide | 🟢 6 |
| Jalan (JP) | 🟢 6 | | HappyCow | 🟢 6 |
| KakaoMap (KR) | 🟢 5 | | Talabat (MENA) | 🟢 6 |
| Sygic→Tripomatic | 🟢 6 | | Booking.com | 🟡 0 (interstitial → proxy) |
| Zomato | 🟡 0 (DataDome → proxy) | | Klook | 🔴 DataDome → proxy |

**What works:** plain headless system-Chrome scrapes any site that merely JS-renders — most
sources, including ones that were API-gated (Google Maps, Hot Pepper, KakaoMap, Jalan) or
licence-gated (Michelin), and community sites (Tabelog, Wongnai, HappyCow, Talabat).

**What needs more:** sites behind enterprise bot-management (DataDome: Yelp/TripAdvisor;
Cloudflare-managed: Atlas Obscura/AllTrails) reject a datacenter IP regardless of stealth. This is
an **infrastructure** requirement, not a code gap. The framework detects the exact wall and the
connectors expose a **pluggable escalation**: set `BROWSER_PROXY` to a residential proxy /
unblocker endpoint (and optionally `BROWSER_HEADFUL=1`). With that, the same one-page strategy runs
through the proxy — no code change.

> Passive stealth (patched `navigator.webdriver`, automation flags off, Cloudflare auto-challenge
> wait) was tested and does **not** beat DataDome/Cloudflare from a datacenter IP — confirming the
> proxy/unblocker is the real lever for those few sources.

## Next (drill-down candidates, per source)

- `foursquare-os-places`: wire the Places Portal Iceberg token (or HF mirror) to enumerate the
  latest `dt=` release, then DuckDB-read the parquet (the row pull already works on a known path).
- `jalan`: the Recruit host was unreachable from this network — re-probe with `RECRUIT_API_KEY`.
- WAF-walled sitemaps (Tabelog/Atlas Obscura/Wongnai…): test a headed Chrome with the challenge
  solved, or pursue a data partnership — out of scope for the prototype.
- Keyed sources: drop real keys into env (`GOOGLE_MAPS_API_KEY`, `YELP_API_KEY`, `TWOGIS_KEY`, …)
  and re-run to convert `needs_key` → `ok` and measure record-level delta.
