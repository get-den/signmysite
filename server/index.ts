import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { app, PORT, BASE } from "./app.ts";

// Serve the repo's static files (widget/, examples/, schema/, SPEC.md) from the
// same origin, so the widget talks to its own API with no config. Root -> demo.
app.get("/", (c) => c.redirect("/widget/demo.html"));
app.use("/*", serveStatic({ root: "./" }));

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`\n  Den  → ${BASE}`);
  console.log(`  demo → ${BASE}/widget/demo.html`);
  console.log(`  spec → ${BASE}/SPEC.md\n`);
});
