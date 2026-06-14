/**
 * Tier C — Asian maps / local-search APIs (display-only posture).
 *
 * Every source here is a key-gated commercial API: there is no open bulk dump
 * and no public keyless query path, so the realistic experiment is a KEYLESS /
 * HEAD probe that confirms the auth gate, then — if a key is present in
 * deps.env — a tiny live pull (capped) to prove the shape. Several require a
 * mainland-Chinese / Korean / Japanese registered business entity to obtain a
 * key (and, for the Recruit family, only after corporate review), which we note
 * explicitly per connector.
 *
 * Incremental reality for this cluster: none of these expose a server-side
 * `updated_since` filter on POIs. They are point-lookup search APIs whose ToS
 * is display-only (Amap/Baidu/Kakao even forbid persistent caching / AI
 * training). The honest delta is therefore `full-only` (re-query + diff by
 * content_hash) for the place APIs, with ONE genuine exception: NAVER Blog
 * search supports `sort=date`, a real sort-by-updated recency feed.
 *
 * Confirmed public bases (search done, not invented):
 *   amap     https://restapi.amap.com/v3/place/text        ?key=
 *   baidu    https://api.map.baidu.com/place/v2/search     ?ak=
 *   naver    https://openapi.naver.com/v1/search/{local,blog}.json  (X-Naver-Client-Id/Secret)
 *   kakao    https://dapi.kakao.com/v2/local/search/keyword.json     (Authorization: KakaoAK <key>)
 *   recruit  https://webservice.recruit.co.jp/hotpepper/gourmet/v1/  ?key=
 *   jalan    https://jws.jalan.net/APILite/HotelSearch/V1/           ?key=  (XML)
 */
import { defineConnector } from '../core/connector.js';
import { fetchT, mkRecord, sourceFp, UA } from '../core/fingerprint.js';
import type { SourceConnector } from '../core/types.js';

/** Trim a freeform string from any source for safe note display. */
function clip(s: string, n = 80): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/* ------------------------------------------------------------------ amap --- */
export const amap = defineConnector({
  id: 'amap',
  displayName: 'Amap / Gaode Maps (Web Service API)',
  tier: 'C',
  coverage: 'China; ZH; commercial POI — display-only, no caching/AI-training',
  plan: {
    access:
      'Gaode Web Service REST (restapi.amap.com), key required (AMAP_KEY). Full quota needs a mainland-China registered business entity (实名认证).',
    incremental:
      'No since-param on POI search; ToS forbids persistent caching, so delta = re-query + diff by content_hash (full-only).',
    fingerprint: 'poi id + content_hash (per-record); snapshot = sampled poi-id set + count',
  },
  async run(input, deps) {
    const key = deps.env.AMAP_KEY;
    const timeoutMs = Math.max(5_000, deps.timeoutMs - 4_000);
    const base = 'https://restapi.amap.com/v3/place/text';
    const q = new URLSearchParams({
      keywords: input.region ?? '景点',
      city: '北京',
      offset: String(Math.min(input.limit ?? 10, 25)),
      page: '1',
      key: key ?? '',
    });
    const url = `${base}?${q}`;
    // Amap returns HTTP 200 with an error envelope (status:'0', infocode) when
    // the key is missing/invalid — so we always parse the body to classify.
    let status = 0;
    let info = '';
    let infocode = '';
    let body: { status?: string; info?: string; infocode?: string; count?: string; pois?: Array<Record<string, unknown>> } = {};
    try {
      const res = await fetchT(deps.fetch, url, { headers: { 'User-Agent': UA }, timeoutMs, allowNotOk: true });
      status = res.status;
      body = (await res.json()) as typeof body;
      info = body.info ?? '';
      infocode = body.infocode ?? '';
    } catch (e) {
      return {
        status: 'error',
        sourceFingerprint: sourceFp('none', { reason: 'network error probing restapi.amap.com' }),
        incremental: { method: 'full-only', supported: false, description: 'No since-param; ToS forbids caching. Re-query + diff by content_hash.' },
        notes: [`Probe to ${base} failed: ${e instanceof Error ? e.message : String(e)}`],
      };
    }

    if (!key) {
      return {
        status: 'needs_key',
        sourceFingerprint: sourceFp('keyless-gate', { http: status, info: clip(info, 40), infocode }),
        incremental: { method: 'none', supported: false, description: 'POI search has no updated_since filter; display-only ToS forbids caching → full re-pull + content_hash diff is the only delta.' },
        notes: [
          `No AMAP_KEY set. Keyless probe → HTTP ${status}, info="${clip(info, 40)}" infocode=${infocode} (expect INVALID_USER_KEY / MISSING). Gate confirmed.`,
          'Key requires Gaode account; full quota requires a mainland-China business entity (实名认证).',
          'ToS bans persistent caching and AI-training use of returned POIs — display-only.',
        ],
      };
    }

    // Keyed path. infocode '10000' = OK; anything else is a keyed error.
    if (infocode !== '10000') {
      return {
        status: 'needs_key',
        sourceFingerprint: sourceFp('keyed-error', { http: status, info: clip(info, 40), infocode }),
        incremental: { method: 'none', supported: false, description: 'No since-param; display-only ToS → full re-pull + content_hash diff.' },
        notes: [`AMAP_KEY present but rejected: info="${clip(info, 40)}" infocode=${infocode}. Check entity verification / referer whitelist / daily quota.`],
      };
    }
    const pois = body.pois ?? [];
    const records = pois.slice(0, Math.min(input.limit ?? 10, 25)).map((p) => {
      const id = String(p.id ?? p.name ?? '');
      const loc = typeof p.location === 'string' ? p.location.split(',') : [];
      const lng = loc[0] ? Number(loc[0]) : undefined;
      const lat = loc[1] ? Number(loc[1]) : undefined;
      return mkRecord('amap', id, p, { name: typeof p.name === 'string' ? p.name : undefined, lat, lng, raw: p });
    });
    return {
      status: 'ok',
      sourceFingerprint: sourceFp('poi-id-set+count', { count: body.count ?? records.length, ids: records.map((r) => r.source_id).join(',') }),
      incremental: { method: 'none', supported: false, description: 'No updated_since on POI search. ToS forbids caching, so production delta = periodic re-query of the same keyword/bbox + content_hash diff (full-only).' },
      records,
      notes: ['Pulled live via AMAP_KEY. Display-only: do NOT persist beyond session per Gaode ToS (no AI-training).'],
    };
  },
});

