export const meta = {
  name: 'gen-connectors',
  description: 'Generate prototype scraper connectors for ~85 sources against a pinned interface',
  phases: [
    { title: 'Generate', detail: 'one agent per source cluster writes a conforming TS module' },
    { title: 'Review', detail: 'self-review each module against the contract checklist + fix' },
  ],
}

// The EXACT contract every connector must conform to. Pasted into each agent.
const CONTRACT = `
You are writing a TypeScript module for a prototype travel-data scraper framework.
Output ONE ES module (\`type:module\`, NodeNext) that exports a single named array of connectors.

IMPORTS — use ONLY these (exact paths, .js extensions). Import just what you use:
  import { defineConnector } from '../core/connector.js';
  import { fetchT, headFingerprint, sitemapProbe, looksLikeChallenge, sourceFp, mkRecord, UA, sha256, stableStringify } from '../core/fingerprint.js';
  import { s3List, sparqlSelect, mwRecentChanges } from '../core/web.js';
  import { duckQuery } from '../core/duck.js';
  import { browserEnabled, withPage } from '../core/browser.js';
  import type { SourceConnector } from '../core/types.js';

defineConnector({ id, displayName, tier, coverage, plan:{access,incremental,fingerprint}, run }) -> SourceConnector
  run(input, deps) => Promise<PullBody>
  input:  { sinceTimestamp?:string; lastSnapshotFingerprint?:string; cursor?:string; limit?:number; region?:string }
  deps:   { fetch: typeof fetch; env: Record<string,string|undefined>; log:(m:string)=>void; timeoutMs:number }
  PullBody: {
    status: 'ok'|'partial'|'needs_key'|'needs_license'|'blocked'|'error',
    sourceFingerprint: SourceFingerprint,        // ALWAYS use sourceFp(method, components)
    incremental: { method: IncMethod, supported: boolean, description: string, sinceApplied?: string },
    records?: PulledRecord[],                     // use mkRecord(connectorId, sourceId, content, {name?,lat?,lng?,updated_at?,raw?})
    cursor?: string, notes?: string[], error?: string, unchangedSinceSnapshot?: boolean
  }
  IncMethod = 'api-since-param'|'changes-feed'|'dump-diff'|'sort-by-updated'|'etag-conditional'|'sitemap-lastmod'|'cursor-pagination'|'full-only'|'none'

HELPERS:
  sourceFp(method:string, components:Record<string,string|number>) -> SourceFingerprint  (value = hash of components)
  mkRecord(connectorId, sourceId, content, extra?) -> PulledRecord (computes stable record_uuid + content_hash)
  headFingerprint(fetch, url) -> { fp: SourceFingerprint|null, status:number, headers:Record<string,string> }   // ETag/Last-Modified probe
  sitemapProbe(fetch, url) -> { urlCount, maxLastmod, sampleLoc, challenge? } | null   // follows sitemap-index; sets .challenge if WAF-blocked
  looksLikeChallenge(status, body) -> string|null    // detects Cloudflare/DataDome/PerimeterX/429/451
  fetchT(fetch, url, { method?, headers?, body?, timeoutMs?, allowNotOk? }) -> Response  (throws on !ok unless allowNotOk)
  s3List(fetch, httpsBase, prefix) -> { prefixes, keys }   // anonymous S3 ListObjectsV2
  sparqlSelect(fetch, endpoint, query) -> bindings[]
  duckQuery(sql, {timeoutMs}) -> rows[]   // remote parquet over httpfs
  browserEnabled(env) -> boolean (PROBE_BROWSER=1);  withPage(async page => {...}, {timeoutMs}) -> launches system Chrome (channel:'chrome')

HARD RULES:
1. run() MUST NOT throw. Wrap every network call in try/catch; on failure push a note and return an appropriate status (the framework also wraps, but be defensive).
2. ALWAYS return a sourceFingerprint via sourceFp(...). If you can't fingerprint, use sourceFp('none', {reason:'...'}).
3. The run() must perform a REAL, LIGHTWEIGHT PROBE when executed — choose the cheapest signal that classifies the source:
   - API exists but needs a key  -> do a keyless/HEAD probe to confirm the gate, status 'needs_key', read key from deps.env if present and pull a few records.
   - Paid data license required   -> status 'needs_license', fingerprint via the docs/portal HEAD if reachable.
   - No API, site scrapable       -> sitemapProbe for the fingerprint + incremental; status 'blocked' unless browserEnabled(deps.env) then attempt a small withPage scrape (status 'ok'/'partial').
   - Detect anti-bot via looksLikeChallenge / sitemapProbe().challenge and say so in notes.
   - Respect deps.timeoutMs (pass timeoutMs to fetchT/withPage, leaving ~3-5s headroom). Cap records at min(input.limit ?? 10, 25).
4. plan.incremental and plan.fingerprint must state the BEST realistic method for THIS source (use the per-source hints).
5. Prefer the documented incremental delta: a real since-param > changes-feed/dump-diff > sort-by-updated/sitemap-lastmod > etag-conditional > full-only.
6. Keep it compilable TypeScript with no 'any' surprises; avoid non-null assertions on possibly-undefined; no external imports beyond the list above.
7. You MAY use WebSearch/WebFetch to confirm the real API base URL / sitemap location / whether a public API exists. Do not invent endpoints.

OUTPUT: the module must end with:  export const <EXPORT_NAME>: SourceConnector[] = [ <all connector consts> ];
Return the full module source plus a per-connector summary.
`

