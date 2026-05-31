/*
 * The Den API — the table from SPEC.md §8, on Hono.
 *
 *   POST /api/register          mint an id + handle
 *   POST /api/auth/magic-link   email a sign-in / recovery link (no passwords, no keys)
 *   GET  /api/auth/verify       consume a link, start a session
 *   GET  /auth                  the sign-in popup page
 *   GET  /api/profile/:id       public profile
 *   GET  /api/profile/:id/stats followers / following / viewer state
 *   POST /api/follow            follow or unfollow (toggle)
 *   POST /api/save              save or unsave (toggle)
 *   POST /api/discover          fetch + index a site's me.json
 *   GET  /api/viewer            the signed-in member, or null
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { getCookie, setCookie } from "hono/cookie";
import * as db from "./db.ts";
import { newId, newHandle, escapeHtml } from "./util.ts";

export const PORT = Number(process.env.PORT || 8787);
export const BASE = (process.env.DEN_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const SECURE = BASE.startsWith("https://");
const COOKIE = "den_session";
const HAS_MAILER = process.env.DEN_EMAIL === "smtp"; // not wired in the reference impl

export const app = new Hono();

// Allow credentialed cross-origin calls from any personal site hosting the widget.
app.use("/api/*", cors({
  origin: (o) => o || "*",
  credentials: true,
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["content-type"],
}));

const publicMember = (m: db.Member) => ({ id: m.id, handle: m.handle, name: m.name, url: m.url, avatar: m.avatar, bio: m.bio });
const viewerOf = (c: Context) => db.getSessionMember(getCookie(c, COOKIE));
const body = (c: Context) => c.req.json().catch(() => ({} as any));

async function uniqueHandle(): Promise<string> {
  for (let i = 0; i < 6; i++) {
    const h = newHandle();
    if (!(await db.getMemberByHandle(h))) return h;
  }
  return newHandle();
}
function setSession(c: Context, tok: string): void {
  setCookie(c, COOKIE, tok, {
    httpOnly: true, path: "/", maxAge: 60 * 60 * 24 * 30,
    sameSite: SECURE ? "None" : "Lax", secure: SECURE,
  });
}

// ---- identity ------------------------------------------------------------
app.post("/api/register", async (c) => {
  const b = await body(c);
  const email = b?.email ? String(b.email).trim().toLowerCase() : null;
  if (email) {
    const existing = await db.getMemberByEmail(email);
    if (existing) return c.json({ id: existing.id, handle: existing.handle, url: existing.url });
  }
  let handle: string;
  if (b?.handle) {
    handle = String(b.handle).toLowerCase();
    if (await db.getMemberByHandle(handle)) return c.json({ error: "handle taken" }, 409);
  } else {
    handle = await uniqueHandle();
  }
  const id = newId();
  const name = b?.name ? String(b.name) : (b?.handle ? String(b.handle) : "New member");
  const m = await db.createMember({ id, handle, name, email, url: b?.url || null });
  return c.json({ id: m.id, handle: m.handle, url: m.url });
});

// ---- discovery / indexing ------------------------------------------------
app.post("/api/discover", async (c) => {
  const target = String((await body(c))?.url || "").trim();
  if (!target) return c.json({ error: "url required" }, 400);
  const meUrl = /\.json(\?|$)/.test(target) ? target : target.replace(/\/$/, "") + "/me.json";

  let doc: any;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 5000);
    const r = await fetch(meUrl, { signal: ac.signal });
    clearTimeout(timer);
    if (!r.ok) return c.json({ error: `could not fetch me.json (${r.status})` }, 400);
    doc = await r.json();
  } catch (e: any) {
    return c.json({ error: "could not fetch me.json", detail: String(e?.message || e) }, 400);
  }
  if (!doc || typeof doc.id !== "string" || typeof doc.name !== "string") {
    return c.json({ error: "invalid me.json (need id + name)" }, 422);
  }

  let handle = doc.handle ? String(doc.handle).toLowerCase() : null;
  if (handle) {
    const owner = await db.getMemberByHandle(handle);
    if (owner && owner.id !== doc.id) handle = null; // never steal a taken handle
  }
  const patch = { handle, name: String(doc.name), url: doc.url || target, avatar: doc.avatar || null, bio: doc.bio || null };
  if (await db.getMember(doc.id)) await db.updateMember(doc.id, patch);
  else await db.createMember({ id: doc.id, ...patch });

  let edges = 0;
  if (Array.isArray(doc.links)) {
    for (const l of doc.links) {
      if (l && typeof l.id === "string") { await db.setEdge(doc.id, l.id, l.rel || "follow"); edges++; }
    }
  }
  return c.json({ ok: true, id: doc.id, edges });
});

// ---- profiles & graph ----------------------------------------------------
app.get("/api/profile/:id", async (c) => {
  const m = await db.getMember(c.req.param("id"));
  return m ? c.json(publicMember(m)) : c.json({ error: "not found" }, 404);
});

app.get("/api/profile/:id/stats", async (c) => {
  const viewer = await viewerOf(c);
  return c.json(await db.stats(c.req.param("id"), viewer?.id));
});

app.post("/api/follow", async (c) => {
  const viewer = await viewerOf(c);
  if (!viewer) return c.json({ error: "sign in" }, 401);
  const id = String((await body(c))?.id || "");
  if (!id) return c.json({ error: "id required" }, 400);
  if (id === viewer.id) return c.json({ error: "cannot follow yourself" }, 400);
  if (await db.hasEdge(viewer.id, id)) await db.removeEdge(viewer.id, id);
  else await db.setEdge(viewer.id, id, "follow");
  return c.json(await db.stats(id, viewer.id));
});

app.post("/api/save", async (c) => {
  const viewer = await viewerOf(c);
  if (!viewer) return c.json({ error: "sign in" }, 401);
  const id = String((await body(c))?.id || "");
  if (!id) return c.json({ error: "id required" }, 400);
  if (await db.hasSave(viewer.id, id)) await db.removeSave(viewer.id, id);
  else await db.setSave(viewer.id, id);
  return c.json(await db.stats(id, viewer.id));
});

app.get("/api/viewer", async (c) => {
  const viewer = await viewerOf(c);
  return c.json(viewer ? publicMember(viewer) : null);
});

// ---- auth (email magic link — the only thing a human ever does) ----------
app.post("/api/auth/magic-link", async (c) => {
  const b = await body(c);
  const email = String(b?.email || "").trim().toLowerCase();
  if (!email.includes("@")) return c.json({ error: "valid email required" }, 400);
  const ret = b?.return ? String(b.return) : "";
  const tok = await db.createMagicLink(email);
  const link = `${BASE}/api/auth/verify?token=${tok}${ret ? `&return=${encodeURIComponent(ret)}` : ""}`;
  console.log(`\n[magic-link] ${email}\n  ${link}\n`);
  // No mailer in the reference impl: hand the link back so dev/demo can finish.
  return c.json(HAS_MAILER ? { ok: true } : { ok: true, dev_link: link });
});

app.get("/api/auth/verify", async (c) => {
  const email = await db.consumeMagicLink(c.req.query("token") || "");
  if (!email) return c.html(page("Link expired", "<p>This sign-in link is invalid or expired. Close this window and try again.</p>"), 400);

  let m = await db.getMemberByEmail(email);
  if (!m) m = await db.createMember({ id: newId(), handle: await uniqueHandle(), name: email.split("@")[0], email });
  setSession(c, await db.createSession(m.id));

  const ret = c.req.query("return") || "";
  return c.html(page("Signed in", `
    <p>Signed in as <b>${escapeHtml(m.handle || m.name)}</b>. You can close this window.</p>
    <script>
      try { if (window.opener) window.opener.postMessage({ den: "signed-in" }, "*"); } catch (e) {}
      ${ret ? `setTimeout(function(){ location.replace(${JSON.stringify(ret)}); }, 500);`
            : `setTimeout(function(){ window.close(); }, 400);`}
    </script>`));
});

app.get("/auth", (c) => {
  const ret = c.req.query("return") || "";
  return c.html(page("Sign in to Den", `
    <h1>Sign in to Den</h1>
    <p>Enter your email — we'll send a magic link. No password, no keys.</p>
    <form id="f">
      <input id="e" type="email" placeholder="you@example.com" required autofocus />
      <button type="submit">Send link</button>
    </form>
    <div id="out"></div>
    <script>
      var ret = ${JSON.stringify(ret)};
      document.getElementById("f").addEventListener("submit", async function (ev) {
        ev.preventDefault();
        var r = await fetch("/api/auth/magic-link", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: document.getElementById("e").value, return: ret })
        });
        var j = await r.json();
        document.getElementById("out").innerHTML = j.dev_link
          ? '<p>Dev mode — <a href="' + j.dev_link + '">click to continue &rarr;</a></p>'
          : "<p>Check your email for the link.</p>";
      });
    </script>`));
});

function page(title: string, inner: string): string {
  return `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:420px;margin:80px auto;padding:0 20px;line-height:1.5;color:#111}
  input{font-size:16px;padding:9px 10px;width:100%;box-sizing:border-box;margin:10px 0;border:1px solid #ccc;border-radius:8px}
  button{font-size:15px;font-weight:600;padding:9px 14px;border:0;border-radius:8px;background:#0b0b0c;color:#fff;cursor:pointer}
  a{color:#0b57d0}
</style>
${inner}`;
}
