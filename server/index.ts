import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { app, PORT, BASE } from "./app.ts";
import { startCrawler } from "./crawler.ts";

// The widget, served as one canonical URL per member: /w/<id>.js
// The id rides in the path; the widget reads it from its own <script src>.
// This is the ONE line a site pastes — and the only thing every platform
// (Squarespace, WordPress, Wix, Jekyll, Lovable, hand-written) allows.
const WIDGET = readFileSync(new URL("../widget/widget.js", import.meta.url), "utf8");
app.get("/w/:file{.+\\.js}", (c) => {
  c.header("content-type", "text/javascript; charset=utf-8");
  // Revalidate every load: a widget embedded on sites we don't control must be
  // able to ship a fix immediately. (Front with a CDN + versioned URLs to scale.)
  c.header("cache-control", "no-cache");
  c.header("access-control-allow-origin", "*");
  return c.body(WIDGET);
});
app.get("/w.js", (c) => {
  c.header("content-type", "text/javascript; charset=utf-8");
  c.header("cache-control", "no-cache");
  c.header("access-control-allow-origin", "*");
  return c.body(WIDGET);
});

// The main site (den.com) is the React SPA built by Vite into web/dist.
// Its hashed JS/CSS live under /assets; index.html is the SPA shell at /.
app.use("/assets/*", serveStatic({ root: "./web/dist" }));

const INDEX = (() => {
  try {
    return readFileSync(new URL("../web/dist/index.html", import.meta.url), "utf8");
  } catch {
    // Not built yet — point the developer at the right command instead of 500ing.
    return `<!doctype html><meta charset="utf-8"><title>Den</title>
<body style="font-family:-apple-system,system-ui,sans-serif;max-width:540px;margin:80px auto;padding:0 24px;line-height:1.55;color:#3c4149">
<h1 style="color:#282a30">Den</h1>
<p>The web app isn't built yet. Run <code>npm run build</code> for production, or <code>npm run dev:web</code> for a dev server with hot reload.</p>`;
  }
})();
app.get("/", (c) => c.html(INDEX));

// Serve the repo's other static files (widget/, examples/, schema/, SPEC.md,
// skill.md, and site/app.css — still linked by the server-rendered @handle
// pages) from the same origin, so everything is one origin with no config.
app.use("/*", serveStatic({ root: "./" }));

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`\n  Den  → ${BASE}`);
  console.log(`  demo → ${BASE}/widget/demo.html`);
  console.log(`  spec → ${BASE}/SPEC.md\n`);
  startCrawler(); // no-op unless DEN_CRAWL_MINUTES is set
});
