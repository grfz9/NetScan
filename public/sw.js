// Service worker : rend l'appli installable et la garde utilisable avec une mauvaise connexion.
// - Les fichiers de l'interface sont mis en cache à l'installation.
// - Chaque requête redemande d'abord la dernière version au serveur ; le cache ne sert qu'en secours.
// - Sans réseau ni cache, une page s'ouvre : offline.html.
// - Les analyses (relais, API) ne passent jamais par le cache.
const CACHE = "netscan-v19";
const FICHIERS = [
  "./",
  "index.html",
  "offline.html",
  "styles.css",
  "app.js",
  "rendu.js",
  "coeur.js",
  "schema.js",
  "config.js",
  "calcul-ip.js",
  "ecran-calcul.js",
  "rapport.js",
  "icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
  "manifest.webmanifest",
  "playground/baie-brassage.jpg",
  "playground/analyse.json",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FICHIERS.map((f) => new Request(f, { cache: "reload" })))));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((cles) => Promise.all(cles.filter((c) => c !== CACHE).map((c) => caches.delete(c))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.includes("/api/")) return;
  e.respondWith(
    fetch(e.request, { cache: "no-cache" })
      .then((rep) => {
        if (rep.ok) {
          const copie = rep.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copie));
        }
        return rep;
      })
      .catch(async () => {
        const enCache = await caches.match(e.request, { ignoreSearch: true });
        if (enCache) return enCache;
        if (e.request.mode === "navigate") return caches.match("offline.html");
        return Response.error();
      })
  );
});
