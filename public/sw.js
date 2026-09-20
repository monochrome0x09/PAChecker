/* global self, caches */

const CACHE_PREFIX = "pachecker-shell-";
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const SHELL_URL = "/";
const FIXED_SHELL_ASSETS = [
  "/manifest.webmanifest",
  "/favicon.ico",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

function isPrivateDataPath(pathname) {
  return (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/uploads/") ||
    pathname.startsWith("/_next/image")
  );
}

function isStaticShellAsset(pathname) {
  return (
    pathname.startsWith("/_next/static/") ||
    pathname.startsWith("/icons/") ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/favicon.ico"
  );
}

async function cacheResponse(cache, request) {
  const response = await fetch(request, { cache: "reload" });
  if (!response.ok || response.type === "opaque") {
    throw new Error(`Shell asset request failed: ${request}`);
  }
  await cache.put(request, response);
}

async function precacheShell() {
  const cache = await caches.open(CACHE_NAME);
  const shellResponse = await fetch(SHELL_URL, { cache: "reload" });

  if (!shellResponse.ok) {
    throw new Error("App shell request failed");
  }

  await cache.put(SHELL_URL, shellResponse.clone());
  const shellMarkup = await shellResponse.text();
  const nextStaticAssets = Array.from(
    shellMarkup.matchAll(/(?:src|href)="(\/_next\/static\/[^"?#]+(?:\?[^"#]*)?)"/g),
    (match) => match[1],
  );
  const shellAssets = [...new Set([...FIXED_SHELL_ASSETS, ...nextStaticAssets])];

  await Promise.all(shellAssets.map((asset) => cacheResponse(cache, asset)));
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isPrivateDataPath(url.pathname)) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(SHELL_URL)));
    return;
  }

  if (!isStaticShellAsset(url.pathname)) {
    return;
  }

  event.respondWith(
    caches.match(request).then(async (cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      const response = await fetch(request);
      if (response.ok && response.type !== "opaque") {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    }),
  );
});