const SCHEMA = {
  type: 'object',
  properties: {
    exportName: { type: 'string' },
    filename: { type: 'string' },
    tier: { type: 'string', enum: ['A', 'B', 'C', 'D', 'E'] },
    code: { type: 'string', description: 'Full TypeScript module source' },
    connectors: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          displayName: { type: 'string' },
          incrementalMethod: { type: 'string' },
          fingerprintMethod: { type: 'string' },
          expectedStatus: { type: 'string' },
          note: { type: 'string' },
        },
        required: ['id', 'displayName', 'incrementalMethod', 'fingerprintMethod', 'expectedStatus'],
      },
    },
  },
  required: ['exportName', 'filename', 'tier', 'code', 'connectors'],
}

const CLUSTERS = [
  {
    key: 'tierB-licensable', tier: 'B', exportName: 'licensableConnectors', filename: 'licensable.ts',
    desc: 'Tier B = licensable-commercial (paid data license / partner contract enables ingestion). For these, the realistic prototype probe is: HEAD the developer/docs portal to confirm reachability, classify needs_license (or needs_key if a free dev tier exists and a key env is set), and document the licensed delta + fingerprint. If an env key is present (e.g. REDDIT_*), pull a few records.',
    sources: `
- wikimedia-enterprise (Global; WME Snapshot/Realtime API; free tier 30 req/mo; incremental=Realtime stream/On-demand; fingerprint=snapshot date/namespace). env: WIKIMEDIA_ENTERPRISE_TOKEN.
- safegraph (Global POI, paid; monthly Parquet drops; incremental=monthly delivery (dump-diff); fingerprint=monthly release date). needs_license.
- here-bulk (Global; HERE enterprise Data API/Marketplace bulk; incremental=enterprise delta; fingerprint=dataset version). needs_license. (HERE dev API is a separate Tier C connector.)
- yelp-data-licensing (US reviews; paid Places/AI API; incremental=api-since via fusion business updates; fingerprint=business count+max review date). needs_license. (Free Fusion = Tier C.)
- lonely-planet (Global guides; paid Content Licensing API via ArrivalGuides; incremental=content update feed; fingerprint=content version). needs_license.
- reddit (Global; Reddit Data API OAuth; r/travel etc.; incremental=listing 'before/after' fullnames + 'new' sort (cursor-pagination); fingerprint=newest fullname t3_id). env: REDDIT_CLIENT_ID/REDDIT_SECRET → needs_key; probe www.reddit.com/r/travel/new.json (public json) HEAD.
- retty (Japan; B2B 'Food Data Platform', no public API; incremental=licensed feed; fingerprint=feed delivery date). needs_license; probe retty.me reachability + sitemap.
- siksin (Korea; B2B big-data license; incremental=partner refresh; fingerprint=dataset version). needs_license; probe siksinhot.com sitemap.
- navitime (Japan transit/POI; commercial B2B API; incremental=per-contract; fingerprint=dataset version). needs_license.
- jorudan (Japan transit; Norikae Open API free for embeds + Biz commercial; incremental=timetable revision; fingerprint=timetable version). needs_license/needs_key; probe API base.
- time-out (Global cities; editorial, no self-serve API, licensing case-by-case; incremental=sitemap-lastmod; fingerprint=sitemap). needs_license; sitemapProbe timeout.com.
- placer-ai (US foot-traffic; paid API; incremental=weekly modeling; fingerprint=delivery date). needs_license.
`,
  },
  {
    key: 'tierC-global', tier: 'C', exportName: 'tierCGlobalConnectors', filename: 'global-maps.ts',
    desc: 'Tier C = API exists but ToS forbids caching/vectorizing (display/lookup-only). Probe the public API base/portal; if an API key env var is set, pull a few records to prove reachability, else needs_key. Always document the (usually weak) incremental support + the per-place fingerprint.',
    sources: `
- google-places (Global; Places API New; env GOOGLE_MAPS_API_KEY; incremental=none, no since-param → full-only/re-poll; fingerprint=per-place last_updated not exposed → content_hash of place detail; only place_id storable). needs_key.
- tripadvisor-content (Global; Content API; env TRIPADVISOR_API_KEY; incremental=none (cache location_id only); fingerprint=location_id + content_hash; 50 QPS). needs_key.
- yelp-fusion (US; Fusion free tier; env YELP_API_KEY; incremental=none, 24h cache; fingerprint=business_id+content_hash). needs_key.
- foursquare-places-api (Global; paid Places API live; env FOURSQUARE_API_KEY; incremental=date_refreshed via places search; fingerprint=fsq_id+date_refreshed; 30-day cache). needs_key.
- mapbox (Global; Search Box/Geocoding; env MAPBOX_TOKEN; incremental=none; fingerprint=mapbox_id+content_hash; no bulk). needs_key.
- tomtom (Global; Search/POI; env TOMTOM_API_KEY; incremental=none, 30d cache; fingerprint=poi id+content_hash). needs_key.
- here-dev (Global; Geocoding & Search v7; env HERE_API_KEY; incremental=none, 30d cache; fingerprint=here id+content_hash). needs_key.
- apple-maps (Global; MapKit JS/Server API JWT; env APPLE_MAPS_TOKEN; incremental=none; fingerprint=content_hash; no caching per ToS). needs_key.
- google-hotels (Global; hotel/attraction reviews via Places API; env GOOGLE_MAPS_API_KEY; incremental=none; fingerprint=place_id+content_hash). needs_key.
- untappd (Global beer/venues; Untappd API by approval; env UNTAPPD_CLIENT_ID/SECRET; incremental=checkin id (cursor); fingerprint=max checkin id; 24h cache, no competing DB). needs_key.
- expedia-rapid (Global; Rapid Guest Reviews; partner-gated; env EXPEDIA_RAPID_KEY; incremental=property review pull, 48h cache; fingerprint=property_id+review count). needs_key.
`,
  },
  {
    key: 'tierC-asia', tier: 'C', exportName: 'tierCAsiaConnectors', filename: 'asia-maps.ts',
    desc: 'Tier C Asian maps/APIs. Same display-only posture. Several require a Chinese/Korean/Japanese business entity for keys — note that. Probe public API base.',
    sources: `
- amap (China; Gaode Web Service API; env AMAP_KEY; ToS bans AI training/caching; incremental=none; fingerprint=poi id+content_hash; China entity for full quota). needs_key.
- baidu-maps (China; Place API; env BAIDU_AK; display-only; incremental=none; fingerprint=uid+content_hash). needs_key.
- naver-local (Korea; NAVER Local Search API; env NAVER_CLIENT_ID/SECRET; returns 5 thin POIs/call, NO reviews; incremental=none; fingerprint=count+content_hash). needs_key.
- naver-blog (Korea; NAVER Blog Search API snippets; env NAVER_CLIENT_ID/SECRET; incremental=postdate sort (sort-by-updated); fingerprint=top post link+date). needs_key.
- kakaomap (Korea; Kakao Local REST; env KAKAO_REST_KEY; no reviews in API; incremental=none; fingerprint=place id+content_hash; 100k/day). needs_key.
- hot-pepper-gourmet (Japan; Recruit Gourmet Search API; env RECRUIT_API_KEY; NO user reviews; 24h cache; incremental=none/full-only; fingerprint=shop id+content_hash). needs_key.
- jalan (Japan; Recruit Jalan Web Service; env RECRUIT_API_KEY; hotel reviews; 24h cache; incremental=none; fingerprint=hotel id+review count). needs_key.
`,
  },
  {
    key: 'tierD-ota', tier: 'D', exportName: 'tierDOtaConnectors', filename: 'ota.ts',
    desc: 'Tier D OTAs = partner/affiliate-gated; reviews rarely licensed for AI. Probe the public developer/partner docs portal reachability; classify needs_license/partner; document review delta if any (e.g. Booking change-tracking 24h, Expedia 48h cache) + fingerprint.',
    sources: `
- booking-com (Global; Demand API reviews/scores; partner; incremental=last_change param 24h window (api-since-param); fingerprint=property review count+last_change; data-forwarding forbidden). needs_license.
- agoda (Global APAC; affiliate API, NO review egress; incremental=n/a; fingerprint=property id+content_hash). needs_license.
- klook (APAC; Partner API, reviews display-only; incremental=none; fingerprint=activity id+rating count). needs_license.
- getyourguide (Global; Partner API ratings/reviews by tier; incremental=none; fingerprint=tour id+review count). needs_license.
- viator (Global; Viator Partner API; reviews via product detail, must be non-indexable; incremental=none; fingerprint=product id+review count). needs_license.
- thefork (Europe; Partners API; reviews to partnership sites only; rate 200/min,10k/day; incremental=none; fingerprint=restaurant id+review count). needs_license.
- opentable (Global; partner Directory/Guest API; incremental=none; fingerprint=restaurant id+content_hash). needs_license.
- resy (US; partner API; incremental=none; fingerprint=venue id+content_hash). needs_license.
- hostelworld (Global; Partner API latest reviews; incremental=latest reviews per property (sort-by-updated); fingerprint=property id+review count). needs_license.
- trip-com (Global; connect.trip.com connectivity only, no review egress; incremental=n/a; fingerprint=content_hash; reviews scrape-only). needs_license.
- traveloka (SEA; Atlas/TPN B2B inventory, no review feed; incremental=n/a; fingerprint=property id+content_hash). needs_license.
- chope (SG/HK/TH/ID; partner booking API; incremental=none; fingerprint=restaurant id+content_hash). needs_license.
`,
  },
  {
    key: 'tierD-cn-kr', tier: 'D', exportName: 'tierDCnKrConnectors', filename: 'cn-kr-merchant.ts',
    desc: 'Tier D China/Korea merchant-gated platforms. Open platforms are MERCHANT/ISV-facing (require a Chinese/Korean business license), NOT third-party content APIs. No review egress. Probe open-platform portal reachability; classify needs_license/partner; note the entity requirement; fingerprint via content_hash / merchant-portal availability.',
    sources: `
- meituan (China; open.meituan.com merchant/ISV ops; Chinese license; no review egress; incremental=n/a; fingerprint=content_hash). needs_license.
- mafengwo (China; open.mafengwo.cn merchant commerce; UGC not exported; incremental=n/a; fingerprint=content_hash). needs_license.
- ctrip (China; supplier push + affiliate widgets; incremental=n/a; fingerprint=content_hash). needs_license.
- qunar (China; supplier platform; incremental=n/a; fingerprint=content_hash). needs_license.
- tongcheng (China; supplier-facing; incremental=n/a; fingerprint=content_hash). needs_license.
- fliggy (China; Alibaba/Taobao open platform supplier/ISV; Chinese entity; incremental=n/a; fingerprint=content_hash). needs_license.
- catchtable (Korea; no public API; merchant/POS gated; incremental=n/a; fingerprint=sitemap/content_hash). needs_license/blocked.
- yanolja (Korea; B2B Cloud Solution inventory APIs only; incremental=n/a; fingerprint=content_hash). needs_license.
- yeogi-goodchoice (Korea; merchant Partner Center only; incremental=n/a; fingerprint=content_hash). needs_license/blocked.
`,
  },
  {
    key: 'tierD-tourism', tier: 'D', exportName: 'tierDTourismConnectors', filename: 'tourism-partner.ts',
    desc: 'Tier D partner-gated tourism distribution exchanges + curated. Several have REAL structured APIs gated by distributor agreement (ATDW, TXGB, Visit Finland GraphQL, Tourism NZ). Probe the public API/docs base; if an env key exists pull a few records, else needs_license. AllTrails/Michelin = no public API (blocked/partner).',
    sources: `
- atdw (Australia; ATLAS REST API, distributor license, delta endpoints; env ATDW_API_KEY; incremental=delta product endpoints (api-since-param); fingerprint=product count+max updated). needs_key/license.
- txgb-visitbritain (GB; TXGB B2B booking exchange, distributor onboarding; incremental=live availability; fingerprint=product version). needs_license.
- visit-finland (Finland; DataHub GraphQL, free but accepted users only, internal-business-use; env VISITFINLAND_TOKEN; incremental=product updates; fingerprint=product count+updated). needs_key.
- tourism-nz (NZ; Business DB API by syndication agreement + open stats on data.govt.nz; incremental=operator changes; fingerprint=operator count). needs_license; the data.govt.nz stats side is open (note it).
- michelin-guide (Global; no public API, licensed via TripAdvisor/TheFork; incremental=annual selection; fingerprint=selection year+sitemap). blocked/partner; sitemapProbe guide.michelin.com.
- alltrails (Global trails; no public API, DataDome anti-scrape, licenses deal-by-deal; incremental=sitemap-lastmod; fingerprint=sitemap). blocked; sitemapProbe + note DataDome.
- factual (defunct→Foursquare; no independent product; incremental=n/a; fingerprint=none). blocked; note merged into Foursquare 2020, use FSQ OS Places.
`,
  },
  {
    key: 'tierE-cn', tier: 'E', exportName: 'tierECnConnectors', filename: 'cn-community.ts',
    desc: 'Tier E China community giants = no sanctioned access, aggressive anti-bot + AUCL legal risk. Probe homepage/sitemap to detect anti-bot (looksLikeChallenge / signed-request walls). Document scrape-only/risky + the heuristic fingerprint (sitemap-lastmod if reachable, else content_hash of listing). Browser path gated by PROBE_BROWSER.',
    sources: `
- dianping (China; 大众点评; glyph-obfuscated/encrypted reviews, signed requests; incremental=sitemap-lastmod if any else full-only; fingerprint=content_hash). blocked/risky.
- xiaohongshu (China; 小红书/RED; xsec_token signing, heavy anti-bot; incremental=none; fingerprint=content_hash). blocked/risky.
- qyer (China; 穷游网 outbound guides; incremental=sitemap-lastmod; fingerprint=sitemap). blocked/risky.
- douyin-life (China; 抖音生活服务 video店探; merchant-only, no content egress; incremental=none; fingerprint=content_hash). blocked/risky.
`,
  },
  {
    key: 'tierE-asia', tier: 'E', exportName: 'tierEAsiaConnectors', filename: 'asia-community.ts',
    desc: 'Tier E Asian community/food review sites with no sanctioned content API (only merchant/POS or defunct APIs). Probe sitemap + homepage; detect anti-bot; classify blocked/risky; sitemap-lastmod fingerprint where reachable. Note where a real public API was discontinued (Zomato).',
    sources: `
- tabelog (Japan; 食べログ; ToS bans copying; structured HTML; incremental=sitemap-lastmod; fingerprint=sitemap maxLastmod). blocked/risky; sitemapProbe tabelog.com.
- wongnai (Thailand; LINE MAN Wongnai; only merchant/POS API; 900k eateries; incremental=sitemap-lastmod; fingerprint=sitemap). blocked/risky; sitemapProbe wongnai.com.
- zomato (India; public content API DISCONTINUED ~2022, POS-only now; incremental=none; fingerprint=content_hash). blocked; probe + note discontinued.
- swiggy-dineout (India; no public content API, POS partner only; incremental=none; fingerprint=content_hash). blocked.
- magicpin (India; ToS bans automated access; incremental=sitemap-lastmod; fingerprint=sitemap). blocked/risky.
- burpple (SG/MY; no API, dynamic load-more; incremental=sitemap-lastmod; fingerprint=sitemap). blocked/risky.
- hungrygowhere (Singapore; Grab editorial, no API; incremental=sitemap-lastmod; fingerprint=sitemap). blocked.
- foody-shopeefood (Vietnam; no open API; incremental=sitemap-lastmod; fingerprint=sitemap). blocked/risky.
- eatigo (TH/SG/MY/HK/IN; ToS explicitly bans AI/automated scraping; incremental=none; fingerprint=content_hash). blocked.
- qraved (Indonesia; no API, continuity uncertain; incremental=sitemap-lastmod; fingerprint=sitemap). blocked/risky.
- diningcode (Korea; no API, aggregated DB, DB-producer-rights risk; incremental=sitemap-lastmod; fingerprint=sitemap). blocked/risky.
`,
  },
  {
    key: 'tierE-global', tier: 'E', exportName: 'tierEGlobalConnectors', filename: 'global-community.ts',
    desc: 'Tier E global niche/community with no ingestion path. Probe sitemap/API; some have a public JSON (Reddit-style) or RSS; detect anti-bot. happycow=no API; airbnb=closed API+anti-scrape; tripadvisor-forums=not in Content API. Browser path gated.',
    sources: `
- happycow (Global vegan; no API, copyright UGC; incremental=sitemap-lastmod; fingerprint=sitemap). blocked; sitemapProbe happycow.net.
- culture-trip (Global editorial; no outbound API; incremental=sitemap-lastmod; fingerprint=sitemap). blocked.
- airbnb (Global; API closed/NDA, reviews not licensed, anti-scrape; incremental=none; fingerprint=content_hash). blocked.
- tripadvisor-forums (Global; NOT in Content API, ToS bans bots/AI scraping; incremental=sitemap-lastmod; fingerprint=sitemap). blocked.
- foursquare-consumer (Global; Swarm/City Guide, no bulk license, City Guide sunset 2024-25; incremental=none; fingerprint=content_hash). blocked.
- jnto-content (Japan; editorial copyrighted + application-gated stats, no POI feed; incremental=sitemap-lastmod; fingerprint=sitemap). blocked; sitemapProbe japan.travel.
`,
  },
  {
    key: 'russia-mena', tier: 'E', exportName: 'russiaMenaConnectors', filename: 'russia-mena.ts',
    desc: 'UNVERIFIED cluster (Russia/CIS, MENA, other). Use WebSearch/WebFetch to confirm whether each has a real API before classifying. 2GIS and Yandex DO have public APIs (likely needs_key / display-only); Sygic has a Travel API. Probe accordingly; note region-lock/sanctions where relevant. Mark notes that this cluster is lower-confidence.',
    sources: `
- 2gis (Russia/CIS; 2GIS Catalog/Places API + MapGL; env TWOGIS_KEY; likely needs_key, display-oriented; incremental=none; fingerprint=branch id+content_hash; verify API base catalog.api.2gis.com). needs_key.
- yandex-maps (Russia/CIS; Yandex Geosearch/Places API; env YANDEX_API_KEY; needs_key, display-only; incremental=none; fingerprint=org id+content_hash). needs_key.
- yandex-eda (Russia; food delivery; no public content API; incremental=none; fingerprint=content_hash). blocked.
- talabat (MENA; Delivery Hero; no public content API; incremental=sitemap-lastmod; fingerprint=sitemap). blocked.
- sygic-travel (Global trip-planning; Sygic Travel API places/tours; env SYGIC_API_KEY; incremental=none; fingerprint=place id+content_hash; verify api.sygictravelapi.com). needs_key.
`,
  },
]

