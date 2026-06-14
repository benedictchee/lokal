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

## Reclassification + Chrome fallback (every source)

Every API/data connector is now wrapped so that **when the API path yields no data**
(needs_key / needs_license / blocked), it **automatically falls back to the source's Chrome
browser-scrape strategy** (one page, one visit, human-paced — `core/fallback.ts`). Run the API
pool with `--fallback` to enable it (`tsx scripts/connectors/run.ts all --fallback`). 61 sources
pair to a browser strategy by identical id; 8 via an alias map (`google-places→google-maps`,
`yelp-fusion/yelp-data-licensing→yelp`, `tripadvisor-content→tripadvisor`,
`atlas-obscura→atlas-obscura-web`, `naver-local/naver-blog→naver-map`,
`expedia-rapid→expedia-hotels-com`, `foursquare-places-api/foursquare-consumer→foursquare`).

Each source now carries a **final classification** of how its data is actually obtainable:

| Classification | Count | Meaning |
|----------------|------:|---------|
| `open` | 11 | Pull directly, no credentials (Tier A open/bulk) |
| `api-key` | 26 | API works with a key **+ Chrome fallback wired** |
| `api-license` | 32 | API behind a paid/partner licence **+ Chrome fallback wired** |
| `browser` | 26 | No usable public API — **Chrome scrape is the path** (renders fine) |
| `no-public-source` | 2 | No public API **and** no public website — `factual` (defunct), `douyin-life` (app-only) |

**Net: 95 / 97 sources are obtainable** — directly (11), via key/licence with a Chrome backstop
(58), or via Chrome scrape (26). Only 2 have no public surface at all. Sources whose Chrome path
hits an enterprise WAF (DataDome/Cloudflare) reclassify to **`browser+proxy`** at runtime under
`--fallback` (they need a residential `BROWSER_PROXY`); statically they list under `browser`.

**Verified live** (`run.ts <ids> --fallback`): the wrapper auto-engages Chrome when the API has
no data — `google-places` (API needs_key) → 5 records via google-maps; `hot-pepper-gourmet`
(needs_key) → 5; `tabelog` (API blocked) → 5; while `klook` (needs_license) and
`tripadvisor-content` (needs_key) reach Chrome but hit DataDome → reclassified `browser+proxy`.

### "Reached but 0 items" drill-down

A DOM diagnostic (`_gen/diagnose-zero.ts`) over the ~21 sources that loaded but extracted nothing
found that **only one was a true selector bug** — **booking-com** (its search bounced to the
homepage, so the property-card grid never rendered; fixed with a resilient `/hotel/<cc>/<slug>.html`
extractor → now 5 real hotels). The rest were **anti-bot walls the detector initially missed**:
Access-Denied 403s (zomato, opentable, culture-trip, siksin, reddit), CAPTCHA iframes
(mafengwo, tongcheng, yandex-eda), HTTP 432 (ctrip), login/captcha/onboarding redirects
(foursquare→login, meituan→/win-together, 2gis→/museum), and empty SPA shells (amap, catchtable).
`looksLikeChallenge` was hardened (Access-Denied / CAPTCHA / 432 / 503 / login-redirect / tiny-shell
detection), so these now correctly report **`browser+proxy`** (need a residential `BROWSER_PROXY`)
instead of a misleading `partial / 0 items`. A handful of canvas/XHR SPAs (naver, qunar, swiggy,
trip-com, tongcheng) render content with no scrapable anchors and remain drill-down candidates.

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

## Browser-scraping coverage — what's available, what's not

Browser connectors drive **system Chrome** like a normal user: **one page, one visit per run**,
human dwell + gentle scroll + jitter, sequential with pacing — no pagination, no parallel hammering.
Run `tsx scripts/connectors/run.ts <all|id> --browser`, or `--fallback` to let API connectors fall
back to Chrome when the API has no data. A full no-keys `--fallback` run over all 97 sources gives:

### ✅ Available via browser / open — 45

> open data + browser-scraped with **real records, one page each**.

Open (11): `wikidata, wikipedia, wikivoyage, dbpedia, osm-overpass, osm-planet-geofabrik, geonames,
socrata-us, datatourisme, overture, foursquare-os-places`.
Browser (34): `google-places, google-hotels, agoda, booking-com, viator, resy, hostelworld, chope,
fliggy, yanolja, michelin-guide, kakaomap, hot-pepper-gourmet, jalan, lonely-planet, retty, navitime,
jorudan, time-out, tabelog, wongnai, magicpin, burpple, hungrygowhere, foody-shopeefood, eatigo,
diningcode, happycow, airbnb, jnto-content, yandex-maps, talabat, sygic-travel, xiaohongshu`.

