// Service worker kill switch.
//
// This app used to ship a Workbox service worker that precached the app shell.
// It has been removed (see vite.config.ts for why), but a removed service
// worker does not uninstall itself: a browser only replaces a registered worker
// by re-fetching the SAME script URL and finding different bytes. Deleting this
// file would make /sw.js fall through to the SPA rewrite, which answers with
// index.html as text/html -- not a valid worker script, so the update fails and
// the OLD caching worker keeps serving a stale bundle on that device forever.
//
// So this file has to stay, and has to stay at /sw.js. It takes over from the
// old worker, empties every cache it left behind, unregisters itself, and
// reloads open tabs once so they are served by the network.
//
// It is safe to delete this file only once nobody has the old worker installed
// -- which is not a thing that can be measured, so in practice: leave it.

self.addEventListener("install", () => {
  // Skip the waiting phase so this replaces the old worker on the next page
  // load rather than sitting idle until every tab is closed.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.map((name) => caches.delete(name)));

      await self.registration.unregister();

      // The clients are still controlled by this worker until they navigate.
      // Reload them so they fetch the current bundle instead of whatever the
      // old worker had cached.
      const clients = await self.clients.matchAll({ type: "window" });
      for (const client of clients) {
        client.navigate(client.url);
      }
    })(),
  );
});

// A fetch handler that does nothing but go to the network. Present only so the
// worker is never treated as offline-capable while it is briefly in control.
self.addEventListener("fetch", () => {});