/* ------------------------------------------------------------- baidu-maps --- */
export const baiduMaps = defineConnector({
  id: 'baidu-maps',
  displayName: 'Baidu Maps (Place API)',
  tier: 'C',
  coverage: 'China; ZH; commercial POI — display-only',
  plan: {
    access: 'Baidu Maps Place API (api.map.baidu.com), ak required (BAIDU_AK). Key needs a Baidu developer account; high quota / commercial use needs a China business entity.',
    incremental: 'No since-param; display-only → full re-pull + content_hash diff (full-only).',
    fingerprint: 'uid + content_hash (per-record); snapshot = sampled uid set + count',
  },
  async run(input, deps) {
    const ak = deps.env.BAIDU_AK;
    const timeoutMs = Math.max(5_000, deps.timeoutMs - 4_000);
    const base = 'https://api.map.baidu.com/place/v2/search';
    const q = new URLSearchParams({
      query: input.region ?? '景点',
      region: '北京',
      output: 'json',
      page_size: String(Math.min(input.limit ?? 10, 20)),
      ak: ak ?? '',
    });
    const url = `${base}?${q}`;
    // Baidu also answers HTTP 200 with status!=0 when ak is bad → parse body.
    let http = 0;
    let bstatus = -1;
    let message = '';
    let body: { status?: number; message?: string; total?: number; results?: Array<Record<string, unknown>> } = {};
    try {
      const res = await fetchT(deps.fetch, url, { headers: { 'User-Agent': UA }, timeoutMs, allowNotOk: true });
      http = res.status;
      body = (await res.json()) as typeof body;
      bstatus = typeof body.status === 'number' ? body.status : -1;
      message = body.message ?? '';
    } catch (e) {
      return {
        status: 'error',
        sourceFingerprint: sourceFp('none', { reason: 'network error probing api.map.baidu.com' }),
        incremental: { method: 'full-only', supported: false, description: 'No since-param; display-only → full re-pull + content_hash diff.' },
        notes: [`Probe to ${base} failed: ${e instanceof Error ? e.message : String(e)}`],
      };
    }

    if (!ak) {
      return {
        status: 'needs_key',
        sourceFingerprint: sourceFp('keyless-gate', { http, status: bstatus, message: clip(message, 40) }),
        incremental: { method: 'none', supported: false, description: 'Place API has no updated_since filter; display-only ToS → full re-pull + content_hash diff.' },
        notes: [
          `No BAIDU_AK set. Keyless probe → HTTP ${http}, status=${bstatus} message="${clip(message, 40)}" (expect status=200/210 = AK/permission error). Gate confirmed.`,
          'ak requires a Baidu developer account; commercial quota requires a China business entity (实名认证). Display-only ToS.',
        ],
      };
    }

    // status 0 = OK for Baidu webservice.
    if (bstatus !== 0) {
      return {
        status: 'needs_key',
        sourceFingerprint: sourceFp('keyed-error', { http, status: bstatus, message: clip(message, 40) }),
        incremental: { method: 'none', supported: false, description: 'No since-param; display-only → full re-pull + content_hash diff.' },
        notes: [`BAIDU_AK present but rejected: status=${bstatus} message="${clip(message, 40)}". Check SN/IP whitelist, quota, or service entitlement.`],
      };
    }
    const results = body.results ?? [];
    const records = results.slice(0, Math.min(input.limit ?? 10, 20)).map((r) => {
      const id = String(r.uid ?? r.name ?? '');
      const loc = (r.location ?? {}) as { lat?: number; lng?: number };
      return mkRecord('baidu-maps', id, r, { name: typeof r.name === 'string' ? r.name : undefined, lat: loc.lat, lng: loc.lng, raw: r });
    });
    return {
      status: 'ok',
      sourceFingerprint: sourceFp('uid-set+count', { total: body.total ?? records.length, uids: records.map((r) => r.source_id).join(',') }),
      incremental: { method: 'none', supported: false, description: 'No updated_since; production delta = periodic re-query + content_hash diff (full-only). Note: Baidu coords are BD-09; convert before joining other sources.' },
      records,
      notes: ['Pulled live via BAIDU_AK. Display-only ToS; coordinates are BD-09.'],
    };
  },
});

