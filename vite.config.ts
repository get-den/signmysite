import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The React main site lives in web/ and builds to web/dist, which the Hono
// server serves at /. In dev, `npm run dev:web` runs Vite with HMR and proxies
// the server's routes (API, widget, auth, static docs) to the Hono server on
// :8787 — so the whole app works from one origin in dev too.
const PROXY_TO_SERVER = [
  "/api", "/w", "/auth", "/site", "/widget", "/examples", "/schema", "/skill.md", "/llms.txt",
];

export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    // Allow importing the shared stylesheet from the repo root (../site/app.css).
    fs: { allow: [".."] },
    proxy: Object.fromEntries(
      PROXY_TO_SERVER.map((p) => [p, { target: "http://localhost:8787", changeOrigin: true }])
    ),
  },
});
