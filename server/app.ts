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
 *   GET  /api/profile/:id/comments   list notes (private ones redacted unless owner/author)
 *   POST /api/profile/:id/comments   leave a note (members only; public|private)
 *   GET  /api/inbox              pigeon box: every note left on your site(s)
 *   GET  /api/following          blogs the signed-in member follows
 *   POST /api/follow             follow or unfollow (toggle)
 *   POST /api/save               save or unsave (toggle)
 *   POST /api/register           mint an id + handle (agent-assisted onboarding)
 *   POST /api/sites/claim        widget self-registers a site by id (zero-fetch onboarding)
 *   POST /api/discover           fetch + index a site's me.json
 *   GET  /@:handle               public profile page (server-rendered, shareable)
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import * as db from "./db.ts";
import { newId, newHandle, token, escapeHtml } from "./util.ts";
import { inspectSite } from "./preview.ts";
import { sendMagicLink, MAIL_LIVE } from "./mail.ts";
import * as auth from "./auth.ts";

export const PORT = Number(process.env.PORT || 8787);
export const BASE = (process.env.DEN_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const SECURE = BASE.startsWith("https://");
const COOKIE = "den_session";
const HAS_MAILER = MAIL_LIVE; // true when RESEND_API_KEY is set (see mail.ts)
const oauthStates = new Set<string>();               // CSRF state for the OAuth dance

export const app = new Hono();

// Allow cross-origin calls from any personal site hosting the widget.
// We accept a Bearer token (first-party localStorage on the host site) because
// third-party cookies are blocked by Safari and deprecated in Chrome — the
// cookie path still works first-party on den.com itself.
app.use("/api/*", cors({
  origin: (o) => o || "*",
  credentials: true,
  allowMethods: ["GET", "POST", "PATCH", "OPTIONS"],
  allowHeaders: ["content-type", "authorization"],
}));

const publicMember = (m: db.Member | db.SiteCard) => ({
  id: m.id, handle: m.handle, name: m.name, url: m.url, avatar: m.avatar, bio: m.bio,
  views: m.views, thumbnail: m.thumbnail, lastEdited: m.last_edited,
  savedCount: "saved_count" in m ? Number(m.saved_count || 0) : undefined,
  followerCount: "follower_count" in m ? Number(m.follower_count || 0) : undefined,
  mutualCount: "mutual_count" in m ? Number(m.mutual_count || 0) : undefined,
});
// The session token comes from the first-party cookie (on den.com) OR a Bearer
// header (the widget, embedded cross-site, where cookies are blocked). Same
// token either way — sessions are token-keyed in the DB.
function sessionToken(c: Context): string | undefined {
  const auth = c.req.header("authorization");
  if (auth && auth.slice(0, 7).toLowerCase() === "bearer ") return auth.slice(7).trim();
  return getCookie(c, COOKIE);
}
const viewerOf = (c: Context) => db.getSessionMember(sessionToken(c));
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
    httpOnly: true, path: "/", maxAge: db.SESSION_TTL_SEC,
    sameSite: SECURE ? "None" : "Lax", secure: SECURE,
  });
}
const GOOGLE_REDIRECT = BASE + "/api/auth/google/callback";

