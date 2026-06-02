import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { app, PORT, BASE } from "./app.ts";

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

// The main site (den.com) is the root SPA.
app.get("/", (c) => c.redirect("/site/index.html"));

// Serve the repo's static files (site/, widget/, examples/, schema/, SPEC.md,
// skill.md) from the same origin, so everything is one origin with no config.
app.use("/*", serveStatic({ root: "./" }));

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`\n  Den  → ${BASE}`);
  console.log(`  demo → ${BASE}/widget/demo.html`);
  console.log(`  spec → ${BASE}/SPEC.md\n`);
});
