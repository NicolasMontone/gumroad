import UnpluginTypia from "@typia/unplugin/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import path from "path";
import { visualizer } from "rollup-plugin-visualizer";
import AutoImport from "unplugin-auto-import/vite";
import { defineConfig } from "vite";
import RubyPlugin from "vite-plugin-ruby";


const rootPath = path.dirname(fileURLToPath(import.meta.url));

function stripCjsExportsPlugin() {
  return {
    name: "strip-cjs-exports",
    transform(code: string, id: string) {
      if (id.endsWith("routes.js")) {
        return code.replace(/^Object\.defineProperty\(exports.*$/mu, "").replace(/^exports\.\w+\s*=.*$/gmu, "");
      }
    },
  };
}

// Vendor chunk splitting — keeps large, leaf-node dependencies in stable,
// independently cacheable chunks so that app-code deploys don't bust CDN
// caches for vendor code that rarely changes.
//
// Strategy: pull out large libraries that DON'T import React (pure JS libs)
// into their own chunks. Everything React-dependent stays in one "vendor"
// chunk to avoid circular cross-chunk imports between React internals and
// the many small packages that re-export them.
// Some client-side security software (antivirus web shields, tracker blockers, corporate
// proxies) block or quarantine requests purely on the URL/filename containing tracker-like
// words such as "google_analytics". Our chunk names come from the source module name, so a
// module named google_analytics.ts produced a chunk literally called
// google_analytics-<hash>.js. When a page *statically* imports that chunk, a client-side
// block of that one file stops the whole page from ever mounting, leaving a blank screen.
//
// Renaming the emitted chunk is not cosmetic: it removes the substring these tools pattern
// match on, so the module ships as ordinary application code. This does not disable or hide
// any analytics behaviour, and it does not change what the module does — only the filename
// it is served under. See the "blank product editor" reports (2026-07-26).
const BLOCKABLE_NAME_PATTERNS = [/google_analytics/u, /google-analytics/u, /googletagmanager/u, /gtag/u];

function sanitizeChunkName(name: string) {
  return BLOCKABLE_NAME_PATTERNS.some((pattern) => pattern.test(name)) ? "third_party_tracking" : name;
}

function manualChunks(id: string) {
  if (!id.includes("node_modules")) return;

  // Rich-text editor (Tiptap + ProseMirror) — self-contained, ~97KB gzip
  if (id.includes("/@tiptap/") || id.includes("/prosemirror-")) {
    return "vendor-editor";
  }

  // Charts (Recharts + D3) — self-contained, ~82KB gzip
  if (id.includes("/recharts/") || id.includes("/d3-") || id.includes("/recharts-scale/") || id.includes("/victory-")) {
    return "vendor-charts";
  }

  // Braintree / PayPal — self-contained, ~41KB gzip
  if (id.includes("/braintree-web/") || id.includes("/@paypal/")) {
    return "vendor-payments";
  }

  // EPUB reader — loaded only from the buyer's EPUB read page
  if (
    id.includes("/epubjs/") ||
    id.includes("/jszip/") ||
    id.includes("/localforage/") ||
    id.includes("/@xmldom/xmldom/") ||
    id.includes("/event-emitter/") ||
    id.includes("/marks-pane/") ||
    id.includes("/path-webpack/")
  ) {
    return "vendor-epub";
  }

  // PDF.js worker — huge (2.3MB), loaded lazily on demand
  if (id.includes("/pdfjs-dist/")) {
    return "vendor-pdf";
  }

  // Everything else from node_modules → single vendor chunk.
  // This includes React, Inertia, Radix, Stripe, date-fns, lodash, etc.
  // Keeping them together avoids circular chunk warnings from the deep
  // cross-imports between React and its ecosystem packages.
  return "vendor";
}

export default defineConfig(({ mode }) => ({
  plugins: [
    RubyPlugin(),
    // Fast Refresh injects the @react-refresh runtime from a different module/optimize
    // context than the SPA page graph, which (with vite-plugin-ruby's glob-loaded
    // Inertia pages) pulls in a SECOND optimized React chunk -> two React instances
    // -> "Invalid hook call". A static preview doesn't need HMR, so disable it.
    react({ fastRefresh: false }),
    // NOTE: staleModuleGuard() is disabled in the v0 preview. It invalidates any
    // module whose file mtime is newer than its last transform; because the repo
    // was just synced, every file's mtime is fresh, so it invalidated modules
    // (including React) on every request — causing endless dep re-optimization and
    // a second React instance ("Invalid hook call"). It's a dev-only safety net,
    // safe to omit here.
    // staleModuleGuard(),
    UnpluginTypia({ cache: true }),
    AutoImport({
      imports: [
        { "$app/utils/routes": [["*", "Routes"]] },
        {
          jquery: [
            ["default", "$"],
            ["default", "jQuery"],
          ],
        },
      ],
    }),
    stripCjsExportsPlugin(),
    // Bundle visualizer — only emitted during production builds.
    // Run `npx vite build` then open tmp/bundle-stats.html to audit chunk sizes.
    ...(mode === "production"
      ? [
          visualizer({
            filename: "tmp/bundle-stats.html",
            gzipSize: true,
            brotliSize: true,
          }),
        ]
      : []),
  ],
  resolve: {
    // Ensure a single copy of React across pre-bundled deps and app source.
    // Without this the Inertia/React deps can resolve a second React instance,
    // triggering "Invalid hook call / more than one copy of React" and a blank page.
    dedupe: ["react", "react-dom"],
    alias: {
      // Force every react / react-dom import (app source AND pre-bundled deps like
      // @inertiajs/react) to resolve to the exact same physical module, so there is
      // only ever one React instance. Prevents "Invalid hook call / more than one
      // copy of React" in the v0 preview dev server.
      react: path.join(rootPath, "node_modules/react"),
      "react-dom": path.join(rootPath, "node_modules/react-dom"),
      $app: path.join(rootPath, "app/javascript"),
      $assets: path.join(rootPath, "public"),
      $vendor: path.join(rootPath, "vendor/assets/javascripts"),
      jwplayer: path.join(rootPath, "vendor/assets/components/jwplayer-7.12.13/jwplayer"),
    },
  },
  define: {
    SSR: false,
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "test"),
    "process.env.RAILS_ENV": JSON.stringify(process.env.RAILS_ENV || "test"),
    "process.env.PROTOCOL": JSON.stringify(process.env.PROTOCOL || "https"),
    "process.env": "{}",
  },
  // Force React and the Inertia adapter through Vite's dep pre-bundling together
  // so they all share ONE React instance. Otherwise the pre-bundled Inertia adapter
  // links its own React while app source uses another, causing "Invalid hook call /
  // more than one copy of React" and a blank page in dev.
  optimizeDeps: {
    // Pre-bundle React AND the app's common third-party deps in the FIRST optimize
    // pass. Otherwise Vite discovers these lazily (when a page component is imported)
    // and runs a SECOND optimize pass mid-load, so the page ends up loading react.js
    // from two different optimize hashes at once -> two React instances -> "Invalid
    // hook call". Declaring them here + noDiscovery forces a single, up-front bundle.
    // holdUntilCrawlEnd waits for the full import crawl before serving, so no second pass.
    holdUntilCrawlEnd: true,
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@inertiajs/react",
      "@inertiajs/core",
      "@boxicons/react",
      "@radix-ui/react-slot",
      "@radix-ui/react-dialog",
      "@radix-ui/react-popover",
      "classnames",
      "class-variance-authority",
      "tailwind-merge",
      "lodash-es",
      "date-fns",
      "immer",
    ],
  },
  build: {
    // Stable content-hash filenames for long-lived CDN caching.
    // Rollup's default [hash] is already content-based, but we make the
    // pattern explicit so it survives Vite major bumps.
    rollupOptions: {
      output: {
        manualChunks,
        // [name]-[hash] keeps filenames readable in devtools / logs.
        // sanitizeChunkName strips tracker-like words (see above) so client-side
        // blockers can't take a page down by refusing one of its static imports.
        chunkFileNames: (chunkInfo) => `assets/${sanitizeChunkName(chunkInfo.name)}-[hash].js`,
        entryFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
    // Raise chunk size warning limit — the combined vendor chunk is large
    // but it's a single cacheable unit that changes infrequently.
    chunkSizeWarningLimit: 800,
  },
}));