// ---- Sign in with Google -------------------------------------------------
app.get("/api/auth/google", async (c) => {
  const ret = c.req.query("return") || "/";
  const popup = c.req.query("popup") === "1";
  const state = token(12);
  oauthStates.add(state);
  // Stash return target + popup mode, keyed by state, in a short cookie.
  setCookie(c, "den_ret", JSON.stringify({ state, ret, popup }), {
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

  let token: string;
  try {
    const profile = auth.GOOGLE_LIVE
      ? await auth.exchangeGoogleCode(c.req.query("code") || "", GOOGLE_REDIRECT)
      : auth.stubProfile(c.req.query("email") || undefined);
    token = (await auth.signInWithGoogle(c, profile, { cookie: COOKIE, secure: SECURE })).token;
  } catch (e: any) {
    return c.text("sign-in failed: " + String(e?.message || e), 400);
  }
  return stash.popup ? c.html(popupFinish(token)) : c.redirect(ret);
});

// Shown inside the auth popup the widget opens. It hands the opener (the
// personal site) the session token — so the widget can authenticate without a
// third-party cookie (Safari blocks those) — which also triggers auto-posting
// the preserved note, then closes itself. The host page never navigates.
function popupFinish(token: string): string {
  return `<!doctype html><meta charset="utf-8"><title>Signed in</title>
<body style="font-family:-apple-system,system-ui,sans-serif;padding:40px;text-align:center;color:#0b0b0c">
<p>Signed in. You can close this window.</p>
<script>
  try { if (window.opener) window.opener.postMessage({ den: "signed-in", token: ${JSON.stringify(token)} }, "*"); } catch (e) {}
  setTimeout(function(){ try { window.close(); } catch (e) {} }, 300);
</script>`;
}

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

app.post("/api/sites/resolve", async (c) => {
  const b = await body(c);
  const url = String(b?.url || "").replace(/\/$/, "");
  if (!/^https?:\/\//.test(url)) return c.json({ error: "valid url required" }, 400);

  const viewer = await viewerOf(c);
  if (viewer) {
    const patch: Partial<db.Member> = {};
    if (!isLocalUrl(url)) patch.url = url;
    if (!viewer.name || viewer.name === "New member") patch.name = String(b?.name || "My site").slice(0, 80);
    if (Object.keys(patch).length) await db.updateMember(viewer.id, patch);
    return cardPayload(c, viewer.id);
  }

  const existing = await db.getMemberByUrl(url);
  if (existing) return cardPayload(c, existing.id);

  return c.json(emptyCard(url, String(b?.name || "")));
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
  // Freshness: honor an explicit me.json `updated`, else mark edited now.
  await db.markEdited(doc.id, typeof doc.updated === "string" ? doc.updated : undefined);
  // Grab a preview thumbnail (og:image) in the background.
  refreshPreview(doc.id, doc.url || target).catch(() => {});
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

// ---- freshness: "my site changed" ----------------------------------------
// Called by the owner's deploy (GitHub Action, Vercel/Netlify hook, WordPress
// save_post — see docs). Bumps last_edited so followers see "new", and refreshes
// the preview thumbnail from the site's og:image. No auth: the id is the secret,
// and the only effect is "this public site updated" (worst case, a stale bump).
app.post("/api/ping", async (c) => {
  const b = await body(c);
  const id = String(b?.id || "");
  const m = await db.getMember(id);
  if (!m) return c.json({ error: "unknown id" }, 404);
  await db.markEdited(id, typeof b?.at === "string" ? b.at : undefined);
  // Refresh the thumbnail in the background — don't make the deploy wait on it.
  refreshPreview(id, m.url).catch(() => {});
  return c.json({ ok: true });
});

// Pull the site's og:image into our thumbnail (and record the content hash).
async function refreshPreview(id: string, url: string | null): Promise<void> {
  if (!url) return;
  const p = await inspectSite(url);
  if (!p) return;
  if (p.thumbnail) await db.setThumbnail(id, p.thumbnail);
  await db.noteContentHash(id, p.hash);
}

// ---- widget card ---------------------------------------------------------
// Everything the widget needs in ONE request: identity, stats, who's viewing
// (for owner mode), and notes. Fewer round-trips = faster on slow third-party
// pages, and the widget's loader collapses to a single fetch.
app.get("/api/profile/:id/card", async (c) => {
  return cardPayload(c, c.req.param("id"));
});

async function cardPayload(c: Context, id: string) {
  let m = await db.getMember(id);
  if (!m) return c.json({ error: "not found" }, 404);
  let viewer = await viewerOf(c);
  if (viewer && viewer.id !== m.id && isUnclaimed(m) && sameOrigin(c.req.header("origin"), m.url)) {
    m = (await db.claimUnclaimedMember(m.id, viewer.id)) || m;
    viewer = m;
  }
  const [s, comments] = await Promise.all([db.stats(id, viewer?.id), db.listComments(id)]);
  // A signed-in viewer opening the card = they've "seen" this site now, so it
  // stops showing as new to them until the next edit.
  if (viewer && viewer.id !== id) db.recordVisit(viewer.id, id).catch(() => {});
  return c.json({
    profile: publicMember(m),
    stats: s,
    viewer: viewer ? { id: viewer.id, handle: viewer.handle, name: viewer.name } : null,
    comments: shapeComments(comments, id, viewer?.id),
    script: `${BASE}/w/${m.id.replace(/^den:/, "")}.js`,
  });
}

function isUnclaimed(m: db.Member): boolean {
  return !m.email && !m.google_sub;
}

function sameOrigin(origin: string | undefined, url: string | null): boolean {
  try {
    return !!origin && !!url && new URL(origin).origin === new URL(url).origin;
  } catch {
    return false;
  }
}

function emptyCard(url: string, name: string) {
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "This site"; } })();
  return {
    profile: {
      id: "", handle: null, name: name.slice(0, 80) || host, url, avatar: null,
      bio: "Sign in to personalize this Den widget.", views: 0, thumbnail: null, lastEdited: null,
    },
    stats: { views: 0, followers: 0, following: 0, saved: 0, viewerFollows: false, viewerSaved: false },
    viewer: null,
    comments: [],
    script: `${BASE}/w.js`,
  };
}

function isLocalUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".local");
  } catch {
    return false;
  }
}

