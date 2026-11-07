'use strict';
// The page and its files from the network if they all arrive within 3 s, else the page and files kept from last time
// (offline too). A new page is used and kept only once all its files are in hand, so it can't come up without them.
// The deploy addresses the CSS and JS by commit (?v=…): a page asks only for its own files.
const WAIT = 3000;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (req.mode === 'navigate') e.respondWith(page(e, url.origin + url.pathname));   // …/scales/?2 is …/scales/
  else e.respondWith(file(url.origin + url.pathname + url.search));
});

const get = (key) => fetch(key, { cache: 'no-cache' }).then((res) => { if (!res.ok) throw new Error(`${key}: ${res.status}`); return res; });

async function page(e, key) {
  const cache = await caches.open('scales');
  // the page, then every CSS and JS file it names; kept all together (files first, then the page, then older copies go)
  const fresh = (async () => {
    const res = await get(key), html = await res.clone().text();
    const urls = [...html.matchAll(/(?:src|href)="([^":#]+\.(?:js|css)(?:\?[^"#]*)?)"/g)].map((m) => new URL(m[1], key).href);
    const files = await Promise.all(urls.map(async (u) => [u, await get(u)]));
    const all = [...files, [key, res]];
    for (const [k, r] of all) await cache.put(k, r.clone());
    const keys = new Set(all.map(([k]) => k)), paths = new Set(all.map(([k]) => new URL(k).pathname));
    for (const r of await cache.keys()) if (!keys.has(r.url) && paths.has(new URL(r.url).pathname)) await cache.delete(r);
    return res;
  })();
  e.waitUntil(fresh.catch(() => {}));   // a late answer is still kept, for the next load
  const kept = await cache.match(key);
  if (!kept) return fresh.catch(() => fetch(key));
  return Promise.race([fresh.catch(() => kept), new Promise((ok) => setTimeout(ok, WAIT, kept))]);
}

// a file of the page: the copy kept with it (fetched just before), else the network
async function file(key) {
  const cache = await caches.open('scales');
  const kept = await cache.match(key);
  if (kept) return kept;
  const res = await fetch(key);
  if (res.ok) await cache.put(key, res.clone());
  return res;
}