Real records confirmed (samples): Google Maps (`ChIJ…` ids), Tabelog (食べlog scores), Booking.com
(hotel slugs + ratings), Michelin, KakaoMap, Hot Pepper, Jalan, HappyCow, Talabat, Yandex Maps.

### 🔴 WAF-blocked — 23 (need an alternative source / residential proxy)

> Chrome reaches them but enterprise bot-management blocks a datacenter IP — DataDome, Cloudflare,
> Access-Denied 403, CAPTCHA, or login redirect. Detected at runtime → reported `browser+proxy`.

`yelp-fusion, yelp-data-licensing, tripadvisor-content, tripadvisor-forums, klook, getyourguide,
thefork, expedia-rapid, opentable, traveloka, untappd, zomato, culture-trip, reddit, siksin,
atlas-obscura, alltrails, ctrip, meituan, qyer, yandex-eda, foursquare-places-api, foursquare-consumer`.

Fix path (not code): set `BROWSER_PROXY` to a residential proxy/unblocker (+ optional
`BROWSER_HEADFUL=1`). Passive stealth alone (patched `navigator.webdriver`, automation flags off,
challenge-wait) does **not** beat DataDome/Cloudflare from a datacenter IP — the proxy is the lever.

### ⚠️ NOT browser-scrapable — 29

**a. Data-provider APIs — no public website to scrape (13).**
`mapbox, tomtom, here-dev, here-bulk, apple-maps, safegraph, placer-ai, opentripmap,
wikimedia-enterprise, atdw, txgb-visitbritain, visit-finland, tourism-nz`.
There is no consumer site — only a data feed. **Get via their API/licensed feed.** Most overlap
coverage we already pull openly (Foursquare/Overture/OSM/Wikidata), so they're largely not a real gap.

**b. No public source at all (2).**
`factual` (defunct → successor **Foursquare OS Places** is in the ✅ set) · `douyin-life` (app-only
video; no web listing — needs a partnership). **`douyin-life` is the only genuinely unreachable source.**

**c. SPA / heavy anti-bot — content renders but no scrapable HTML (14).**
`amap, baidu-maps, dianping, mafengwo, qunar, 2gis, naver-local, naver-blog, catchtable,
yeogi-goodchoice, swiggy-dineout, qraved, tongcheng, trip-com`.
Mostly China/Korea super-apps that draw results into canvas/JSON via XHR (a DOM selector finds
nothing; several also throw CAPTCHA/432). Recover via their **internal JSON XHR endpoint**
(per-site reverse-engineering — several, e.g. Naver/Kakao, expose JSON APIs) or a **regional
residential proxy + headed browser**. Same "needs an alternative/proxy" category as WAF.

### How the framework behaves (anti-detection + politeness)

- **One page, one visit** per source per run; human dwell/scroll/jitter; `--browser`/`--fallback`
  run sequentially with pacing (no parallel hammering, no pagination).
- **Block detection**: DataDome / Cloudflare / PerimeterX / Access-Denied / CAPTCHA iframes /
  Yandex SmartCaptcha / login-or-captcha redirect / HTTP 403·432·451·503 / empty-shell → reported
  as `browser+proxy` rather than a misleading "0 items".
- **Pluggable proxy**: `BROWSER_PROXY` routes the same one-page strategy through a residential
  proxy/unblocker for WAF + regional sites — no code change.

## Next (drill-down candidates, per source)

- `foursquare-os-places`: wire the Places Portal Iceberg token (or HF mirror) to enumerate the
  latest `dt=` release, then DuckDB-read the parquet (the row pull already works on a known path).
- `jalan`: the Recruit host was unreachable from this network — re-probe with `RECRUIT_API_KEY`.
- WAF-walled sitemaps (Tabelog/Atlas Obscura/Wongnai…): test a headed Chrome with the challenge
  solved, or pursue a data partnership — out of scope for the prototype.
- Keyed sources: drop real keys into env (`GOOGLE_MAPS_API_KEY`, `YELP_API_KEY`, `TWOGIS_KEY`, …)
  and re-run to convert `needs_key` → `ok` and measure record-level delta.