// ---- comments / notes ----------------------------------------------------
// Redaction happens here, server-side: a private note's body + author are only
// returned to the site owner (the target) or the note's own author. Everyone
// else gets a placeholder, so private content never leaves the server.
function shapeComments(rows: Awaited<ReturnType<typeof db.listComments>>, targetId: string, viewerId?: string) {
  const isOwner = !!viewerId && viewerId === targetId;
  return rows.map((r) => {
    const canSee = r.visibility === "public" || isOwner || r.author_id === viewerId;
    if (canSee) {
      return {
        id: r.id, body: r.body, visibility: r.visibility, created: r.created, redacted: false,
        author: { id: r.author_id, name: r.author_name, handle: r.author_handle, avatar: r.author_avatar, url: r.author_url },
      };
    }
    return { id: r.id, visibility: "private", created: r.created, redacted: true, body: null, author: null };
  });
}

app.get("/api/profile/:id/comments", async (c) => {
  const targetId = c.req.param("id");
  const viewer = await viewerOf(c);
  const rows = await db.listComments(targetId);
  return c.json(shapeComments(rows, targetId, viewer?.id));
});

app.post("/api/profile/:id/comments", async (c) => {
  const viewer = await viewerOf(c);
  if (!viewer) return c.json({ error: "sign in" }, 401); // members-only (your call)
  const targetId = c.req.param("id");
  if (!(await db.getMember(targetId))) return c.json({ error: "not found" }, 404);
  const b = await body(c);
  const text = String(b?.body || "").trim();
  if (!text) return c.json({ error: "empty comment" }, 400);
  const visibility = b?.visibility === "private" ? "private" : "public";
  await db.addComment({ id: "c_" + token(8), target_id: targetId, author_id: viewer.id, body: text.slice(0, 1000), visibility });
  const rows = await db.listComments(targetId);
  return c.json(shapeComments(rows, targetId, viewer.id));
});

// Pigeon box: every note left on YOUR site(s), public + private.
app.get("/api/inbox", async (c) => {
  const viewer = await viewerOf(c);
  if (!viewer) return c.json({ error: "sign in" }, 401);
  const rows = await db.listInbox(viewer.id);
  return c.json(rows.map((r) => ({
    id: r.id, body: r.body, visibility: r.visibility, created: r.created,
    author: { id: r.author_id, name: r.author_name, handle: r.author_handle, avatar: r.author_avatar, url: r.author_url },
    site: { handle: r.target_handle, name: r.target_name },
  })));
});

// ---- following list ------------------------------------------------------
// Returns followed sites newest-edit-first, each tagged isNew for this viewer.
app.get("/api/following", async (c) => {
  const viewer = await viewerOf(c);
  if (!viewer) return c.json({ error: "sign in" }, 401);
  return c.json((await db.listFollowing(viewer.id)).map((m) => ({ ...publicMember(m), isNew: m.isNew })));
});

app.get("/api/saved", async (c) => {
  const viewer = await viewerOf(c);
  if (!viewer) return c.json({ error: "sign in" }, 401);
  return c.json((await db.listSaved(viewer.id)).map(publicMember));
});

app.get("/api/discovery", async (c) => {
  const viewer = await viewerOf(c);
  if (!viewer) return c.json({ error: "sign in" }, 401);
  const [saved, mostSaved, recommended] = await Promise.all([
    db.listSaved(viewer.id),
    db.listMostSaved(16),
    db.listRecommended(viewer.id, 16),
  ]);
  return c.json({
    saved: saved.map((m) => ({ ...publicMember(m), reason: "Saved for later" })),
    mostSaved: mostSaved.map((m) => ({ ...publicMember(m), reason: `${Number(m.saved_count || 0)} saves all-time` })),
    recommended: recommended.map((m) => ({
      ...publicMember(m),
      reason: Number(m.mutual_count || 0) > 0
        ? `${Number(m.mutual_count || 0)} mutual ${Number(m.mutual_count || 0) === 1 ? "friend" : "friends"}`
        : "Similar visual style",
    })),
  });
});

