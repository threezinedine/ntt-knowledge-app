import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The Android app ships the web app itself (apps/web/dist, built by
 * `npm run mobile:sync`) and keeps its own read-only copy of the graph,
 * pulled from a sync hub (apps/web/src/api/phoneData.ts). It works offline;
 * it only needs the hub to get a newer version. The hub's address is entered
 * in the app (Sync), not baked in.
 */
const config: CapacitorConfig = {
  appId: 'dev.knowledgemanager.viewer',
  appName: 'Knowledge Manager',
  webDir: '../web/dist',
  plugins: {
    // Requests to the hub go through Android's own HTTP stack: no CORS, and a
    // plain-http LAN hub isn't blocked as mixed content from the app's https page.
    // Cleartext itself is allowed in AndroidManifest.xml (usesCleartextTraffic).
    CapacitorHttp: { enabled: true },
  },
};

export default config;