/* ------------------------------------------------- shared NAVER probe util --- */
type NaverCreds = { id: string; secret: string } | null;
function naverCreds(env: Record<string, string | undefined>): NaverCreds {
  const id = env.NAVER_CLIENT_ID;
  const secret = env.NAVER_CLIENT_SECRET;
  return id && secret ? { id, secret } : null;
}

/* ------------------------------------------------------------ naver-local --- */
export const naverLocal = defineConnector({
  id: 'naver-local',
  displayName: 'NAVER Local Search API',
  tier: 'C',
  coverage: 'Korea; KO; thin local listings (max 5/call, NO reviews)',
  plan: {
    access:
      'NAVER OpenAPI Local Search (openapi.naver.com/v1/search/local.json), X-Naver-Client-Id/Secret. App registered via a NAVER Developers account.',
    incremental: 'No since-param; returns ≤5 POIs/call sorted by relevance → full re-query + content_hash diff (none).',
    fingerprint: 'result count + content_hash of the title/address set',
  },
  async run(input, deps) {
    const creds = naverCreds(deps.env);
    const timeoutMs = Math.max(5_000, deps.timeoutMs - 4_000);
    const base = 'https://openapi.naver.com/v1/search/local.json';
    const display = Math.min(input.limit ?? 5, 5); // hard API cap: 5
    const q = new URLSearchParams({ query: input.region ?? '맛집', display: String(display) });
    const url = `${base}?${q}`;
    const headers: Record<string, string> = {
      'User-Agent': UA,
      'X-Naver-Client-Id': creds?.id ?? 'probe',
      'X-Naver-Client-Secret': creds?.secret ?? 'probe',
    };

    let http = 0;
    let bodyText = '';
    let body: { total?: number; items?: Array<Record<string, unknown>>; errorCode?: string; errorMessage?: string } = {};
    try {
      const res = await fetchT(deps.fetch, url, { headers, timeoutMs, allowNotOk: true });
      http = res.status;
      bodyText = await res.text();
      try {
        body = JSON.parse(bodyText) as typeof body;
      } catch {
        /* non-JSON error page */
      }
    } catch (e) {
      return {
        status: 'error',
        sourceFingerprint: sourceFp('none', { reason: 'network error probing openapi.naver.com local' }),
        incremental: { method: 'none', supported: false, description: 'No since-param; full re-query + content_hash diff.' },
        notes: [`Probe to ${base} failed: ${e instanceof Error ? e.message : String(e)}`],
      };
    }

    if (!creds) {
      return {
        status: 'needs_key',
        sourceFingerprint: sourceFp('keyless-gate', { http, errorCode: body.errorCode ?? '', snippet: clip(bodyText, 40) }),
        incremental: { method: 'none', supported: false, description: 'Local search has no updated_since; ≤5 results/call → delta is full re-query + content_hash diff.' },
        notes: [
          `No NAVER_CLIENT_ID/SECRET set. Probe → HTTP ${http} errorCode=${body.errorCode ?? '?'} (expect 401 Authentication failed). Gate confirmed.`,
          'Credentials = a registered application under a NAVER Developers account. API returns max 5 thin POIs/call and NO user reviews.',
        ],
      };
    }
    if (http !== 200) {
      return {
        status: 'needs_key',
        sourceFingerprint: sourceFp('keyed-error', { http, errorCode: body.errorCode ?? '', message: clip(body.errorMessage ?? '', 40) }),
        incremental: { method: 'none', supported: false, description: 'No since-param; full re-query + content_hash diff.' },
        notes: [`NAVER creds present but rejected: HTTP ${http} errorCode=${body.errorCode ?? '?'} "${clip(body.errorMessage ?? '', 40)}". Check app status / daily quota (25k/day).`],
      };
    }
    const items = body.items ?? [];
    const records = items.map((it) => {
      const title = typeof it.title === 'string' ? it.title.replace(/<\/?b>/g, '') : '';
      const sid = title || String(it.link ?? '');
      // NAVER returns mapx/mapy as KATECH/WGS84*1e7 integers (string).
      const mapx = typeof it.mapx === 'string' ? Number(it.mapx) : undefined;
      const mapy = typeof it.mapy === 'string' ? Number(it.mapy) : undefined;
      return mkRecord('naver-local', sid, it, {
        name: title || undefined,
        lng: mapx && mapx > 1_000_000 ? mapx / 1e7 : mapx,
        lat: mapy && mapy > 1_000_000 ? mapy / 1e7 : mapy,
        raw: it,
      });
    });
    return {
      status: 'ok',
      sourceFingerprint: sourceFp('count+content-hash', { total: body.total ?? records.length, titles: records.map((r) => r.source_id).join('|') }),
      incremental: { method: 'none', supported: false, description: 'No updated_since and only ≤5 POIs/call; production delta = re-query the same term + content_hash diff (full-only). No reviews available.' },
      records,
      notes: ['Pulled live via NAVER creds. Thin POIs (title/address/category), NO reviews; coords need KATECH→WGS84 handling.'],
    };
  },
});

