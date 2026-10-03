const VERSION = "control-pwa-v2";
const OFFLINE_URL = "/admin/offline";
const STATIC_CACHE = `${VERSION}-static`;
const STATIC_ASSETS = [
  OFFLINE_URL,
  "/admin/manifest.webmanifest",
  "/admin/icons/icon-192.png",
  "/admin/icons/icon-512.png",
  "/admin/icons/icon-maskable-192.png",
  "/admin/icons/icon-maskable-512.png",
  "/admin/icons/apple-touch-180.png",
];

function isAdminScope(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname === "/admin" || parsed.pathname.startsWith("/admin/");
  } catch {
    return false;
  }
}

function isSensitive(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;
    if (path.startsWith("/api/")) return true;
    if (path.startsWith("/admin/contenido")) return true;
    if (path.startsWith("/admin/solicitudes")) return true;
    if (path.startsWith("/admin/citas")) return true;
    if (path.startsWith("/admin/trabajos")) return true;
    if (path.startsWith("/admin/clientes")) return true;
    if (path.startsWith("/admin/login")) return true;
    return false;
  } catch {
    return true;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => undefined),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== STATIC_CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  if (!isAdminScope(request.url)) return;
  if (isSensitive(request.url)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          return fresh;
        } catch {
          const cached = await caches.match(OFFLINE_URL);
          return cached || new Response("Sin conexión", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
        }
      })(),
    );
    return;
  }

  const dest = new URL(request.url).pathname;
  const isStatic = STATIC_ASSETS.includes(dest);
  if (!isStatic) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          void caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
