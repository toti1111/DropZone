/* Public app assets only. No Firestore documents, auth responses, photos or map tiles. */
const VERSION = 'dropzone-public-v20261022-1';
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;
const BASE = new URL(self.registration.scope);
const INDEX = new URL('index.html', BASE).href;
const META = new URL('.dropzone-offline-status', BASE).href;
const SHELL = ['index.html', 'manifest.json', 'privacy.html', 'delete-account.html'].map(path => new URL(path, BASE).href);
const REQUIRED = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet.markercluster@1.4.1/dist/MarkerCluster.css',
  'https://unpkg.com/leaflet.markercluster@1.4.1/dist/MarkerCluster.Default.css',
  'https://unpkg.com/leaflet.markercluster@1.4.1/dist/leaflet.markercluster.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-solid-900.woff2',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-regular-400.woff2',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-brands-400.woff2',
  'https://cdn.tailwindcss.com/',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
];
let preparation = null;
function allowedAsset(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search) return false;
  if (url.hostname === 'unpkg.com') return /^\/leaflet@1\.9\.4\/dist\/(?:leaflet\.(?:js|css)|images\/[a-z0-9-]+\.png)$/.test(url.pathname)
    || /^\/leaflet\.markercluster@1\.4\.1\/dist\/(?:leaflet\.markercluster\.js|MarkerCluster(?:\.Default)?\.css)$/.test(url.pathname);
  if (url.hostname === 'cdnjs.cloudflare.com') return /^\/ajax\/libs\/font-awesome\/6\.4\.0\/(?:css\/all\.min\.css|webfonts\/[a-z0-9-]+\.(?:woff2|ttf))$/.test(url.pathname);
  if (url.hostname === 'cdn.tailwindcss.com') return /^\/(?:3\.\d+\.\d+)?\/?$/.test(url.pathname);
  return url.hostname === 'www.gstatic.com' && /^\/firebasejs\/10\.12\.2\/[a-zA-Z0-9._-]+\.js$/.test(url.pathname);
}
function safeResponse(response, publicAsset = false) {
  return response && response.ok && response.type !== 'opaque' && response.type !== 'opaqueredirect'
    && !/\b(?:private|no-store)\b/i.test(response.headers.get('Cache-Control') || '')
    && (!response.url || (publicAsset ? allowedAsset(response.url) : SHELL.includes(response.url) || response.url === BASE.href));
}
async function fetchBounded(request, milliseconds) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(),milliseconds);
  try { return await fetch(request,{signal:controller.signal}); } finally { clearTimeout(timer); }
}
async function saveStatus(status) {
  const cache = await caches.open(SHELL_CACHE);
  await cache.put(META, new Response(JSON.stringify(status), {headers:{'Content-Type':'application/json'}}));
  return status;
}
async function readStatus() {
  const cache = await caches.open(SHELL_CACHE), response = await cache.match(META);
  if (!response) return {ready:false,shellReady:!!await cache.match(INDEX),preparedAt:0,missing:[]};
  try {
    const status = await response.json(), assets = await caches.open(ASSET_CACHE);
    if (!Array.isArray(status.resources) || status.resources.length > 60
      || REQUIRED.some(url => !status.resources.includes(url))) return {...status,ready:false,missing:['preparation-required']};
    const expected = status.resources.filter(allowedAsset).slice(0,60);
    const absent = (await Promise.all(expected.map(async url => await assets.match(url) ? null : url))).filter(Boolean);
    const shellReady = (await Promise.all(SHELL.map(url => cache.match(url)))).every(Boolean);
    return {...status,shellReady,ready:status.ready && shellReady && absent.length === 0,missing:[...new Set([...(status.missing || []),...absent])]};
  } catch { return {ready:false,shellReady:false,preparedAt:0,missing:[]}; }
}
async function cacheShell() {
  const cache = await caches.open(SHELL_CACHE);
  const results = await Promise.all(SHELL.map(async url => {
    try {
      const response = await fetchBounded(new Request(url,{cache:'reload',credentials:'same-origin'}),8000);
      if (!safeResponse(response)) throw new Error('Uncacheable shell');
      await cache.put(url,response); return true;
    } catch { return !!await cache.match(url); }
  }));
  return results.every(Boolean);
}
async function assetResponse(url) {
  if (!allowedAsset(url)) throw new Error('Not a public dependency');
  const cache = await caches.open(ASSET_CACHE), cached = await cache.match(url);
  if (cached) return cached;
  const response = await fetchBounded(new Request(url,{mode:'cors',credentials:'omit',cache:'no-cache'}),10000);
  if (!safeResponse(response,true)) throw new Error('Unverified asset response');
  const length = Number(response.headers.get('Content-Length') || 0);
  if (length > 8 * 1024 * 1024) throw new Error('Asset too large');
  await cache.put(url,response.clone());
  return response;
}
async function assetTree(url, visited) {
  if (visited.has(url)) return;
  if (visited.size >= 60) throw new Error('Too many dependencies');
  visited.add(url);
  const response = await assetResponse(url);
  if (!/\.js$/.test(new URL(url).pathname) || new URL(url).hostname !== 'www.gstatic.com') return;
  const source = await response.text(), dependencies = new Set();
  // The SDK uses static CDN imports; follow same-version imports, including relative ones.
  const imports = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']([^"']+)["']/g;
  for (const match of source.matchAll(imports)) {
    const next = new URL(match[1],url).href;
    if (allowedAsset(next) && new URL(next).hostname === 'www.gstatic.com') dependencies.add(next);
  }
  for (const next of dependencies) await assetTree(next,visited);
}
async function prepareOffline() {
  if (preparation) return preparation;
  preparation = (async () => {
    const shellReady = await cacheShell(), missing = [], visited = new Set();
    // Bound simultaneous downloads on mobile connections.
    let cursor = 0;
    await Promise.all(Array.from({length:4},async () => {
      while (cursor < REQUIRED.length) {
        const url = REQUIRED[cursor++];
        try { await assetTree(url,visited); } catch { missing.push(url); }
      }
    }));
    return saveStatus({ready:shellReady && missing.length === 0,shellReady,preparedAt:Date.now(),missing,resources:[...visited].sort()});
  })();
  try { return await preparation; } finally { preparation = null; }
}
self.addEventListener('install', event => {
  event.waitUntil(cacheShell().then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith('dropzone-public-') && name !== SHELL_CACHE && name !== ASSET_CACHE).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  const port = event.ports && event.ports[0];
  if (!port) return;
  event.waitUntil((async () => {
    try {
      if (event.data?.type === 'PREPARE_OFFLINE') port.postMessage(await prepareOffline());
      else if (event.data?.type === 'OFFLINE_STATUS') port.postMessage(await readStatus());
      else if (event.data?.type === 'CLEAR_OFFLINE_CACHE') {
        await caches.delete(SHELL_CACHE); await caches.delete(ASSET_CACHE);
        port.postMessage({ready:false,shellReady:false,preparedAt:0,missing:[]});
      }
    } catch { port.postMessage({ready:false,shellReady:false,preparedAt:0,missing:['storage-unavailable']}); }
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('Authorization')) return;
  const url = new URL(request.url);
  if (url.origin === BASE.origin && (SHELL.includes(url.origin + url.pathname) || url.pathname === BASE.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      const key = url.pathname === BASE.pathname ? INDEX : url.origin + url.pathname;
      try {
        const response = await fetchBounded(request,4000);
        if (safeResponse(response)) await cache.put(key,response.clone());
        return response;
      } catch {
        const cached = await cache.match(key);
        if (cached) return cached;
        return new Response('Çevrimdışı içerik henüz hazırlanmamış.',{status:503,headers:{'Content-Type':'text/plain;charset=UTF-8'}});
      }
    })());
  } else if (allowedAsset(request.url)) {
    event.respondWith((async () => {
      try { return await assetResponse(request.url); }
      catch { return fetch(request); }
    })());
  }
});