/* ------------------------------------------------------------- naver-blog --- */
export const naverBlog = defineConnector({
  id: 'naver-blog',
  displayName: 'NAVER Blog Search API',
  tier: 'C',
  coverage: 'Korea; KO; blog post snippets (UGC review proxy)',
  plan: {
    access: 'NAVER OpenAPI Blog Search (openapi.naver.com/v1/search/blog.json), X-Naver-Client-Id/Secret.',
    incremental: 'sort=date returns newest posts first → walk until older than sinceTimestamp (sort-by-updated).',
    fingerprint: 'top post link + postdate (newest item is the change signal)',
  },
  async run(input, deps) {
    const creds = naverCreds(deps.env);
    const timeoutMs = Math.max(5_000, deps.timeoutMs - 4_000);
    const base = 'https://openapi.naver.com/v1/search/blog.json';
    const display = Math.min(input.limit ?? 10, 25);
    const q = new URLSearchParams({ query: input.region ?? '서울 맛집', display: String(display), sort: 'date' });
    const url = `${base}?${q}`;
    const headers: Record<string, string> = {
      'User-Agent': UA,
      'X-Naver-Client-Id': creds?.id ?? 'probe',
      'X-Naver-Client-Secret': creds?.secret ?? 'probe',
    };

    let http = 0;
    let bodyText = '';
    let body: { total?: number; items?: Array<{ title?: string; link?: string; postdate?: string; bloggername?: string }>; errorCode?: string; errorMessage?: string } = {};
    try {
      const res = await fetchT(deps.fetch, url, { headers, timeoutMs, allowNotOk: true });
      http = res.status;
      bodyText = await res.text();
      try {
        body = JSON.parse(bodyText) as typeof body;
      } catch {
        /* non-JSON error page */
      }
    } catch (e) {
      return {
        status: 'error',
        sourceFingerprint: sourceFp('none', { reason: 'network error probing openapi.naver.com blog' }),
        incremental: { method: 'sort-by-updated', supported: true, description: 'sort=date newest-first; walk until older than since. Probe failed this run.' },
        notes: [`Probe to ${base} failed: ${e instanceof Error ? e.message : String(e)}`],
      };
    }

    const incDesc =
      'sort=date returns posts newest-first; page until a post is older than sinceTimestamp (postdate is yyyymmdd). Real recency feed, but date granularity is a day.';
    if (!creds) {
      return {
        status: 'needs_key',
        sourceFingerprint: sourceFp('keyless-gate', { http, errorCode: body.errorCode ?? '', snippet: clip(bodyText, 40) }),
        incremental: { method: 'sort-by-updated', supported: true, description: incDesc },
        notes: [
          `No NAVER_CLIENT_ID/SECRET set. Probe → HTTP ${http} errorCode=${body.errorCode ?? '?'} (expect 401). Gate confirmed.`,
          'Same NAVER Developers app credentials as naver-local. Snippets only (no full post body).',
        ],
      };
    }
    if (http !== 200) {
      return {
        status: 'needs_key',
        sourceFingerprint: sourceFp('keyed-error', { http, errorCode: body.errorCode ?? '', message: clip(body.errorMessage ?? '', 40) }),
        incremental: { method: 'sort-by-updated', supported: true, description: incDesc },
        notes: [`NAVER creds present but rejected: HTTP ${http} errorCode=${body.errorCode ?? '?'} "${clip(body.errorMessage ?? '', 40)}".`],
      };
    }
    const items = body.items ?? [];
    const since = input.sinceTimestamp ? input.sinceTimestamp.slice(0, 10).replace(/-/g, '') : undefined; // yyyymmdd
    const kept = since ? items.filter((it) => (it.postdate ?? '99999999') >= since) : items;
    const records = kept.map((it) => {
      const title = (it.title ?? '').replace(/<\/?b>/g, '');
      const link = it.link ?? title;
      return mkRecord('naver-blog', link, it, {
        name: title || undefined,
        updated_at: it.postdate, // yyyymmdd
        raw: it,
      });
    });
    const top = items[0];
    return {
      status: 'ok',
      sourceFingerprint: sourceFp('top-link+postdate', { topLink: clip(top?.link ?? '', 60), topDate: top?.postdate ?? '', total: body.total ?? 0 }),
      incremental: { method: 'sort-by-updated', supported: true, description: incDesc, sinceApplied: input.sinceTimestamp },
      records,
      notes: [
        `Pulled live via NAVER creds; ${records.length} posts kept${since ? ` (postdate >= ${since})` : ''}.`,
        'Best delta in this cluster: newest-first sort makes blog mentions a real recency feed (UGC proxy, not structured reviews).',
      ],
    };
  },
});