phase('Generate')
const results = await pipeline(
  CLUSTERS,
  (cluster) =>
    agent(
      `${CONTRACT}\n\n=== YOUR CLUSTER: ${cluster.key} (tier ${cluster.tier}) ===\n${cluster.desc}\n\nWrite ONE module exporting \`export const ${cluster.exportName}: SourceConnector[] = [...]\` (filename ${cluster.filename}) containing a connector for EACH source below. Use the per-source hints for plan.incremental/plan.fingerprint and the expected status. id = the kebab id shown.\n\nSOURCES:${cluster.sources}\n\nReturn exportName='${cluster.exportName}', filename='${cluster.filename}', tier='${cluster.tier}', the full module code, and the per-connector summary.`,
      { label: `gen:${cluster.key}`, phase: 'Generate', schema: SCHEMA },
    ),
  (gen, cluster) => {
    if (!gen) return gen
    return agent(
      `${CONTRACT}\n\nSelf-review this generated module for cluster ${cluster.key}. Fix ANY of: wrong import paths/symbols, imports of things not in the allowed list, run() that can throw uncaught, missing sourceFp, invalid status/IncMethod enum values, TypeScript errors (undefined vars, bad types, non-null assertions on possibly-undefined), or a missing \`export const ${cluster.exportName}: SourceConnector[] = [...]\` at the end. Return the corrected module (same exportName/filename/tier) and the connector summary. If already correct, return it unchanged.\n\nMODULE:\n\`\`\`ts\n${gen.code}\n\`\`\``,
      { label: `review:${cluster.key}`, phase: 'Review', schema: SCHEMA },
    )
  },
)

const ok = results.filter(Boolean)
log(`Generated ${ok.length}/${CLUSTERS.length} cluster modules; ${ok.reduce((a, r) => a + (r.connectors?.length ?? 0), 0)} connectors total`)
return { modules: ok }
