// Service worker minimal : rend l'appli installable et garde l'interface en cache.
// Les analyses (/api) passent toujours par le réseau.
const CACHE = "netscan-v9";
const FICHIERS = ["./", "index.html", "styles.css", "app.js", "rendu.js", "coeur.js", "schema.js", "config.js", "icon.svg", "manifest.webmanifest"];

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
  // Réseau d'abord, en redemandant toujours la dernière version au serveur ;
  // le cache ne sert qu'en secours, hors connexion.
  e.respondWith(
    fetch(e.request, { cache: "no-cache" })
      .then((rep) => {
        const copie = rep.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copie));
        return rep;
      })
      .catch(() => caches.match(e.request))
  );
});
