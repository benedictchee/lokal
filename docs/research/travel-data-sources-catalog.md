# Travel Data Sources Catalog

> Research deliverable for the **data-pipeline** subsystem (scrape → vectorize → AI features).
> Compiled 2026-06-13. Scope: world's most popular travel regions; emphasis on **coverage &
> data depth**, **language/locale diversity**, and **technical ingestibility** (API + ToS).
>
> **How this was produced:** two fact-checked research passes (adversarial verification against
> primary Terms-of-Service / developer docs). 99 sources verified across 9 clusters. The
> Russia/MENA cluster did not finish verification and is flagged **(unverified)** below.

---

## 0. The one thing that determines pipeline architecture

For a **scrape-and-vectorize** pipeline, the deciding attribute is **not** coverage — it's the
**license / ToS posture toward caching and AI ingestion**. The verified evidence splits every
source into five tiers. **You can only lawfully bulk-vectorize the green tier.** The famous
brands (Google, Yelp, TripAdvisor, Tabelog, Dianping…) are explicitly off-limits for ingestion.

| Tier | Meaning | Can you ingest & vectorize? |
|------|---------|------------------------------|
| 🟢 **Open-bulk** | Openly licensed bulk dataset/dump | **Yes** — subject to attribution and (some) share-alike |
| 🔵 **Licensable** | Paid commercial data license exists | **Yes, if you pay** — terms per contract |
| 🟡 **API display-only** | Live API, but ToS bans caching/storing | **No** — lookup/display only; persist only the ID |
| 🟠 **Partner-gated** | Affiliate/partner agreement required | **Usually no** — reviews rarely licensed for AI |
| 🔴 **Scrape-only / risky** | No sanctioned access | **No** — scraping violates ToS / legally risky |

**Strategic takeaway:** build the **knowledge spine** from the green tier (Foursquare OS Places +
Overture + OpenStreetMap + Wikidata/Wikipedia/Wikivoyage + national open-tourism datasets);
**enrich at query-time** from yellow/orange APIs for display only (persisting just their IDs);
**license** (blue) where a source is strategically essential (Wikimedia Enterprise, SafeGraph,
Yelp Data Licensing, Lonely Planet); and treat red-tier community giants as
**partnership-or-skip**, never silent scraping.

---

## 1. Tier A — 🟢 Open / bulk-ingestible (build the spine here)

These are the sources you can legally download in bulk and vectorize. Watch the **share-alike**
(ODbL, CC-BY-SA) vs **permissive** (Apache, CC0, CC-BY) split — share-alike can force you to
publish derived databases under the same license.

### Global POI & knowledge bases

| Source | Coverage / Lang | Content & scale | Ingestibility | License / AI-use |
|--------|-----------------|------------------|---------------|------------------|
| **Foursquare OS Places** (FSQ OS Places) | Global, multilingual names | 100M+ POIs, 1000+ categories; name/address/geo/hours/socials/`date_refreshed`; 22-col base schema | **Bulk** GeoParquet on public S3 + Iceberg; query via DuckDB/Athena/Spark; monthly + deltas; no rate limit | **Apache-2.0** — permissive, **no share-alike**, commercial + AI OK; keep NOTICE.txt attribution. *(Best single bulk source. Regional density uneven — densest in US.)* |
| **Overture Maps** | Global, multilingual | Places ~60M+ POIs (+buildings 2.3B, transport, addresses); stable GERS IDs | **Bulk** GeoParquet (S3/Azure, BigQuery/Databricks/Snowflake); monthly | **Per-theme:** Places = **CDLA-Permissive / Apache / CC0** (no share-alike); Base/Buildings/Transport = **ODbL** (share-alike). AI = conditional on theme. |
| **OpenStreetMap** (Planet / Geofabrik / Overpass / Nominatim) | Global, `name:*` per language | ~10B nodes, 100M+ POIs; amenities, hours, contact tags, geometry; **no reviews** | **Bulk** `.osm.pbf` Planet + regional extracts (Geofabrik); Overpass for queries; minutely/daily diffs | **ODbL 1.0** — attribution + **share-alike** (publicly-used derived DB must be ODbL). AI conditional. Public Nominatim/Overpass = 1 req/s (self-host for bulk). |
| **Wikidata** | Global, hundreds of langs | ~115M items; places w/ coords (P625), admin hierarchy, **external IDs** (GeoNames, OSM, TripAdvisor…), multilingual labels | **Bulk** JSON/RDF dumps (~140GB) + SPARQL | **CC0** (public domain) — **zero obligations**. *The cleanest legal source; ideal ID-graph spine to join everything else.* |
| **Wikipedia** | Global, 300+ langs | Place/POI articles, descriptions, coords, infoboxes | **Bulk** XML/HTML dumps + REST/Action API | **CC-BY-SA 4.0** — attribution + **share-alike** on derived text/DB. |
| **Wikivoyage** | Global, ~25+ langs | **Travel-guide prose**: see/do/eat/sleep/drink listings (coords, prices) | Same Wikimedia dumps + API; listing templates → semi-structured POIs | **CC-BY-SA 4.0** — attribution + share-alike. *(Underused gem for itinerary/POI context.)* |
| **DBpedia** | Global, 125+ langs | RDF extracted from Wikipedia infoboxes; types, coords, abstracts, cross-IDs | **Bulk** RDF dumps (Databus) + public SPARQL | **CC-BY-SA 3.0** — attribution + share-alike (inherits Wikipedia). |
| **GeoNames** | Global | ~12M place names, 25M alt-names; gazetteer (admin, coords, population, timezone) | **Bulk** tab-delimited dumps (`allCountries.zip`) + daily diffs + web services | **CC-BY 4.0** — attribution only, **no share-alike**, commercial OK. |
| **OpenTripMap** | Global; **dense Russia/CIS** | 10M+ tourist attractions; merges OSM + Wikidata + Wikipedia + Russian cultural DBs | REST (bbox/radius paging); no single dump | **ODbL** — and **explicitly permits** pre-fetch/index/store/cache + use on any map. Rare permissive posture. |

