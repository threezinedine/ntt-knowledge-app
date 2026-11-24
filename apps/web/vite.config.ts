import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const API_TARGET = process.env.KM_API_URL ?? 'http://127.0.0.1:4317';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Knowledge Manager',
        short_name: 'KM',
        description: 'Personal local-first knowledge graph',
        theme_color: '#14161a',
        background_color: '#14161a',
        display: 'standalone',
        start_url: '/',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        // Never let the service worker answer API calls from cache.
        navigateFallbackDenylist: [/^\/api\//],
        // The SQLite engine (.wasm) too: the app works offline, on this device's own copy.
        globPatterns: ['**/*.{js,css,html,svg,woff2,wasm}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // The 3D view's three.js chunk (~1.5 MB) is optional: don't make every
        // install download it. Cached on first use instead. (Data comes from
        // this device's engine, so the 2D graph works offline without it.)
        globIgnores: ['**/Graph3D-*.js'],
        runtimeCaching: [
          {
            urlPattern: /\/assets\/Graph3D-[^/]+\.js$/,
            handler: 'CacheFirst', // content-hashed name: a new build is a new URL
            options: { cacheName: 'km-3d', expiration: { maxEntries: 2 } },
          },
        ],
      },
    }),
  ],
  // SQLite WebAssembly finds its .wasm next to its own module: don't pre-bundle it.
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  worker: { format: 'es' },
  server: {
    port: 5173,
    proxy: { '/api': API_TARGET },
  },
  build: {
    chunkSizeWarningLimit: 1500,
  },
});
