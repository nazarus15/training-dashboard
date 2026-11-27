"use strict";
// Service worker: сайт відкривається без інтернету з останніми даними, які бачив цей пристрій.
//
// Стратегії:
//  • сторінки, скрипти, стилі, дані (data/*), журнал (raw.githubusercontent, api.github GET) — спершу мережа
//    (з тайм-аутом; свої файли — з перевіркою на сервері), а копія кладеться в кеш; без мережі — остання копія.
//    Тому онлайн завжди свіже, без ?v=.
//  • Chart.js і шрифти (незмінні версії з CDN) — спершу кеш.
//  • запис (PUT/POST/DELETE), Apps Script і GitHub Actions — лише мережа: про чергу без зв'язку дбають сторінки
//    (td_pending_logs для силових, td_planned_queue для Планера).
// Відповідь з кешу замість мережі позначається заголовком X-TD-Offline і повідомленням сторінці (плашка «Офлайн»).
const VERSION = "td-2026-11-27";
const SHELL = `${VERSION}-shell`, DATA = `${VERSION}-data`, LIB = "td-lib-1";
const PAGES = ["./", "index.html", "calendar.html", "planner.html", "strength.html", "records.html", "settings.html"];
const ASSETS = ["ui.css", "workout.css", "auth.js", "exercises.js", "workout.js", "app.js", "datax.js", "export.js", "strength.js", "strength-progress.js", "strength-volume.js",
  "calendar-beta.js", "forecast.js", "health-watch.js", "favicon.svg", "favicon.ico", "apple-touch-icon.png", "icon-192.png", "icon-512.png", "manifest.webmanifest", "pubkey.json", "keyring.json"];
const CDN = ["https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    // по одному: відсутній файл (наприклад, іконка) не зриває встановлення
    await Promise.all([...PAGES, ...ASSETS].map(u => fetch(u, { cache: "no-cache" }).then(r => r.ok && c.put(stripUrl(new URL(u, self.registration.scope).href), r)).catch(() => { })));
    const l = await caches.open(LIB);
    await Promise.all(CDN.map(u => l.match(u).then(hit => hit || fetch(u, { mode: "cors" }).then(r => r.ok && l.put(u, r))).catch(() => { })));
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== SHELL && k !== DATA && k !== LIB) await caches.delete(k);
    await self.clients.claim();
  })());
});

// ключ кешу без службових параметрів (?t=…, ?v=…): одна копія на файл
function stripUrl(u) {
  const x = new URL(u);
  ["t", "v"].forEach(p => x.searchParams.delete(p));
  return x.href;
}
const isLib = u => /cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com/.test(u.host);
const isJournal = u => (u.host === "raw.githubusercontent.com" && u.pathname.startsWith("/nazarus15/training-dashboard/")) ||
  (u.host === "api.github.com" && u.pathname.startsWith("/repos/nazarus15/training-dashboard/contents/"));

async function notify(clientId) {
  try { const c = clientId && await self.clients.get(clientId); (c ? [c] : await self.clients.matchAll({ type: "window" })).forEach(x => x.postMessage({ type: "td-offline" })); } catch { }
}
async function networkFirst(req, cacheName, key, timeoutMs, clientId, revalidate) {
  const cache = await caches.open(cacheName);
  try {
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), timeoutMs);
    // свої файли сайту — з перевіркою на сервері (cache: no-cache, відповідь 304 швидка): після оновлення сайту
    // браузер не бере старий скрипт із HTTP-кешу GitHub Pages (10 хв)
    const r = revalidate ? await fetch(req.url, { cache: "no-cache", credentials: "same-origin", signal: ctrl.signal }) : await fetch(req, { signal: ctrl.signal });
    clearTimeout(timer);
    if (r.ok) cache.put(key, r.clone()).catch(() => { });
    return r;
  } catch (err) {
    const hit = await cache.match(key) || await cache.match(key, { ignoreSearch: true }) || (req.mode === "navigate" ? await (await caches.open(SHELL)).match(stripUrl(new URL("index.html", self.registration.scope).href)) : null);
    if (!hit) throw err;
    notify(clientId);
    const h = new Headers(hit.headers); h.set("X-TD-Offline", "1");
    return new Response(await hit.blob(), { status: hit.status, statusText: hit.statusText, headers: h });
  }
}
async function cacheFirst(req) {
  const c = await caches.open(LIB), hit = await c.match(req, { ignoreVary: true });
  if (hit) return hit;
  const r = await fetch(req); if (r.ok || r.type === "opaque") c.put(req, r.clone()).catch(() => { });
  return r;
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return; // запис — лише мережа
  const u = new URL(req.url);
  if (isLib(u)) { e.respondWith(cacheFirst(req)); return; }
  if (u.origin === self.location.origin) {
    if (!u.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
    const isData = /\/data\//.test(u.pathname) || /\/(keyring|pubkey)\.json$/.test(u.pathname);
    e.respondWith(networkFirst(req, isData ? DATA : SHELL, stripUrl(req.url), req.mode === "navigate" ? 5000 : isData ? 12000 : 6000, e.clientId || e.resultingClientId, !isData));
    return;
  }
  if (isJournal(u)) {
    e.respondWith(networkFirst(req, DATA, stripUrl(req.url), 12000, e.clientId));
  }
});
self.addEventListener("message", e => { if (e.data === "skipWaiting") self.skipWaiting(); });