app.get("/api/comments/outgoing", async (c) => {
  const viewer = await viewerOf(c);
  if (!viewer) return c.json({ error: "sign in" }, 401);
  const rows = await db.listOutgoing(viewer.id);
  return c.json(rows.map((r) => ({
    id: r.id, body: r.body, visibility: r.visibility, created: r.created,
    site: {
      id: r.target_id,
      name: r.target_name,
      handle: r.target_handle,
      avatar: r.target_avatar,
      url: r.target_url,
    },
  })));
});

// ---- auth (email magic link — the only thing a human ever does) ----------
app.post("/api/auth/magic-link", async (c) => {
  const b = await body(c);
  const email = String(b?.email || "").trim().toLowerCase();
  if (!email.includes("@")) return c.json({ error: "valid email required" }, 400);
  const ret = b?.return ? String(b.return) : "";
  const popup = b?.popup ? "&popup=1" : "";
  const tok = await db.createMagicLink(email);
  const link = `${BASE}/api/auth/verify?token=${tok}${ret ? `&return=${encodeURIComponent(ret)}` : ""}${popup}`;
  if (HAS_MAILER) {
    try {
      await sendMagicLink(email, link);
    } catch (e: any) {
      console.error("[magic-link] send failed:", String(e?.message || e));
      return c.json({ error: "could not send email, try again" }, 502);
    }
    return c.json({ ok: true });
  }
  // No mailer configured (local dev): log + hand the link back so dev can finish.
  console.log(`\n[magic-link] ${email}\n  ${link}\n`);
  return c.json({ ok: true, dev_link: link });
});

app.get("/api/auth/verify", async (c) => {
  const email = await db.consumeMagicLink(c.req.query("token") || "");
  if (!email) return c.html(page("Link expired", "<p>This sign-in link is invalid or expired. Close this window and try again.</p>"), 400);

  let m = await db.getMemberByEmail(email);
  if (!m) m = await db.createMember({ id: newId(), handle: await uniqueHandle(), name: email.split("@")[0], email });
  const tok = await db.createSession(m.id);
  setSession(c, tok);

  if (c.req.query("popup")) return c.html(popupFinish(tok));
  return c.redirect(c.req.query("return") || "/");
});

app.get("/auth", (c) => {
  const ret = c.req.query("return") || "/";
  const popup = c.req.query("popup") === "1";
  const gHref = `/api/auth/google?return=${encodeURIComponent(ret)}${popup ? "&popup=1" : ""}`;
  const stub = auth.GOOGLE_LIVE ? "" : " (dev stub — no real Google needed)";
  return c.html(page("Sign in to Den", `
    <h1>Sign in to Den</h1>
    <a class="google" href="${gHref}">
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
      var ret = ${JSON.stringify(ret)}, popup = ${popup ? "true" : "false"};
      document.getElementById("f").addEventListener("submit", async function (ev) {
        ev.preventDefault();
        var r = await fetch("/api/auth/magic-link", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: document.getElementById("e").value, return: ret, popup: popup })
        });
        var j = await r.json();
        var out = document.getElementById("out");
        if (j.dev_link) out.innerHTML = '<p>Dev mode — <a href="' + j.dev_link + '">click to continue &rarr;</a></p>';
        else if (j.ok) out.innerHTML = "<p>Check your email for the link.</p>";
        else out.innerHTML = "<p>" + (j.error || "Something went wrong, try again.") + "</p>";
      });
    </script>`));
});