### National / regional open-government tourism data (cleanest licensing of all)

| Source | Coverage / Lang | Content & scale | Ingestibility | License / AI-use |
|--------|-----------------|------------------|---------------|------------------|
| **DataTourisme** | France (+overseas), FR/EN | National aggregate of all regional tourism DBs: POIs, events, tours; tens–hundreds of k | **Bulk** daily N-Triples dump on data.gouv.fr (no reg) + free-key flux API; RDF/JSON-LD | **Licence Ouverte 2.0** — attribution only, no share-alike, no caching limit. **AI conditional (attribution).** |
| **German Tourism Knowledge Graph** (GTKG / open-data-germany) | Germany, DE/EN | National graph: POIs, restaurants, hotels, events, tours; schema.org | SPARQL + REST + **ships an MCP server for AI**; free key | CC0 / CC-BY / CC-BY-SA per source. **AI explicitly encouraged** (`ai=yes`). |
| **US data.gov / DMO open data** | USA (fed+state+city), EN | City POI/landmark sets (e.g. NYC CommonPlace, auto-updated weekly) + tourism stats | **Socrata SODA API** + bulk CSV/JSON/GeoJSON | Federal = **public domain** (17 USC 105); many city sets CC0/open. `ai=yes`. Coverage patchy by jurisdiction. |
| **Switzerland Tourism** (MySwitzerland.io / discover.swiss) | Switzerland, 16 langs | 4,000+ destinations, 5,000+ experiences, events | Read-only REST, free key; no bulk dump | **CC-BY-SA** — commercial OK + attribution + **share-alike**. |
| **Visit Sweden National API** | Sweden, SV/EN+ | ~14,000 entries (accommodation, attractions, events, trails) | schema.org REST, open, no fee | ⚠️ **License ambiguity** — docs are CC-BY/CC-BY-NC-SA but the *data* license is unstated; NC risk. Verify before commercial use. |
| **European Tourism Data Space** (data.europa.eu) | EU, multilingual | Emerging; ~1M datasets catalog (tourism subset mostly statistical) | DCAT-AP catalog + SPARQL/REST; **per-dataset** license | Open Data Directive / HVD push to CC-BY/CC0 — **check per dataset**. Still in deployment. |
| **MyHelsinki Open API** | Helsinki, FI/EN/SV | City POIs, events, activities | REST/JSON, easy | **CC-BY 4.0** historically — but **parts disabled ~2023**; confirm status. |

> **Also openly licensable but sits in Tier B for practical reasons:** see Wikimedia Enterprise
> (paid, pre-structured Wikipedia/Wikivoyage/Wikidata) below.

---

## 2. Tier B — 🔵 Licensable-commercial (pay to ingest lawfully)

