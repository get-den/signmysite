import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { app } from "./app.ts";
import * as db from "./db.ts";
import { escapeHtml } from "./util.ts";
import { PORT, BASE } from "./config.ts";
import { startCrawler } from "./crawler.ts";
import { startSweeps } from "./sweeps.ts";
import { rewriteOrigin, widgetBanner, siteManifest, robotsTxt } from "./meta.ts";
import { rootVars, widgetVars } from "./theme.ts";

// The widget, served as one canonical URL per member: /w/<id>.js
// The id rides in the path; the widget reads it from its own <script src>.
// This is the ONE line a site pastes — and the only thing every platform
// (Squarespace, WordPress, Wix, Jekyll, Lovable, hand-written) allows.
// Prepend a self-describing banner (see meta.ts) and rewrite the origin
// sentinel to BASE, so a coding agent that fetches this file cold knows exactly
// what it is, that it's safe to add, and where the docs are — without asking.
// Inject the brand tokens (server/theme.ts) into the widget's shadow root at serve
// time, so the widget reads the SAME source as the app + email instead of carrying
// its own copies (see widgetVars()).
const WIDGET = rewriteOrigin(
  widgetBanner(BASE) + readFileSync(new URL("../widget/widget.js", import.meta.url), "utf8"),
  BASE,
).replace(":host{all:initial}", `:host{all:initial;${widgetVars()}}`);
app.get("/w/:file{.+\\.js}", (c) => {
  c.header("content-type", "text/javascript; charset=utf-8");
  // Revalidate every load: a widget embedded on sites we don't control must be
  // able to ship a fix immediately. (Front with a CDN + versioned URLs to scale.)
  c.header("cache-control", "no-cache");
  c.header("access-control-allow-origin", "*");
  // A discovery trail from the artifact itself: an agent that meets only the
  // tag can reach the human + machine docs without scraping the host page.
  c.header(
    "link",
    `<${BASE}/skill.md>; rel="help"; type="text/markdown", ` +
      `<${BASE}/llms.txt>; rel="alternate"; type="text/plain"`,
  );
  return c.body(WIDGET);
});
app.get("/w.js", (c) => {
  c.header("content-type", "text/javascript; charset=utf-8");
  c.header("cache-control", "no-cache");
  c.header("access-control-allow-origin", "*");
  // A discovery trail from the artifact itself: an agent that meets only the
  // tag can reach the human + machine docs without scraping the host page.
  c.header(
    "link",
    `<${BASE}/skill.md>; rel="help"; type="text/markdown", ` +
      `<${BASE}/llms.txt>; rel="alternate"; type="text/plain"`,
  );
  return c.body(WIDGET);
});

// The brand palette as :root custom properties — the ONE source (server/theme.ts)
// the app + server-rendered pages read, so site/app.css no longer declares them.
app.get("/theme.css", (c) => {
  c.header("content-type", "text/css; charset=utf-8");
  c.header("cache-control", "no-cache");
  c.header("access-control-allow-origin", "*");
  return c.body(`:root{${rootVars()}}`);
});

// The main site (signmysite.com) is the React SPA built by Vite into web/dist.
// Its hashed JS/CSS live under /assets; index.html is the SPA shell at /.
app.use("/assets/*", serveStatic({ root: "./web/dist" }));

const INDEX = (() => {
  try {
    return readFileSync(new URL("../web/dist/index.html", import.meta.url), "utf8");
  } catch {
    // Not built yet — point the developer at the right command instead of 500ing.
    return `<!doctype html><meta charset="utf-8"><title>signmysite</title>
<body style="font-family:-apple-system,system-ui,sans-serif;max-width:540px;margin:80px auto;padding:0 24px;line-height:1.55;color:#3c4149">
<h1 style="color:#282a30">signmysite</h1>
<p>The web app isn't built yet. Run <code>npm run build</code> for production, or <code>npm run dev:web</code> for a dev server with hot reload.</p>`;
  }
})();
app.get("/", (c) => c.html(INDEX));

