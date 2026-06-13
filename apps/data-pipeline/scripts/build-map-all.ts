// Throwaway viz: render all three prototype data sources on one Leaflet map —
// OSM POIs (M1), GTFS bus stops (M3), and Google-reviewed places with reviews (M4).
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPlatformProxy } from 'wrangler';
import type { Env } from '../src/env.js';

async function gunzip(stream: ReadableStream): Promise<string> {
  return new Response(stream.pipeThrough(new DecompressionStream('gzip'))).text();
}
async function readLake(env: Env, key: string): Promise<Record<string, unknown>[]> {
  const obj = await env.DATA.get(key);
  if (!obj) return [];
  return (await gunzip(obj.body as ReadableStream)).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

async function main(): Promise<void> {
  const { env, dispose } = await getPlatformProxy<Env>({ configPath: 'wrangler.cli.jsonc' });
  try {
    const poiRecs = await readLake(env, 'lake/poi/penang-island/v1.ndjson.gz');
    const busRecs = await readLake(env, 'lake/transport/penang-bus/v1.ndjson.gz');
    const gj = JSON.parse(readFileSync(join(import.meta.dirname, 'out/google-georgetown.json'), 'utf8'));

    const poi = poiRecs.filter((r: any) => r.lat && r.lng).map((r: any) => ({ n: r.name, c: r.category, lat: r.lat, lng: r.lng }));
    const bus = busRecs.filter((r: any) => r.lat && r.lng).map((r: any) => ({ n: r.name, lat: r.lat, lng: r.lng }));
    const google = (gj.places || []).filter((p: any) => p.lat && p.lng).map((p: any) => ({
      n: p.panel?.name ?? '', cat: p.panel?.category ?? '', rating: p.panel?.rating ?? null,
      rc: p.panel?.review_count ?? null, lat: p.lat, lng: p.lng,
      reviews: (p.reviews || []).map((v: any) => ({ a: v.author, s: v.stars, d: v.date, t: v.text })),
    }));

    const counts: Record<string, number> = {};
    for (const p of poi) counts[p.c] = (counts[p.c] ?? 0) + 1;
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([c]) => c);
    const totalReviews = google.reduce((n: number, g: any) => n + g.reviews.length, 0);

    const j = (x: unknown) => JSON.stringify(x).replace(/</g, '\\u003c');
    const html = `<!doctype html><html><head><meta charset="utf-8"/>
<title>Penang prototype — POIs + transport + Google reviews</title>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
  integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="anonymous"/>
<style>
 html,body{margin:0;height:100%;font:13px/1.45 system-ui,sans-serif}#map{position:absolute;inset:0}
 #panel{position:absolute;z-index:1000;top:12px;left:12px;background:#fff;padding:12px 14px;border-radius:10px;box-shadow:0 2px 14px rgba(0,0,0,.2);max-width:230px}
 #panel h1{font-size:15px;margin:0 0 2px}#panel .sub{color:#666;font-size:12px;margin-bottom:8px}
 .row{display:flex;align-items:center;gap:6px;margin:2px 0}.dot{width:11px;height:11px;border-radius:50%;flex:0 0 auto;border:1px solid rgba(0,0,0,.25)}
 .sq{width:10px;height:10px;flex:0 0 auto;background:#1a73e8;border:1px solid #0b57d0}
 .gpop b{font-size:14px}.rev{border-top:1px solid #eee;padding:6px 0;margin-top:4px}.rev .meta{color:#666;font-size:11px}.stars{color:#f5b400}
 .leaflet-popup-content{max-height:320px;overflow:auto;width:280px!important}
</style></head><body>
<div id="map"></div>
<div id="panel">
 <h1>Penang data prototype</h1>
 <div class="sub">${poi.length.toLocaleString()} POIs · ${bus.length.toLocaleString()} bus stops · ${google.length} Google places (${totalReviews} reviews)</div>
 <div id="legend"></div>
 <div style="margin-top:8px;font-size:11px;color:#888">toggle layers, top-right ▸ · click a ★ for reviews</div>
</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
  integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin="anonymous"></script>
<script>
const POI=${j(poi)}, BUS=${j(bus)}, GOOGLE=${j(google)}, TOP=${j(top)};
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','\\u003c':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const PAL=['#e6194B','#3cb44b','#4363d8','#f58231','#911eb4','#42d4f4','#f032e6','#bfef45','#fabed4','#469990'];
const cmap={};TOP.forEach((c,i)=>cmap[c]=PAL[i%PAL.length]);const col=c=>cmap[c]||'#9aa0a6';
const map=L.map('map',{preferCanvas:true});
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
const cv=L.canvas();
const poiL=L.layerGroup(),busL=L.layerGroup(),gL=L.layerGroup();
const lats=[],lngs=[];
for(const p of POI){lats.push(p.lat);lngs.push(p.lng);L.circleMarker([p.lat,p.lng],{renderer:cv,radius:3,color:col(p.c),weight:0,fillColor:col(p.c),fillOpacity:.65}).bindPopup('<b>'+esc(p.n)+'</b><br>'+esc(p.c)).addTo(poiL);}
for(const b of BUS){L.circleMarker([b.lat,b.lng],{renderer:cv,radius:3,color:'#0b57d0',weight:1,fillColor:'#1a73e8',fillOpacity:.7}).bindPopup('🚌 '+esc(b.n)).addTo(busL);}
for(const g of GOOGLE){
  let revs='';for(const r of g.reviews){const st='★'.repeat(Math.max(0,Math.min(5,r.s|0)));revs+='<div class="rev"><span class="stars">'+st+'</span> <span class="meta">'+esc(r.a)+' · '+esc(r.d)+'</span><br>'+esc(r.t)+'</div>';}
  const html='<div class="gpop"><b>'+esc(g.n)+'</b><br><span class="meta">'+esc(g.cat)+'</span><br><span class="stars">★ '+esc(g.rating)+'</span> · '+esc(g.rc)+' reviews'+revs+'</div>';
  L.marker([g.lat,g.lng]).bindPopup(html).addTo(gL);
}
poiL.addTo(map);busL.addTo(map);gL.addTo(map);
L.control.layers(null,{['POIs ('+POI.length+')']:poiL,['Bus stops ('+BUS.length+')']:busL,['Google ★ reviews ('+GOOGLE.length+')']:gL},{collapsed:false}).addTo(map);
map.fitBounds([[Math.min(...lats),Math.min(...lngs)],[Math.max(...lats),Math.max(...lngs)]]);
const leg=document.getElementById('legend');
function row(html){const d=document.createElement('div');d.className='row';d.innerHTML=html;leg.appendChild(d);}
row('<span class="sq"></span><b>bus stops</b> (M3)');row('<span class="dot" style="background:#fbbc04"></span><b>Google ★ + reviews</b> (M4)');
const hdr=document.createElement('div');hdr.style.cssText='margin-top:6px;font-weight:600';hdr.textContent='POI categories (M1)';leg.appendChild(hdr);
for(const c of TOP)row('<span class="dot" style="background:'+col(c)+'"></span>'+esc(c)+' ('+POI.filter(p=>p.c===c).length+')');
window.__map=map;window.__gL=gL;
</script></body></html>`;

    const out = join(import.meta.dirname, '../viz/penang-all.html');
    writeFileSync(out, html);
    console.log(`wrote ${out}`);
    console.log(`POIs=${poi.length} bus=${bus.length} google=${google.length} reviews=${totalReviews}`);
  } finally {
    await dispose();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