/* --------------------------------------------------------------- kakaomap --- */
export const kakaomap = defineConnector({
  id: 'kakaomap',
  displayName: 'KakaoMap (Kakao Local REST)',
  tier: 'C',
  coverage: 'Korea; KO; commercial POI (no reviews in API)',
  plan: {
    access:
      'Kakao Local REST (dapi.kakao.com/v2/local), Authorization: KakaoAK <KAKAO_REST_KEY>. App registered via Kakao Developers; ~100k calls/day.',
    incremental: 'No since-param; cursor pagination only within a query → full re-query + content_hash diff (none).',
    fingerprint: 'place id + content_hash (per-record); snapshot = sampled place-id set + total_count',
  },
  async run(input, deps) {
    const key = deps.env.KAKAO_REST_KEY;
    const timeoutMs = Math.max(5_000, deps.timeoutMs - 4_000);
    const base = 'https://dapi.kakao.com/v2/local/search/keyword.json';
    const size = Math.min(input.limit ?? 10, 15); // API page cap = 15
    const q = new URLSearchParams({ query: input.region ?? '맛집', size: String(size) });
    const url = `${base}?${q}`;
    const headers: Record<string, string> = {
      'User-Agent': UA,
      Authorization: `KakaoAK ${key ?? 'probe'}`,
    };

    let http = 0;
    let bodyText = '';
    let body: { meta?: { total_count?: number; is_end?: boolean }; documents?: Array<Record<string, unknown>>; code?: number; msg?: string } = {};
    try {
      const res = await fetchT(deps.fetch, url, { headers, timeoutMs, allowNotOk: true });
      http = res.status;
      bodyText = await res.text();
      try {
        body = JSON.parse(bodyText) as typeof body;
      } catch {
        /* error page */
      }
    } catch (e) {
      return {
        status: 'error',
        sourceFingerprint: sourceFp('none', { reason: 'network error probing dapi.kakao.com' }),
        incremental: { method: 'none', supported: false, description: 'No since-param; full re-query + content_hash diff.' },
        notes: [`Probe to ${base} failed: ${e instanceof Error ? e.message : String(e)}`],
      };
    }

    if (!key) {
      return {
        status: 'needs_key',
        sourceFingerprint: sourceFp('keyless-gate', { http, code: body.code ?? '', msg: clip(body.msg ?? bodyText, 40) }),
        incremental: { method: 'none', supported: false, description: 'Local keyword search has no updated_since; only intra-query cursor pages. Delta = full re-query + content_hash diff.' },
        notes: [
          `No KAKAO_REST_KEY set. Probe → HTTP ${http} code=${body.code ?? '?'} (expect 401 / -1 unauthorized). Gate confirmed.`,
          'Key = a Kakao Developers app REST key; ~100k calls/day. API exposes NO reviews.',
        ],
      };
    }
    if (http !== 200) {
      return {
        status: 'needs_key',
        sourceFingerprint: sourceFp('keyed-error', { http, code: body.code ?? '', msg: clip(body.msg ?? '', 40) }),
        incremental: { method: 'none', supported: false, description: 'No since-param; full re-query + content_hash diff.' },
        notes: [`KAKAO_REST_KEY present but rejected: HTTP ${http} code=${body.code ?? '?'} "${clip(body.msg ?? '', 40)}". Check app activation / platform (web origin) settings.`],
      };
    }
    const docs = body.documents ?? [];
    const records = docs.slice(0, size).map((d) => {
      const id = String(d.id ?? d.place_name ?? '');
      const x = typeof d.x === 'string' ? Number(d.x) : undefined; // lng
      const y = typeof d.y === 'string' ? Number(d.y) : undefined; // lat
      return mkRecord('kakaomap', id, d, { name: typeof d.place_name === 'string' ? d.place_name : undefined, lat: y, lng: x, raw: d });
    });
    return {
      status: 'ok',
      sourceFingerprint: sourceFp('place-id-set+total', { total: body.meta?.total_count ?? records.length, ids: records.map((r) => r.source_id).join(',') }),
      incremental: { method: 'none', supported: false, description: 'No updated_since; production delta = periodic re-query of the same term/bbox + content_hash diff (full-only). No reviews in API.' },
      records,
      notes: ['Pulled live via KAKAO_REST_KEY. POIs only (place_name/category/coords); no reviews. Coords are WGS84.'],
    };
  },
});

