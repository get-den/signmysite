/*
 * The Den API, on Hono.
 *
 *   GET  /api/auth/google        start Sign in with Google (redirect)
 *   GET  /api/auth/google/callback   finish Google sign-in, set session
 *   POST /api/auth/magic-link    email a sign-in / recovery link (fallback)
 *   GET  /api/auth/verify        consume a magic link, start a session
 *   GET  /auth                   the sign-in popup page (Google + email)
 *   POST /api/logout             end the session
 *   GET  /api/viewer             the signed-in member, or null
 *   PATCH /api/profile           edit your own profile
 *   GET  /api/profile/:id        public profile
 *   GET  /api/profile/:id/stats  views / followers / following / viewer state
 *   POST /api/profile/:id/view   increment view count (widget impression)
 *   GET  /api/profile/:id/comments   list comments (with author blog links)
 *   POST /api/profile/:id/comments   add a comment (members only)
 *   GET  /api/following          blogs the signed-in member follows
 *   POST /api/follow             follow or unfollow (toggle)
 *   POST /api/save               save or unsave (toggle)
 *   POST /api/register           mint an id + handle (agent-assisted onboarding)
 *   POST /api/sites/claim        widget self-registers a site by id (zero-fetch onboarding)
 *   POST /api/discover           fetch + index a site's me.json
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import * as db from "./db.ts";
import { newId, newHandle, token, escapeHtml } from "./util.ts";
import * as auth from "./auth.ts";

export const PORT = Number(process.env.PORT || 8787);
export const BASE = (process.env.DEN_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const SECURE = BASE.startsWith("https://");
const COOKIE = "den_session";
const HAS_MAILER = process.env.DEN_EMAIL === "smtp"; // not wired in the reference impl
const oauthStates = new Set<string>();               // CSRF state for the OAuth dance

export const app = new Hono();

// Allow credentialed cross-origin calls from any personal site hosting the widget.
app.use("/api/*", cors({
  origin: (o) => o || "*",
  credentials: true,
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["content-type"],
}));

const publicMember = (m: db.Member) => ({
  id: m.id, handle: m.handle, name: m.name, url: m.url, avatar: m.avatar, bio: m.bio, views: m.views,
});
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
const GOOGLE_REDIRECT = BASE + "/api/auth/google/callback";

// ---- Sign in with Google -------------------------------------------------
app.get("/api/auth/google", async (c) => {
  const ret = c.req.query("return") || "/";
  const state = token(12);
  oauthStates.add(state);
  // Stash where to return after sign-in, keyed by state, in a short cookie.
  setCookie(c, "den_ret", JSON.stringify({ state, ret }), {
    httpOnly: true, path: "/", maxAge: 600, sameSite: "Lax", secure: SECURE,
  });

  if (!auth.GOOGLE_LIVE) {
    // Dev stub: no real Google — bounce straight to the callback with the state.
    return c.redirect(`/api/auth/google/callback?state=${state}&stub=1`);
  }
  return c.redirect(auth.googleAuthUrl(GOOGLE_REDIRECT, state));
});

app.get("/api/auth/google/callback", async (c) => {
  const stash = JSON.parse(getCookie(c, "den_ret") || "{}");
  const ret = typeof stash.ret === "string" ? stash.ret : "/";
  const state = c.req.query("state") || "";
  if (!state || state !== stash.state) return c.text("bad state", 400);
  oauthStates.delete(state);
  deleteCookie(c, "den_ret", { path: "/" });

  try {
    const profile = auth.GOOGLE_LIVE
      ? await auth.exchangeGoogleCode(c.req.query("code") || "", GOOGLE_REDIRECT)
      : auth.stubProfile(c.req.query("email") || undefined);
    await auth.signInWithGoogle(c, profile, { cookie: COOKIE, secure: SECURE });
  } catch (e: any) {
    return c.text("sign-in failed: " + String(e?.message || e), 400);
  }
  return c.redirect(ret);
});

app.post("/api/logout", (c) => {
  const t = getCookie(c, COOKIE);
  if (t) db.deleteSession(t);
  deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ ok: true });
});

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

// Zero-fetch onboarding: the agent pastes a tag with a self-minted id and never
// calls us; the widget claims that id here on first page load. Idempotent — a
// known id just no-ops. The site stays unclaimed until someone signs in and
// links it (see /api/profile editing + the main site).
app.post("/api/sites/claim", async (c) => {
  const b = await body(c);
  const id = String(b?.id || "");
  if (!/^den:[a-z0-9]{8,}$/.test(id)) return c.json({ error: "valid id required" }, 400);
  const existing = await db.getMember(id);
  if (existing) return c.json({ id: existing.id, handle: existing.handle, claimed: true });
  const handle = await uniqueHandle();
  const m = await db.createMember({
    id, handle,
    name: b?.name ? String(b.name).slice(0, 80) : "New blog",
    url: b?.url ? String(b.url) : null,
  });
  return c.json({ id: m.id, handle: m.handle, claimed: false });
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

// ---- profile editing -----------------------------------------------------
app.patch("/api/profile", async (c) => {
  const viewer = await viewerOf(c);
  if (!viewer) return c.json({ error: "sign in" }, 401);
  const b = await body(c);
  const patch: Partial<db.Member> = {};
  if (typeof b.name === "string" && b.name.trim()) patch.name = b.name.trim().slice(0, 80);
  if (typeof b.bio === "string") patch.bio = b.bio.slice(0, 280);
  if (typeof b.url === "string") patch.url = b.url.trim() || null;
  if (typeof b.avatar === "string") patch.avatar = b.avatar.trim() || null;
  if (typeof b.handle === "string" && b.handle.trim()) {
    const h = b.handle.trim().toLowerCase();
    const owner = await db.getMemberByHandle(h);
    if (owner && owner.id !== viewer.id) return c.json({ error: "handle taken" }, 409);
    patch.handle = h;
  }
  const updated = await db.updateMember(viewer.id, patch);
  return c.json(publicMember(updated!));
});

// ---- views ---------------------------------------------------------------
app.post("/api/profile/:id/view", async (c) => {
  const views = await db.addView(c.req.param("id"));
  return c.json({ views });
});

// ---- comments ------------------------------------------------------------
app.get("/api/profile/:id/comments", async (c) => {
  const rows = await db.listComments(c.req.param("id"));
  return c.json(rows.map((r) => ({
    id: r.id, body: r.body, created: r.created,
    author: { id: r.author_id, name: r.author_name, handle: r.author_handle, avatar: r.author_avatar, url: r.author_url },
  })));
});

app.post("/api/profile/:id/comments", async (c) => {
  const viewer = await viewerOf(c);
  if (!viewer) return c.json({ error: "sign in" }, 401); // members-only (your call)
  const targetId = c.req.param("id");
  if (!(await db.getMember(targetId))) return c.json({ error: "not found" }, 404);
  const text = String((await body(c))?.body || "").trim();
  if (!text) return c.json({ error: "empty comment" }, 400);
  await db.addComment({ id: "c_" + token(8), target_id: targetId, author_id: viewer.id, body: text.slice(0, 1000) });
  const rows = await db.listComments(targetId);
  return c.json(rows.map((r) => ({
    id: r.id, body: r.body, created: r.created,
    author: { id: r.author_id, name: r.author_name, handle: r.author_handle, avatar: r.author_avatar, url: r.author_url },
  })));
});

// ---- following list ------------------------------------------------------
app.get("/api/following", async (c) => {
  const viewer = await viewerOf(c);
  if (!viewer) return c.json({ error: "sign in" }, 401);
  return c.json((await db.listFollowing(viewer.id)).map(publicMember));
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
  const ret = c.req.query("return") || "/";
  const stub = auth.GOOGLE_LIVE ? "" : " (dev stub — no real Google needed)";
  return c.html(page("Sign in to Den", `
    <h1>Sign in to Den</h1>
    <a class="google" href="/api/auth/google?return=${encodeURIComponent(ret)}">
      <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.9 2.4 30.3 0 24 0 14.6 0 6.4 5.4 2.5 13.3l7.9 6.1C12.3 13.2 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.1 5.3-4.6 7l7.1 5.5c4.2-3.9 6.6-9.6 6.6-16.5z"/><path fill="#FBBC05" d="M10.4 28.6c-.5-1.5-.8-3-.8-4.6s.3-3.1.8-4.6l-7.9-6.1C.9 16.5 0 20.1 0 24s.9 7.5 2.5 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.3 0 11.6-2.1 15.5-5.6l-7.1-5.5c-2 1.4-4.6 2.2-8.4 2.2-6.3 0-11.7-3.7-13.6-9.4l-7.9 6.1C6.4 42.6 14.6 48 24 48z"/></svg>
      Continue with Google${stub}
    </a>
    <div class="or">or</div>
    <form id="f">
      <input id="e" type="email" placeholder="you@example.com" required />
      <button type="submit">Email me a link</button>
    </form>
    <div id="out"></div>
    <p class="fine">No passwords. No keys. We never see your Google password.</p>
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
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:380px;margin:80px auto;padding:0 24px;line-height:1.5;color:#0b0b0c}
  h1{font-size:24px;margin:0 0 20px}
  input{font-size:16px;padding:10px 12px;width:100%;box-sizing:border-box;margin:0 0 10px;border:1px solid #d7d7db;border-radius:10px}
  button{font-size:15px;font-weight:600;padding:10px 14px;width:100%;border:0;border-radius:10px;background:#0b0b0c;color:#fff;cursor:pointer}
  a{color:#0b57d0}
  .google{display:flex;align-items:center;justify-content:center;gap:10px;text-decoration:none;
    color:#0b0b0c;font-weight:600;font-size:15px;padding:11px 14px;border:1px solid #d7d7db;border-radius:10px}
  .google:hover{background:#fafafa}
  .or{display:flex;align-items:center;gap:10px;color:#9aa0a6;font-size:13px;margin:16px 0}
  .or:before,.or:after{content:"";flex:1;height:1px;background:#ececef}
  .fine{color:#9aa0a6;font-size:12px;margin-top:18px;text-align:center}
</style>
${inner}`;
}
