/**
 * sw.js — RuangTV Service Worker
 * Cache-first untuk aset statis player; network-first untuk konten media.
 *
 * Strategi:
 *  - Shell (HTML/CSS/JS/font): cache-first → update di background
 *  - Media (/content/*):       network-first → fallback ke cache
 *  - API (/api/*):             network-only  (tidak dicache)
 */

'use strict';

const CACHE_VERSION  = 'ruangtv-v2.5.0';
const CACHE_MEDIA    = 'ruangtv-media-v1';

// Aset yang selalu dicache saat SW diinstall
const PRECACHE_ASSETS = [
  '/',
  '/player.html',
  '/ruangtv-api.js',
  '/css/design-tokens.css',
  // Font Google Fonts dikache oleh browser secara terpisah (CORS cache)
];

// ── INSTALL ──────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => {
      return cache.addAll(PRECACHE_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys
        .filter(k => k !== CACHE_VERSION && k !== CACHE_MEDIA)
        .map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

// ── FETCH ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Lewati request non-GET dan API
  if (request.method !== 'GET')             return;
  if (url.pathname.startsWith('/api/'))     return;
  if (url.protocol === 'ws:' || url.protocol === 'wss:') return;

  // Media: network-first → cache fallback
  if (url.pathname.startsWith('/content/')) {
    event.respondWith(networkFirstMedia(request));
    return;
  }

  // Shell: cache-first → network fallback + update cache
  event.respondWith(cacheFirstWithUpdate(request));
});

// ── STRATEGI: Cache-first dengan background update ────────────────────────────
async function cacheFirstWithUpdate(request) {
  const cache    = await caches.open(CACHE_VERSION);
  const cached   = await cache.match(request);

  // Update di background (stale-while-revalidate)
  const networkFetch = fetch(request)
    .then(response => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  return cached || await networkFetch || new Response('Offline', { status: 503 });
}

// ── STRATEGI: Network-first untuk media ───────────────────────────────────────
async function networkFirstMedia(request) {
  const cache = await caches.open(CACHE_MEDIA);

  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    return cached || new Response('Media tidak tersedia offline.', { status: 503 });
  }
}