/* ------------------------------------------------- shared Recruit key util --- */
function recruitKey(env: Record<string, string | undefined>): string | undefined {
  return env.RECRUIT_API_KEY;
}

/* ------------------------------------------------------ hot-pepper-gourmet --- */
export const hotPepperGourmet = defineConnector({
  id: 'hot-pepper-gourmet',
  displayName: 'Hot Pepper Gourmet (Recruit)',
  tier: 'C',
  coverage: 'Japan; JA; restaurants (NO user reviews); 24h cache rule',
  plan: {
    access:
      'Recruit WebService Gourmet Search (webservice.recruit.co.jp/hotpepper/gourmet/v1), ?key=RECRUIT_API_KEY. Account requires a Japanese registration; ToS mandates ≤24h caching.',
    incremental: 'No since-param; ToS allows ≤24h cache only → re-pull + content_hash diff (full-only).',
    fingerprint: 'shop id + content_hash (per-record); snapshot = sampled shop-id set + results_available',
  },
  async run(input, deps) {
    const key = recruitKey(deps.env);
    const timeoutMs = Math.max(5_000, deps.timeoutMs - 4_000);
    const base = 'https://webservice.recruit.co.jp/hotpepper/gourmet/v1/';
    const count = Math.min(input.limit ?? 10, 25);
    const q = new URLSearchParams({
      key: key ?? '',
      keyword: input.region ?? '東京',
      count: String(count),
      format: 'json',
    });
    const url = `${base}?${q}`;
    const incDesc = 'No updated_since; ToS permits caching results for ≤24h only, so production delta = periodic re-pull + content_hash diff (full-only).';

    let http = 0;
    let bodyText = '';
    let body: { results?: { results_available?: number; shop?: Array<Record<string, unknown>>; error?: Array<{ code?: number; message?: string }> } } = {};
    try {
      const res = await fetchT(deps.fetch, url, { headers: { 'User-Agent': UA }, timeoutMs, allowNotOk: true });
      http = res.status;
      bodyText = await res.text();
      try {
        body = JSON.parse(bodyText) as typeof body;
      } catch {
        /* XML/error page */
      }
    } catch (e) {
      return {
        status: 'error',
        sourceFingerprint: sourceFp('none', { reason: 'network error probing webservice.recruit.co.jp gourmet' }),
        incremental: { method: 'full-only', supported: false, description: incDesc },
        notes: [`Probe to ${base} failed: ${e instanceof Error ? e.message : String(e)}`],
      };
    }

    const apiError = body.results?.error?.[0];
    if (!key) {
      return {
        status: 'needs_key',
        sourceFingerprint: sourceFp('keyless-gate', { http, errCode: apiError?.code ?? '', errMsg: clip(apiError?.message ?? bodyText, 40) }),
        incremental: { method: 'none', supported: false, description: incDesc },
        notes: [
          `No RECRUIT_API_KEY set. Probe → HTTP ${http}${apiError ? `, error code=${apiError.code} "${clip(apiError.message ?? '', 40)}"` : ''} (expect 2000-class "missing API key"). Gate confirmed.`,
          'Key requires a Recruit WebService account (Japanese registration). API returns NO user reviews; ToS caps caching at 24h.',
        ],
      };
    }
    if (http !== 200 || apiError) {
      return {
        status: 'needs_key',
        sourceFingerprint: sourceFp('keyed-error', { http, errCode: apiError?.code ?? '', errMsg: clip(apiError?.message ?? '', 40) }),
        incremental: { method: 'none', supported: false, description: incDesc },
        notes: [`RECRUIT_API_KEY present but rejected: HTTP ${http} code=${apiError?.code ?? '?'} "${clip(apiError?.message ?? '', 40)}".`],
      };
    }
    const shops = body.results?.shop ?? [];
    const records = shops.slice(0, count).map((s) => {
      const id = String(s.id ?? s.name ?? '');
      return mkRecord('hot-pepper-gourmet', id, s, {
        name: typeof s.name === 'string' ? s.name : undefined,
        lat: typeof s.lat === 'number' ? s.lat : undefined,
        lng: typeof s.lng === 'number' ? s.lng : undefined,
        raw: s,
      });
    });
    return {
      status: 'ok',
      sourceFingerprint: sourceFp('shop-id-set+available', { available: body.results?.results_available ?? records.length, ids: records.map((r) => r.source_id).join(',') }),
      incremental: { method: 'none', supported: false, description: incDesc },
      records,
      notes: ['Pulled live via RECRUIT_API_KEY. Restaurant master data only — NO user reviews. Respect the 24h cache ToS.'],
    };
  },
});