// ---- public profile page (den.com/@handle) ------------------------------
// Server-rendered so it's shareable + crawlable (link previews, instant load).
// Reuses site/app.css — no new styles. Embeds the widget so visitors can
// follow/comment right here, exactly as they would on the member's own site.
app.get("/:at{@.+}", async (c) => {
  const handle = c.req.param("at").slice(1).toLowerCase();
  const m = await db.getMemberByHandle(handle);
  if (!m) return c.html(notFoundPage(handle), 404);

  const [s, following, comments] = await Promise.all([
    db.stats(m.id),
    db.listFollowing(m.id),
    db.listComments(m.id),
  ]);
  const idShort = m.id.replace(/^den:/, "");

  const av = (x: { avatar: string | null; name: string; handle: string | null }, cls: string) =>
    x.avatar
      ? `<div class="avatar ${cls}" style="background-image:url(${escapeHtml(JSON.stringify(x.avatar))})"></div>`
      : `<div class="avatar ${cls}">${escapeHtml((x.name || x.handle || "?").charAt(0).toUpperCase())}</div>`;
  const num = (n: number) => (n < 1000 ? String(n) : n < 1e6 ? (n / 1e3).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, "") + "K" : (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M");
  const hostOf = (u: string) => { try { return new URL(u).host; } catch { return u; } };

  const followingHtml = following.length
    ? following.map((b) => `<a class="blog" href="${b.url ? escapeHtml(b.url) : "/@" + escapeHtml(b.handle || "")}"${b.url ? ' target="_blank" rel="noopener"' : ""}>
        ${av(b, "")}
        <div class="meta"><div class="bn">${escapeHtml(b.name || "—")}</div>
        <div class="bh">${escapeHtml(b.url ? hostOf(b.url) : "@" + (b.handle || ""))}</div></div></a>`).join("")
    : `<div class="empty">Not following anyone yet.</div>`;

  // This page is public + crawlable, so only public notes are shown here.
  const publicComments = comments.filter((cm) => cm.visibility === "public");
  const commentsHtml = publicComments.length
    ? publicComments.map((cm) => `<div class="blog" style="border:0;padding:6px 0">
        ${av({ avatar: cm.author_avatar, name: cm.author_name, handle: cm.author_handle }, "")}
        <div class="meta"><div class="bn">${escapeHtml(cm.author_name)}${cm.author_url ? ` <a class="bh" href="${escapeHtml(cm.author_url)}" target="_blank" rel="noopener">(${escapeHtml(hostOf(cm.author_url))})</a>` : ""}</div>
        <div>${escapeHtml(cm.body)}</div></div></div>`).join("")
    : `<div class="empty">No notes yet.</div>`;

  const desc = m.bio || `${m.name} on Den`;
  const inner = `
  <div class="phead">
    ${av(m, "")}
    <div>
      <div class="pname">${escapeHtml(m.name)}</div>
      <div class="phandle">@${escapeHtml(m.handle || "")}</div>
      ${m.url ? `<div class="purl"><a href="${escapeHtml(m.url)}" target="_blank" rel="noopener">${escapeHtml(hostOf(m.url))}</a></div>` : ""}
    </div>
  </div>
  ${m.bio ? `<p class="pbio">${escapeHtml(m.bio)}</p>` : ""}
  <div class="pstats">
    <div><span class="n">${num(s.views)}</span> <span class="l">Views</span></div>
    <div><span class="n">${num(s.followers)}</span> <span class="l">Followers</span></div>
    <div><span class="n">${num(s.following)}</span> <span class="l">Following</span></div>
    <div><span class="n">${num(s.saved)}</span> <span class="l">Saved</span></div>
  </div>
  <div class="section"><h2>Blogs they follow</h2>${followingHtml}</div>
  <div class="section"><h2>Comments</h2>${commentsHtml}</div>
  <script src="/w/${escapeHtml(idShort)}.js" data-position="bottom-right"></script>`;

  return c.html(sitePage(`${m.name} (@${m.handle}) · Den`, escapeHtml(desc), m.avatar, inner));
});

function notFoundPage(handle: string): string {
  return sitePage("Not on Den", "", null, `
    <div class="hero"><h1>@${escapeHtml(handle)} isn't on Den yet.</h1>
    <p>Den links personal websites into one social graph.</p>
    <a class="btn primary" href="/">Get your own</a></div>`);
}

// A page that wears the main site's chrome + stylesheet (so profiles match the
// app exactly with no duplicated CSS), plus Open Graph tags for link previews.
function sitePage(title: string, desc: string, image: string | null, inner: string): string {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${desc}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${desc}">
<meta property="og:type" content="profile">
${image ? `<meta property="og:image" content="${escapeHtml(image)}">` : ""}
<meta name="twitter:card" content="summary">
<link rel="stylesheet" href="/site/app.css">
</head><body>
<header class="top"><a class="brand" href="/">den</a><nav><a class="btn sm" href="/">Home</a></nav></header>
<main>${inner}</main>
<footer class="foot"><span>Den is an open protocol.</span><a href="/SPEC.md">Spec</a><a href="/skill.md">For agents</a></footer>
</body></html>`;
}

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