| Source | Coverage / Lang | What you get | License / AI-use |
|--------|-----------------|--------------|------------------|
| **Wikimedia Enterprise API** | Global, 360+ langs | Pre-parsed Wikipedia/Wikivoyage/Wikidata snapshots w/ license metadata; built for AI ingestion | Free tier (30 req/mo) + paid egress. Data keeps free license (CC-BY-SA / CC0); contract bars building a *competing API business*. |
| **SafeGraph Places** | Global (US-strongest), 51M+ POIs | POI + brand + NAICS + polygon geometry + hours; monthly Parquet/CSV drops | Paid license (or **Dewey** academic). "Broad/permissive" use, but **AI-training rights are silent → treat as unknown** (downgraded in verification). |
| **HERE** | Global (auto-grade) | POIs, geocoding, autosuggest; **no reviews**. Bulk via enterprise license. | Dev API caps cache at 30 days & bans using location data to train ML/AI → bulk needs enterprise data license. |
| **Yelp Data Licensing** | US-primary, 330M reviews | Reviews/ratings/listings via paid **Places API** + **AI API** ($25/1k) — the *sanctioned* path | The **only** lawful way to ingest Yelp (the free Fusion tier is display-only; see Tier C). |
| **Lonely Planet** (Red Ventures / ArrivalGuides) | Global, 8,000+ guides | Curated destination/POI editorial; structured content-licensing API | Paid commercial license. *(AI-use downgraded to **no** — LP's own terms restrict model training even under license; negotiate explicitly.)* |
| **Reddit Data API** | Global, EN-dominant | r/travel, r/food etc. — high-signal first-person recs | Paid for commercial. **Bans model training without written consent** (sued Anthropic/Perplexity). Free tier non-commercial only. `ai=no` without a deal. |
| **Retty** (JP) | Japan, JP | "Real-name" restaurant reviews; B2B "Food Data Platform" | Bespoke licensed feed (no public API). AI terms per contract. |
| **Siksin** (KR) | S. Korea, 4 langs | ~700k restaurants, 1.1M reviews, 5M photos; already licenses to Naver/Kakao/automakers | B2B license via contact. Lawful commercial path likely; terms negotiated. |
| **Navitime / Jorudan** (JP) | Japan, JP+ | Transit/route/timetable + POI/spot data | Commercial B2B API; caching/AI per contract. |
| **Time Out** | Global cities, EN+ | Editorial venue/event listings, "best of" | No self-serve API; licensing/franchising case-by-case. |
| **Placer.ai** | US-primary, EN | Foot-traffic/visitation analytics keyed to POIs (not reviews) | Subscription; "internal business use only", **AI-use unknown** (downgraded). |

---

## 3. Tier C — 🟡 API display/lookup-only (query live, do NOT cache or vectorize)

These have clean APIs but their ToS **explicitly forbid persisting/vectorizing content**. Use for
live display only; persist **just the stable ID** for back-end matching.

### Global aggregators & maps

| Source | Coverage | Content | The constraint that blocks ingestion |
|--------|----------|---------|--------------------------------------|
| **Google Maps / Places API** | Global, multilingual | POIs, ratings, ≤5 reviews/place, photos, hours, popular times | "Must not pre-fetch, cache, or store Places content." Only **place_id** storable indefinitely (lat/long ≤30 days). **Explicit ban on ML/AI training.** No use with non-Google map. |
| **TripAdvisor Content API** | Global, 43 markets/22 langs | 1B+ reviews of 8M businesses (hotels/restaurants/attractions); ≤5 reviews+5 photos/loc | Cache **location_id only**; 50 QPS; "no license…in connection with AI/ML, incl. training/fine-tuning." Forums **not** in API. |
| **Yelp Fusion (free tier)** | US-primary | Reviews, ratings, hours, categories, photos | **24-hour** cache cap; **bans** building a listings DB, scraping, and **ingesting Yelp Content into GenAI**. 300 calls/day Starter. *(Ingest via paid Data Licensing — Tier B.)* |
| **Foursquare Places API (live)** | Global | Richer attributes than OS Places (popularity, tips, photos) | Cache only if refreshed ≤30 days; redistribution barred. *(For bulk use the OS Places dataset — Tier A.)* |
| **Mapbox** | Global | POIs via Search Box / Geocoding; no reviews | Temp geocodes can't be stored; bans using results to train AI; POI results only with a Mapbox map. |
| **TomTom** | Global (auto-grade) | POIs incl. EV charging, photos; no reviews | Cache ≤30 days; **bans** retaining Licensed Products in any ML/AI process. |
| **HERE (dev tier)** | Global | POIs, geocoding | Cache ≤30 days & only to serve the end user; bans storing location data for AI. (Bulk = Tier B.) |
| **Apple Maps** (MapKit JS / Server API) | Global | POIs, geocoding, directions; no API reviews | "Map Data may not be cached, pre-fetched, or stored" beyond temporary use. |

### Regional maps & national APIs (display-only)

| Source | Region / Lang | Content | Constraint |
|--------|---------------|---------|-----------|
| **Amap / Gaode** (高德地图, Alibaba) | China, zh | Hundreds of M POIs, search, routing | ToS **explicitly bans AI/model training** + caching/scraping; display-only. China entity for full access. |
| **Baidu Maps** (百度地图) | China, zh | Hundreds of M POIs, Place API | Display-only; bans offline storage/caching/scraping. |
| **Naver Local Search API** (네이버) | S. Korea, ko | Thin POI metadata (5/call, **no review text**); the real review corpus is on Naver Place | NCP ToS clause ⑧ bars reproduce/store/process beyond permitted scope. Review corpus only via scraping (risky). |
| **Naver Blog Search API** | S. Korea, ko | Snippets of Korea's dominant 맛집 (foodie) blog reviews; full text not returned | Same NCP ToS; full posts are user-copyrighted. |
| **KakaoMap / Kakao Local API** (카카오맵) | S. Korea, ko | POI metadata (name/addr/coords/category); **no reviews in API** | 100k req/day free; primary source confirms a storage **prohibition**; reviews only via scraping. |
| **Hot Pepper Gourmet** (ホットペッパー, Recruit) | Japan, JP | Restaurant info, photos, menus, coupons; **no user reviews exposed** | Recruit ToS: cache refresh ≤24h (no durable storage); no derivative DB. |
| **Jalan** (じゃらん, Recruit) | Japan, JP | Hotel/ryokan/onsen listings, availability, reviews, photos | Same Recruit ToS — 24h cache ceiling, no derivative DB, mandatory attribution. |
| **Expedia Group Rapid** (Hotels.com/Vrbo) | Global | **Verified guest reviews** (rating, title, text, stay dates) + property content | Reviews cacheable **≤48h** (display speed only); partner-gated; display-only. |
| **Google Hotels / Things to do** | Global | Hotel/attraction reviews via Places API | Same Google policy — no caching/storing; place_id only. |
| **Untappd** | Global, EN | Beer + bar/venue menus, check-ins, ratings | Delete caches every 24h; **can't build a competing beer DB**; no analytics. |

---

## 4. Tier D — 🟠 Partner / affiliate-gated (access by agreement; reviews rarely licensed for AI)

### OTA / booking platforms with reviews

| Source | Coverage / Lang | Review data | Access / constraint |
|--------|-----------------|-------------|---------------------|
| **Booking.com** (Demand API) | Global, 28M+ props, 40+ langs | Guest review text, scores, sub-scores, reviewer country, stay dates | Partner-gated; **"data forwarding strictly forbidden"**; 24h change-tracking; no AI grant. |
| **Agoda** | Global (APAC-strong), 38+ langs | Reviews exist on site but **not exposed via affiliate API** | Affiliate agreement bans programmatically extracting reviews. |
| **Expedia Rapid** | Global | Verified guest reviews (see Tier C — 48h cache) | Partner-gated. |
| **Klook** | APAC + global, many langs | Activity/attraction reviews, ratings, photos | Partner/affiliate API for distribution; reviews display-only; bans automated copying. |
| **GetYourGuide** | Global, 20+ langs | Tour/activity reviews & ratings (categorized) | Partner API gated by traffic threshold; display-scoped; supplier terms grant *GYG* the AI rights, not you. |
| **Viator** (TripAdvisor) | Global | 300k+ experiences; reviews shared w/ TripAdvisor | Partner API; review text must be rendered **non-indexable**; proprietary. |
| **TheFork / LaFourchette** (TripAdvisor) | Europe, multi | 55k+ restaurants; reviews w/ reviewer metadata | Partner API; **"forward distribution strictly prohibited"**; 200/min, 10k/day. |
| **OpenTable** (Booking Holdings) | Global (US-strong) | Restaurant info, aggregate rating, reviews, availability | Partner-only (3–4 wk review); reviews not licensed for AI. |
| **Resy** (Amex) | US + select cities | Restaurant metadata, availability; limited ratings | Partner-only; internal API undocumented; conservative Amex terms. |
| **Hostelworld** | Global, 170+ countries | 10M+ reviews/ratings, categorized (safety/location/cleanliness) | Partner API exposes latest reviews; display/booking scope; AI-use unknown. |
| **Trip.com** (Trip.com Group) | Global (China/APAC-strong), multi | Large multilingual hotel reviews (consumer-side) | `connect.trip.com` = inbound connectivity only; **reviews not in any sanctioned API** → scrape-only/risky. |
| **Traveloka** | SE Asia, EN/ID+ | 150k+ properties + activities; some reviews | Atlas/TPN B2B APIs = inventory/booking; reviews not an ingestible feed (AI-use downgraded to **no**). |
| **Chope** (Grab) | SG/HK/TH/ID, EN+ | Reservations, some ratings; ~3k restaurants | Partner/affiliate booking API only; low review depth. |

### National tourism boards (partner-gated distribution exchanges)

| Source | Region | Content | Constraint |
|--------|--------|---------|-----------|
| **Australian Tourism Data Warehouse (ATDW/ATLAS)** | Australia, up to 11 langs | 50k+ operator/event profiles, 250k+ media; delta sync | Very ingestible REST/JSON **but** distributor license required; tied to display/distribution. |
| **VisitBritain / VisitEngland (TXGB)** | GB/UK, EN | Live bookable products from 100+ DMOs | Free B2B booking exchange; distributor onboarding; no open license for derivative DB/AI. |
| **Visit Finland DataHub** | Finland | ~8,000 products, 2,000+ companies | Free GraphQL **but** ToS = internal-business-use only, anti-automation; `ai=no`. |
| **Tourism New Zealand** | NZ, EN | Business DB (syndication agreement) + open stats on data.govt.nz | Business DB gated by purpose/territory/time agreement; **stats are open** (Tier A-ish). |

### Chinese ecosystem (merchant/supplier-gated; Chinese business entity required; **no review egress**)

| Source | Coverage | Note |
|--------|----------|------|
| **Meituan** (美团) | China local-life #1 | Open platform = merchant/ISV ops only; no endpoint returns others' reviews. Chinese license required. |
| **Mafengwo** (马蜂窝) | China-origin, outbound destinations | Travelogues/guides UGC; open platform is merchant commerce; content via bespoke deals. |
| **Ctrip / Trip.com Group** (携程) | China + global | Supplier-push API + affiliate widgets; no bulk content. |
| **Qunar** (去哪儿) | China | Supplier platform; no public review export. |
| **Tongcheng** (同程旅行) | China (lower-tier cities) | Supplier-facing; no content feed. |
| **Fliggy** (飞猪, Alibaba) | China | Supplier/ISV via Taobao platform; Chinese entity. |

### Korean ecosystem (merchant-gated)

| Source | Coverage | Note |
|--------|----------|------|
| **CatchTable** (캐치테이블) | Korea #1 fine-dining + 1M overseas | Reservations, menus, reviews; no public API; merchant/POS gated. |
| **Yanolja** (야놀자) | Korea #1 accommodation OTA + global Cloud | B2B inventory APIs only; reviews via scraping (risky). |
| **Yeogi Eottae / GoodChoice** (여기어때) | Korea #2 accommodation OTA | Merchant Partner Center only; no content API. |

### Curated / niche (licensed via partnerships)

| Source | Coverage | Note |
|--------|----------|------|
| **Michelin Guide** | ~45 markets, 14k+ restaurants | No public API; licensed via TripAdvisor/TheFork partnership; proprietary. |
| **AllTrails** | Global, 500k+ trails, 90M members | No public API; DataDome anti-scraping; AI access reserved for AllTrails' own deals (e.g. ChatGPT). Pursue partnership. |
| **Factual** | (defunct) | Merged into Foursquare 2020 → use FSQ OS Places (Tier A). |

---

## 5. Tier E — 🔴 Scrape-only / no sanctioned access (legally risky — partnership or skip)

These are some of the **highest-coverage community sources in their regions**, but none offer a
sanctioned ingestion path; scraping violates their ToS (and, in China/Korea, specific
unfair-competition / DB-producer-rights law). Catalogued for completeness and partnership outreach.

| Source | Region / Lang | Why it's valuable | Why you can't just ingest it |
|--------|---------------|-------------------|------------------------------|
| **Tabelog** (食べログ) | Japan, JP+inbound | ~890k restaurants, 85M+ reviews/photos, the famous Tabelog score | ToS §9 bans copying/storing; no public data API; anti-scraping. |
| **Dazhong Dianping** (大众点评) | China, zh | Hundreds of M reviews; dominant China restaurant/local-life corpus | Public API shut; glyph-obfuscated/encrypted reviews; China AUCL scraping precedent. |
| **Xiaohongshu / RED** (小红书) | China + diaspora, zh | 300M+ MAU; billions of travel-discovery "notes" | Aggressive anti-scraping (xsec_token/risk); no content API; actively litigates. |
| **Qyer** (穷游网) | China outbound, zh | 80M users; outbound destination guides | No content API; scrape target; AUCL exposure. |
| **Douyin Life Services** (抖音生活服务) | China, zh | 6.1M+ stores; video "店探" reviews | Merchant onboarding only; no content egress; SPC 2025 scraping guidance. |
| **LINE MAN Wongnai** (วงใน) | Thailand, TH/EN | **900k+ eateries** (largest TH restaurant DB), reviews, menus | Only a merchant/POS API; review corpus not exposed; site scraping risky. |
| **Zomato** | India, EN+ | Millions of listings/reviews (India) | Public content API **discontinued ~2022**; only POS API now. |
| **Swiggy Dineout** | India | Dine-in listings, ratings | No public content API; scraping against ToS. |
| **Magicpin** | India, 275k+ stores | Hyperlocal reviews/deals | ToS bans automated access; high-confidence scrape-risk. |
| **Burpple** | Singapore/Malaysia, EN | Food reviews/photos, curated guides | No API; ToS bars automated access. |
| **HungryGoWhere** (Grab) | Singapore, EN | Editorial food content | No API; original corpus deleted 2021; Grab ToS. |
| **Foody / ShopeeFood** (Sea) | Vietnam, VI/EN | 100k+ restaurants, multi-axis reviews | No open API; scraping only. |
| **Eatigo** | TH/SG/MY/HK/IN | Time-based discount reservations | ToS **explicitly bans** AI tools/automated scraping. |
| **Qraved** | Indonesia, ID/EN | Jakarta food discovery | No API; ToS; operational continuity uncertain. |
| **Diningcode** (다이닝코드) | S. Korea, ko | Big-data restaurant rankings (blog-mined) | No API; KR DB-producer rights + UCPA exposure. |
| **HappyCow** | Global, 185+ countries | **Best vegan/veg POI DB** (244k+ veg-option venues) | No API (years of unmet requests); copyright UGC. Partnership recommended. |
| **Atlas Obscura** | Global, EN | ~32k offbeat/curious POIs w/ editorial | No API; ToS reserves all rights. |
| **Culture Trip** | Global, EN | Editorial guides | No outbound API; proprietary editorial. |
| **Airbnb** | Global | 7M+ listings + massive review corpus | API closed/invite-only under NDA; reviews not licensed; scraping against ToS. |
| **TripAdvisor Forums** | Global | High-signal destination Q&A | **Not** in the Content API; ToS bans bots/AI scraping. |
| **Foursquare consumer** (Swarm) | Global | Check-ins, tips | No bulk/data license; City Guide sunset 2024–25. |
| **JNTO (Japan)** content | Japan | Editorial destination content + stats | Stats are application-gated; editorial copyrighted; no open POI feed. |

---

## 6. Russia / MENA / other regional — ⚠️ (unverified; from general knowledge, not this run's fact-check)

This cluster's verification did not complete. Treat as **lower-confidence**; verify ToS before use.
Note **OpenTripMap (Tier A) already carries dense Russia/CIS coverage**, and **TheFork (Tier D)**
covers European (incl. some MENA-adjacent) restaurants — both are verified above.

| Source | Region / Lang | Content (expected) | Ingestibility (expected — verify) |
|--------|---------------|--------------------|-----------------------------------|
| **2GIS** | Russia/CIS + some intl, RU | City directory: businesses, POIs, hours, photos, reviews/ratings | Has a Catalog/Places API + MapGL; historically partner/commercial; storage limits likely. Russian-entity/registration considerations. |
| **Yandex Maps / Geosearch API** | Russia/CIS, RU | POIs, organizations, ratings/reviews (Yandex Maps reviews) | Geosearch/Places API is keyed & display-oriented; caching/AI restrictions expected; geo/sanctions access friction. |
| **Yandex Eda** | Russia, RU | Restaurant/delivery menus, ratings | No public content API; scrape-risky. |
| **Talabat** (Delivery Hero, MENA) | Gulf/MENA, AR/EN | Restaurant listings, menus, some ratings | No public content API expected; partner/merchant only. |
| **Zomato MENA (legacy)** | UAE/Lebanon etc. | Restaurant directory/reviews | Zomato exited most MENA food-delivery; content API defunct (see Tier E). |
| **Sygic Travel** | Global trip-planning, multi | POI trip-planning API (tourist attractions) | Commercial trip-planning API; license terms to verify. |

> **To verify this cluster properly:** I can run a focused agent (completes within an active turn,
> so it won't be killed by background sleep) to fact-check 2GIS / Yandex / Talabat against primary ToS.

---

## 7. Recommendations for the pipeline

1. **Build the spine from Tier A.** Start with **Foursquare OS Places** (Apache-2.0, no
   share-alike — safest) as the POI master, **Overture Places** (CDLA/Apache) to cross-fill, and
   **OpenStreetMap** for amenity tags/hours. Use **Wikidata (CC0)** as the join graph — it carries
   external IDs (Google place_id, OSM, GeoNames, TripAdvisor location_id) that let you *match*
   across every other source without storing their content.
2. **Layer narrative/POI context** from **Wikivoyage + Wikipedia (CC-BY-SA)** and the
   **national open-tourism datasets** (DataTourisme FR, GTKG DE, US/Swiss/Sweden) — these are
   clean and AI-friendly, and they're exactly the "official channel" data you asked about.
3. **Keep share-alike quarantined.** ODbL/CC-BY-SA sources (OSM, Wikipedia, DBpedia, Swiss) can
   force you to open-source a *derived database*. Track provenance per record so you can keep
   permissive (Foursquare/Wikidata/GeoNames) data separable from share-alike data in your vector store.
4. **For the big review brands, persist IDs not content.** Google `place_id`, Yelp `business_id`,
   TripAdvisor `location_id`, Foursquare `fsq_place_id` are all storable — use them to fetch fresh
   reviews **at query time for display**, never to vectorize. This is the only ToS-clean way to
   "use" Google/Yelp/TripAdvisor.
5. **License where strategically essential.** If you need real review *content* for AI:
   **Wikimedia Enterprise** (cheap, AI-ready), **Yelp Data Licensing / AI API** (US reviews),
   **SafeGraph** (US POI depth). Budget for these rather than risking scraping.
6. **Native-language gaps are a partnership problem, not a scraping one.** The dominant local
   review corpora — **Tabelog** (JP), **Dianping/Xiaohongshu** (CN), **Naver Place** (KR),
   **Wongnai** (TH), **Zomato** (IN) — have no ingestion path. For these, pursue **data
   partnerships** (HappyCow, AllTrails, Siksin, Retty already run B2B licensing), or rely on
   query-time API display where one exists (Naver/Kakao for KR metadata).

---

## 8. Caveats

- **Time-sensitivity is high.** Every ToS figure here is dated (Yelp terms shifted Jan→Sep 2025;
  TripAdvisor's Content API is flagged "outdated" with a "Terra API" successor pending; Google
  policies dated mid-2026; Singapore STB TIH **shut down 31 Jul 2025**; MyHelsinki partly disabled).
  Re-verify any source before you build on it.
- **Foursquare OS Places coverage is uneven** (vendor-stated "global"; densest in the US). The
  claim that Apache-2.0 "removes most constraints" was explicitly **refuted** — it removes
  *licensing* constraints, not *coverage* gaps. Validate per-region completeness for your markets.
- **The Russia/MENA row (§6) is unverified** general knowledge, not this run's fact-check.
- **China & Korea carry statutory scraping risk** beyond ToS (China AUCL / SPC 2025 guidance;
  Korea DB-producer rights + UCPA) — scraping these is a legal exposure, not just a ToS breach.
- This catalog favors **breadth + ingestibility**; per-source review *volume* figures are
  vendor-stated where given and "unknown" where unconfirmed.