/* ------------------------------------------------------------------ jalan --- */
export const jalan = defineConnector({
  id: 'jalan',
  displayName: 'Jalan Web Service (Recruit)',
  tier: 'C',
  coverage: 'Japan; JA; hotels/ryokan incl. user reviews; 24h cache rule',
  plan: {
    access:
      'Recruit Jalan WebService Hotel Search (jws.jalan.net/APILite/HotelSearch/V1), ?key=RECRUIT_API_KEY (XML). Account requires Japanese registration; ToS mandates ≤24h caching.',
    incremental: 'No since-param; review-count drift is the change signal → re-pull + diff (full-only / none).',
    fingerprint: 'hotel id + review count (numberOfReviews is the cheap per-hotel change signal)',
  },
  async run(input, deps) {
    const key = recruitKey(deps.env);
    const timeoutMs = Math.max(5_000, deps.timeoutMs - 4_000);
    const base = 'https://jws.jalan.net/APILite/HotelSearch/V1/';
    const count = Math.min(input.limit ?? 10, 25);
    // Jalan Lite is XML-only; pref=130000 (Tokyo) keeps the probe deterministic.
    const q = new URLSearchParams({ key: key ?? '', pref: input.region ?? '130000', count: String(count) });
    const url = `${base}?${q}`;
    const incDesc =
      'No updated_since; per-hotel review count (numberOfReviews) is the cheap change signal — re-pull and compare counts/content_hash (full-only). ToS caps caching at 24h.';

    let http = 0;
    let xml = '';
    let challengeOrErr = '';
    try {
      const res = await fetchT(deps.fetch, url, { headers: { 'User-Agent': UA }, timeoutMs, allowNotOk: true });
      http = res.status;
      xml = await res.text();
    } catch (e) {
      // A connection failure with no key in hand isn't a true error — the source
      // is gated and simply unreachable for an unauthenticated probe → needs_key.
      return {
        status: key ? 'error' : 'needs_key',
        sourceFingerprint: sourceFp('none', { reason: 'network error probing jws.jalan.net' }),
        incremental: { method: 'full-only', supported: false, description: incDesc },
        notes: [
          `Probe to ${base} failed: ${e instanceof Error ? e.message : String(e)} (host may be unreachable from this network).`,
          'Recruit Jalan WebService needs RECRUIT_API_KEY (Japanese registration); set it to pull hotel records.',
        ],
      };
    }

    // Jalan returns an XML <Error><Message>...</Message></Error> on bad/missing key.
    const errMatch = xml.match(/<Message>([^<]+)<\/Message>/i);
    challengeOrErr = errMatch?.[1]?.trim() ?? '';
    const hasError = /<Error\b/i.test(xml) || challengeOrErr !== '';

    if (!key) {
      return {
        status: 'needs_key',
        sourceFingerprint: sourceFp('keyless-gate', { http, message: clip(challengeOrErr || xml, 40) }),
        incremental: { method: 'none', supported: false, description: incDesc },
        notes: [
          `No RECRUIT_API_KEY set. Probe → HTTP ${http}, error message="${clip(challengeOrErr || 'see body', 40)}" (expect missing-key error). Gate confirmed.`,
          'Same Recruit account/key as hot-pepper-gourmet. Unlike Hot Pepper, Jalan DOES expose hotel user reviews. XML-only; HTTP 406 if polled too fast.',
        ],
      };
    }
    if (http !== 200 || hasError) {
      return {
        status: 'needs_key',
        sourceFingerprint: sourceFp('keyed-error', { http, message: clip(challengeOrErr, 40) }),
        incremental: { method: 'none', supported: false, description: incDesc },
        notes: [`RECRUIT_API_KEY present but rejected by Jalan: HTTP ${http} message="${clip(challengeOrErr, 40)}". (406 = polled too frequently per Jalan ToS.)`],
      };
    }

    // Lightweight XML extraction (no parser dep): pull <Hotel> blocks.
    const hotelBlocks = [...xml.matchAll(/<Hotel>([\s\S]*?)<\/Hotel>/g)].slice(0, count);
    const field = (block: string, tag: string): string | undefined => {
      const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
      return m?.[1]?.trim();
    };
    let totalReviews = 0;
    const records = hotelBlocks.map((mb) => {
      const block = mb[1] ?? '';
      const id = field(block, 'HotelID') ?? field(block, 'HotelName') ?? '';
      const rc = Number(field(block, 'NumberOfRatings') ?? field(block, 'Reviews') ?? '0');
      if (Number.isFinite(rc)) totalReviews += rc;
      const lat = field(block, 'Y');
      const lng = field(block, 'X');
      return mkRecord('jalan', id, block, {
        name: field(block, 'HotelName'),
        lat: lat ? Number(lat) : undefined,
        lng: lng ? Number(lng) : undefined,
        raw: { hotelId: id, reviewCount: rc },
      });
    });
    return {
      status: 'ok',
      sourceFingerprint: sourceFp('hotel-id+review-count', { hotels: records.length, totalReviews, ids: records.map((r) => r.source_id).join(',') }),
      incremental: { method: 'none', supported: false, description: incDesc },
      records,
      notes: [`Pulled live via RECRUIT_API_KEY (XML). ${records.length} hotels, ~${totalReviews} reviews total. Review counts drive the delta; respect 24h cache + back off on 406.`],
    };
  },
});

export const tierCAsiaConnectors: SourceConnector[] = [
  amap,
  baiduMaps,
  naverLocal,
  naverBlog,
  kakaomap,
  hotPepperGourmet,
  jalan,
];
