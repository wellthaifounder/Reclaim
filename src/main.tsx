import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Second line of defence against the service worker this app used to ship.
// public/sw.js is the primary one -- it takes over from the old worker and
// unregisters itself. This runs for anyone who reaches current code some other
// way (a hard refresh, a new tab that dodged the cached shell) and clears the
// registration and its caches immediately rather than waiting on an update
// check. Both paths are idempotent; on a browser with no worker this does
// nothing at all.
if ("serviceWorker" in navigator) {
  void navigator.serviceWorker
    .getRegistrations()
    .then((registrations) =>
      Promise.all(registrations.map((r) => r.unregister())),
    )
    .then(() =>
      "caches" in window
        ? caches
            .keys()
            .then((names) => Promise.all(names.map(caches.delete, caches)))
        : undefined,
    )
    .catch(() => {
      // Nothing to do. A browser that refuses to enumerate registrations is
      // not a reason to fail the app boot.
    });
}

createRoot(document.getElementById("root")!).render(<App />);