// Profile pages — signmysite.com/@handle, THE profile URL (emails, the widget, and
// every identity chip point here). The SPA renders the one profile layout; the
// server's only job is link previews: swap the shell's <title>/description for the
// member's own and add Open Graph tags, so a shared /@handle unfurls properly.
app.get("/:at{@.+}", async (c) => {
  const handle = c.req.param("at").slice(1).toLowerCase();
  const m = await db.getMemberByHandle(handle).catch(() => undefined);
  if (!m) return c.html(INDEX, 404); // SPA shows "We couldn't find @handle"
  const title = escapeHtml(`${m.name} (@${m.handle}) · signmysite`);
  const desc = escapeHtml(`${m.name} on signmysite`);
  const og =
    `<meta property="og:title" content="${title}">` +
    `<meta property="og:description" content="${desc}">` +
    `<meta property="og:type" content="profile">` +
    `<meta property="og:url" content="${escapeHtml(`${BASE}/@${m.handle}`)}">` +
    (m.avatar ? `<meta property="og:image" content="${escapeHtml(m.avatar)}">` : "") +
    `<meta name="twitter:card" content="summary">`;
  const html = INDEX
    .replace(/<title>.*?<\/title>/s, `<title>${title}</title>`)
    .replace(/<meta\s+name="description"[^>]*>/s, `<meta name="description" content="${desc}" />`)
    .replace("</head>", `${og}</head>`);
  return c.html(html);
});

// "What is this?" at a stable, conventional, machine-readable location — so an
// agent that meets only the script tag can resolve the whole protocol (docs,
// spec, schema, register endpoint, install line) from a single fetch.
app.get("/.well-known/signmysite.json", (c) => {
  c.header("access-control-allow-origin", "*");
  c.header("cache-control", "no-cache");
  return c.json(siteManifest(BASE));
});

// Welcome agents explicitly — signmysite is meant to be read and used by them. This
// overrides any static robots.txt. (An edge CDN/WAF may still serve its own and
// block AI user-agents; that has to be allow-listed at the edge, not here.)
app.get("/robots.txt", (c) => {
  c.header("content-type", "text/plain; charset=utf-8");
  c.header("access-control-allow-origin", "*");
  return c.body(robotsTxt(BASE));
});

// Agent-facing docs (skill.md, llms.txt, the platform guides) are plain
// files, but every URL inside them must name THIS origin. Serve text docs with
// the same sentinel rewrite as the widget, so the docs an agent reads and the
// service it must call can never disagree. Other paths fall through to static.
app.get("/*", async (c, next) => {
  let path = decodeURIComponent(c.req.path);
  if (path.startsWith("/")) path = path.slice(1);
  const isDoc = path.endsWith(".md") || path.endsWith(".txt");
  if (!isDoc || path.includes("..")) return next();
  let text: string;
  try {
    text = readFileSync(new URL("../" + path, import.meta.url), "utf8");
  } catch {
    return next(); // not a repo file — let serveStatic 404 it
  }
  c.header("content-type", path.endsWith(".md") ? "text/markdown; charset=utf-8" : "text/plain; charset=utf-8");
  c.header("access-control-allow-origin", "*");
  c.header("cache-control", "no-cache");
  return c.body(rewriteOrigin(text, BASE));
});

// Serve the repo's other static files (widget/, examples/, schema/, skill.md,
// and site/app.css — linked by the server-rendered /join + /auth/popup pages)
// from the same origin, so everything is one origin with no config.
app.use("/*", serveStatic({ root: "./" }));

// Everything else is a client-side route (/edit, /messages, /auth, …) — the SPA
// routes by path now, so a hard load or refresh of any in-app URL must get the
// shell. Unknown /api paths stay JSON 404s rather than leaking HTML to clients.
app.get("*", (c) =>
  c.req.path.startsWith("/api/") ? c.json({ error: "not found" }, 404) : c.html(INDEX));

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`\n  signmysite  → ${BASE}`);
  console.log(`  demo → ${BASE}/widget/demo.html\n`);
  startCrawler(); // no-op unless SIGNMYSITE_CRAWL_MINUTES is set
  startSweeps(); // activation nudges (+ future digests) — no-op unless SIGNMYSITE_SWEEP_HOURS is set
});
