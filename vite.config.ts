import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
//
// There is deliberately no service worker here. This app was built with
// vite-plugin-pwa precaching the whole app shell plus a NetworkFirst cache in
// front of Supabase. That bought nothing a signed-in, bank-synced app can
// actually use -- every screen needs a live session and live account data --
// and it cost real breakage: a cached shell served the previous bundle after a
// deploy, which is exactly the failure recorded in CLAUDE.md on 2026-03-24.
//
// The app stays installable to the home screen: since Chrome 108 (mobile) /
// 112 (desktop) installability needs only a manifest over HTTPS, no service
// worker. The manifest is a plain static file at public/manifest.webmanifest.
//
// public/sw.js is a one-line kill switch that unregisters itself. Do not delete
// it and do not replace it with a 404 -- browsers only ever update a service
// worker by re-fetching the same URL, so removing the file leaves the old
// caching worker installed forever on every device that already has it.
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(
    Boolean,
  ),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    include: ["react", "react-dom", "@tanstack/react-query"],
  },
  build: {
    commonjsOptions: {
      include: [/node_modules/],
    },
    rollupOptions: {},
  },
}));
