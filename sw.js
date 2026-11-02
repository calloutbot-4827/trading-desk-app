// Minimal service worker: caches the app shell only. Data (any other origin, or any .json except the manifest) is never cached.
const CACHE = "grokbot-shell-v1";
const SHELL = ["./", "index.html", "styles.css", "app.js", "chart.js", "manifest.json",
  "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== self.location.origin) return; // data lives elsewhere: network only
  const rel = u.pathname.slice(new URL(self.registration.scope).pathname.length) || "./";
  if (!SHELL.includes(rel)) return;
  e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); return r; })
    .catch(() => caches.match(e.request)));
});
