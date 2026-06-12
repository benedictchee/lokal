// Throwaway viz: read the LOCAL R2 lake object the producer wrote and render the
// George Town POIs on a Leaflet map (self-contained HTML, opens with file://).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getPlatformProxy } from 'wrangler';
import type { Env } from '../src/env.js';

const LAKE_KEY = 'lake/poi/penang/v1.ndjson.gz';

async function gunzipText(stream: ReadableStream): Promise<string> {
  const ds = new DecompressionStream('gzip');
  return new Response(stream.pipeThrough(ds)).text();
}

async function main(): Promise<void> {
  const { env, dispose } = await getPlatformProxy<Env>({ configPath: 'wrangler.cli.jsonc' });
  try {
    const obj = await env.DATA.get(LAKE_KEY);
    if (!obj) throw new Error(`no lake object at ${LAKE_KEY} — run the ingest CLI first`);
    const ndjson = await gunzipText(obj.body as ReadableStream);
    const recs = ndjson.trim().split('\n').map((l) => JSON.parse(l));

    const points = recs
      .filter((r) => typeof r.lat === 'number' && typeof r.lng === 'number')
      .map((r) => ({ n: r.name ?? '', c: r.category ?? 'other', lat: r.lat, lng: r.lng, h: r.h3_r7 }));

    const counts: Record<string, number> = {};
    for (const p of points) counts[p.c] = (counts[p.c] ?? 0) + 1;
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([c]) => c);

    const html = `<!doctype html><html><head><meta charset="utf-8"/>
<title>George Town POIs — local ingest (${points.length})</title>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
  integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="anonymous"/>
<style>
  html,body{margin:0;height:100%;font:14px/1.4 system-ui,sans-serif}
  #map{position:absolute;inset:0}
  #panel{position:absolute;z-index:1000;top:12px;left:12px;background:#fff;padding:12px 14px;border-radius:10px;
    box-shadow:0 2px 12px rgba(0,0,0,.18);max-width:240px}
  #panel h1{font-size:15px;margin:0 0 2px}
  #panel .sub{color:#666;font-size:12px;margin-bottom:8px}
  .legend div{display:flex;align-items:center;gap:6px;margin:2px 0}
  .dot{width:11px;height:11px;border-radius:50%;flex:0 0 auto;border:1px solid rgba(0,0,0,.25)}
</style></head><body>
<div id="map"></div>
<div id="panel">
  <h1>George Town POIs</h1>
  <div class="sub">${points.length.toLocaleString()} records · ingested locally from OpenStreetMap<br/>lake/poi/penang/v1.ndjson.gz</div>
  <div class="legend" id="legend"></div>
</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
  integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin="anonymous"></script>
<script>
// JSON inlined into a script tag; '<' is escaped so untrusted OSM names cannot break the tag.
const POINTS = ${JSON.stringify(points).replace(/</g, '\\u003c')};
const TOP = ${JSON.stringify(top).replace(/</g, '\\u003c')};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const PALETTE = ['#e6194B','#3cb44b','#4363d8','#f58231','#911eb4','#42d4f4','#f032e6','#bfef45','#fabed4','#469990','#9A6324','#808000'];
const colorOf = {}; TOP.forEach((c,i)=>colorOf[c]=PALETTE[i%PALETTE.length]);
const color = c => colorOf[c] || '#9aa0a6';

const map = L.map('map');
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
const layer = L.layerGroup().addTo(map);
const lats=[],lngs=[];
for(const p of POINTS){
  lats.push(p.lat);lngs.push(p.lng);
  L.circleMarker([p.lat,p.lng],{radius:4,color:color(p.c),weight:1,fillColor:color(p.c),fillOpacity:.7})
   .bindPopup('<b>'+esc(p.n)+'</b><br>'+esc(p.c)+'<br><small>r7 '+esc(p.h)+'</small>').addTo(layer);
}
map.fitBounds([[Math.min(...lats),Math.min(...lngs)],[Math.max(...lats),Math.max(...lngs)]]);
const leg=document.getElementById('legend');
for(const c of TOP){const d=document.createElement('div');d.innerHTML='<span class="dot" style="background:'+color(c)+'"></span>'+esc(c)+' ('+POINTS.filter(p=>p.c===c).length+')';leg.appendChild(d);}
const o=document.createElement('div');o.innerHTML='<span class="dot" style="background:#9aa0a6"></span>other';leg.appendChild(o);
</script></body></html>`;

    const out = fileURLToPath(new URL('../viz/georgetown.html', import.meta.url));
    writeFileSync(out, html);
    console.log(`wrote ${out}`);
    console.log(`points: ${points.length}  top categories: ${top.slice(0, 6).join(', ')}`);
  } finally {
    await dispose();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
