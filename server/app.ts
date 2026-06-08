/*
 * The signmysite API, on Hono.
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
 *   POST /api/profile/:id/view   log a view (who/where/referrer), or attach exit duration
 *   GET  /api/analytics          owner-only: counts, avg engaged time, named signmysite visitors
 *   GET  /api/profile/:id/history    the site's version timeline (snapshots)
 *   GET  /api/profile/:id/comments   list notes (private ones redacted unless owner/author)
 *   POST /api/profile/:id/comments   leave a note (members only; public|private)
 *   GET  /api/inbox              pigeon box: every note left on your site(s)
 *   GET  /api/threads            DM inbox: your conversations, newest first
 *   GET  /api/threads/:id        one conversation with a member (marks it read)
 *   POST /api/threads/:id        send a message to a member
 *   PATCH  /api/messages/:id     edit your own message
 *   DELETE /api/messages/:id     delete your own message (soft)
 *   POST /api/messages/:id/react toggle an emoji reaction on a message
 *   GET  /api/following          blogs the signed-in member follows
 *   POST /api/follow             follow (also saves the site) or unfollow (toggle)
 *   POST /api/save               save or unsave (toggle) — an explicit, follow-free bookmark
 *   POST /api/register           mint an id + handle (agent-assisted onboarding)
 *   POST /api/sites/claim        widget self-registers a site by id (zero-fetch onboarding)
 *   POST /api/discover           fetch + index a site's me.json
 *   POST /api/cohorts            create a crew (closed group); returns its invite link
 *   GET  /api/cohorts            the crews you're in (facepile + count each)
 *   GET  /api/cohorts/:id        one crew's roster (members only)
 *   POST /api/cohorts/join       join a crew by code (mutually follows the crew)
 *   POST /api/cohorts/:id/leave  leave a crew (your follows stay)
 *   GET  /join/:code             the shareable invite page (server-rendered)
 *   GET  /@:handle               public profile page (server-rendered, shareable)
 */
import { createHash } from "node:crypto";
import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import * as db from "./db.ts";
import { newId, newHandle, newCohortId, newInviteCode, token, escapeHtml, normHandle, handleProblem, isReaction, checkNotifyToken, relTime } from "./util.ts";
import { inspectSite, siteHasWidget } from "./preview.ts";
import { sendMagicLink, MAIL_LIVE, notifyUpdate, notifyActivity, notifyMilestone, notifyMessage, type ActivityKind } from "./mail.ts";
import * as auth from "./auth.ts";
import { renderProfileInner, siteHeader } from "./profile.ts";
import { BASE } from "./config.ts";
import { isDemo, demoCard } from "./demo.ts";

const SECURE = BASE.startsWith("https://");
const COOKIE = "signmysite_session";
const HAS_MAILER = MAIL_LIVE; // true when RESEND_API_KEY is set (see mail.ts)
const oauthStates = new Set<string>();               // CSRF state for the OAuth dance
// Uploaded avatars. The client crops + re-encodes to a small square before upload,
// so this ceiling is an abuse guard, not the expected size (~15KB WebP in practice).
const AVATAR_TYPES = new Set(["image/webp", "image/png", "image/jpeg"]);
const AVATAR_MAX_BYTES = 256 * 1024;
const COMMENTS_PER_SITE_PER_DAY = 10; // basic anti-spam cap (see POST /comments)

export const app = new Hono();

// Allow cross-origin calls from any personal site hosting the widget.
// We accept a Bearer token (first-party localStorage on the host site) because
// third-party cookies are blocked by Safari and deprecated in Chrome — the
// cookie path still works first-party on signmysite.com itself.
app.use("/api/*", cors({
  origin: (o) => o || "*",
  credentials: true,
  allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["content-type", "authorization"],
}));

const publicMember = (m: db.Member | db.SiteCard) => ({
  id: m.id, handle: m.handle, name: m.name, url: m.url, avatar: m.avatar,
  links: m.links ?? [],
  views: m.views, thumbnail: m.thumbnail, lastEdited: m.last_edited,
  savedCount: "saved_count" in m ? Number(m.saved_count || 0) : undefined,
  followerCount: "follower_count" in m ? Number(m.follower_count || 0) : undefined,
  mutualCount: "mutual_count" in m ? Number(m.mutual_count || 0) : undefined,
});
// The signed-in viewer's own record — adds the private-ish flags the SPA gates
// signup + verify prompts on (kept off public profiles).
const viewerJson = (m: db.Member) => ({ ...publicMember(m), onboarded: m.onboarded, verified: m.verified });
// A pinned site shown in a profile/widget: identity, its live preview image (for
// the widget's thumbnail/webring views), + the pinner's own public notes (the
// bubble). Where it links — own URL if any, else the signmysite profile. The thumbnail
// is a short cacheable URL (og:image), never inline bytes, so it loads in
// parallel off the critical path and the edge can cache it.
const pinnedRow = (p: db.PinnedSite) => ({
  id: p.id, handle: p.handle, name: p.name, avatar: p.avatar, url: p.url,
  thumbnail: p.thumbnail, notes: p.notes,
});
// A compact identity for the widget's facepile rows ("Followed by …" + mutuals).
const faceJson = (m: db.Identity) => ({ id: m.id, name: m.name, handle: m.handle, avatar: m.avatar, url: m.url });
// Resolve the signed-in member from either credential. The widget (embedded
// cross-site, where cookies are blocked) sends a Bearer token; signmysite.com itself
// sends the first-party cookie. We try the Bearer token first, but FALL BACK to
// the cookie when it yields nothing — so a stale token left in a host site's
// localStorage (e.g. after logging out elsewhere) can never shadow a valid
// signmysite.com session. Sessions are token-keyed in the DB, same either way.
async function viewerAuth(c: Context): Promise<{ member?: db.Member; via: "bearer" | "cookie" | null }> {
  const auth = c.req.header("authorization");
  const bearer = auth && auth.slice(0, 7).toLowerCase() === "bearer " ? auth.slice(7).trim() : "";
  if (bearer) {
    const m = await db.getSessionMember(bearer);
    if (m) return { member: m, via: "bearer" };
  }
  const m = await db.getSessionMember(getCookie(c, COOKIE));
  return { member: m, via: m ? "cookie" : null };
}
const viewerOf = async (c: Context): Promise<db.Member | undefined> => (await viewerAuth(c)).member;
const body = (c: Context) => c.req.json().catch(() => ({} as any));

// The /admin dashboard is gated to a small allowlist of operator emails, set in
// ADMIN_EMAILS (comma-separated) on the host — falls back to the founders so it is
// never wide-open and still works in local dev. A viewer is an admin only if they are
// signed in AND their account email is on the list.
const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS || "justin@getden.io,justinkhlee27@gmail.com")
    .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)
);
const isAdmin = (m?: db.Member): boolean => !!m?.email && ADMIN_EMAILS.has(m.email.toLowerCase());

// Fire-and-forget: email a site's owner that someone followed/saved/reacted/noted.
// Best-effort by design — runs after the response, swallows every error, and skips
// self-actions + owners with no email on file (mail.notifyActivity re-checks email).
function notifyOwner(kind: ActivityKind, ownerId: string, actor: db.Member, body?: string): void {
  if (actor.id === ownerId) return;
  (async () => {
    const owner = await db.getMember(ownerId);
    if (!owner?.email) return;
    await notifyActivity({
      owner,
      actor: { id: actor.id, name: actor.name, handle: actor.handle, avatar: actor.avatar, url: actor.url },
      kind,
      body,
    });
  })().catch(() => {});
}

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
  // SameSite=None; Secure (on https), exactly like the session cookie: when the
  // widget opens this in a popup over someone else's site, the cookie has to
  // survive a cross-site round trip (host site -> Google -> our callback). A Lax
  // cookie isn't sent on the redirect back from Google, so the callback saw no
  // state and failed with "bad state". None+Secure rides the whole trip.
  setCookie(c, "signmysite_ret", JSON.stringify({ state, ret, popup }), {
    httpOnly: true, path: "/", maxAge: 600,
    sameSite: SECURE ? "None" : "Lax", secure: SECURE,
  });

  if (!auth.GOOGLE_LIVE) {
    // Dev stub: no real Google — bounce straight to the callback with the state.
    return c.redirect(`/api/auth/google/callback?state=${state}&stub=1`);
  }
  return c.redirect(auth.googleAuthUrl(GOOGLE_REDIRECT, state));
});

app.get("/api/auth/google/callback", async (c) => {
  const stash = JSON.parse(getCookie(c, "signmysite_ret") || "{}");
  const ret = typeof stash.ret === "string" ? stash.ret : "/";
  const state = c.req.query("state") || "";
  if (!state || state !== stash.state) return c.text("bad state", 400);
  oauthStates.delete(state);
  deleteCookie(c, "signmysite_ret", { path: "/" });

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
  try { if (window.opener) window.opener.postMessage({ signmysite: "signed-in", token: ${JSON.stringify(token)} }, "*"); } catch (e) {}
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
  // Never pin a localhost/preview URL as the permanent site URL — it would point
  // the public profile at a dev origin and break the same-origin claim on prod.
  const url = b?.url && !isLocalUrl(String(b.url)) ? String(b.url) : null;
  const m = await db.createMember({ id, handle, name, email, url });
  return c.json({ id: m.id, handle: m.handle, url: m.url });
});

// Zero-fetch onboarding: the agent pastes a tag with a self-minted id and never
// calls us; the widget claims that id here on first page load. Idempotent — a
// known id just no-ops. The site stays unclaimed until someone signs in and
// links it (see /api/profile editing + the main site).
app.post("/api/sites/claim", async (c) => {
  const b = await body(c);
  const id = String(b?.id || "");
  if (!/^signmysite:[a-z0-9]{8,}$/.test(id)) return c.json({ error: "valid id required" }, 400);
  const existing = await db.getMember(id);
  if (existing) return c.json({ id: existing.id, handle: existing.handle, claimed: true });
  const handle = await uniqueHandle();
  const m = await db.createMember({
    id, handle,
    name: b?.name ? String(b.name).slice(0, 80) : "New blog",
    url: b?.url && !isLocalUrl(String(b.url)) ? String(b.url) : null,
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
  const patch = { handle, name: String(doc.name), url: doc.url || target, avatar: doc.avatar || null };
  if (await db.getMember(doc.id)) await db.updateMember(doc.id, patch);
  else await db.createMember({ id: doc.id, ...patch });

  let edges = 0;
  if (Array.isArray(doc.links)) {
    for (const l of doc.links) {
      if (l && typeof l.id === "string") { await db.setEdge(doc.id, l.id, l.rel || "follow"); edges++; }
    }
  }
  // Freshness: honor an explicit me.json `updated`, else mark edited now.
  const when = typeof doc.updated === "string" ? doc.updated : undefined;
  await db.markEdited(doc.id, when);
  // Capture a snapshot (thumbnail + content hash) in the background.
  refreshPreview(doc.id, doc.url || target, when).catch(() => {});
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

// People search (header typeahead): by name, @handle, or site URL. Open-ended — a thin
// wrapper over one relevance-ranked query; returns public member cards.
app.get("/api/search", async (c) => {
  const q = (c.req.query("q") || "").trim();
  if (!q) return c.json([]);
  return c.json((await db.searchMembers(q, 8)).map(publicMember));
});

// One member's public profile bundle, by handle — the in-app /u/<handle> view in the
// feed shell. Same data the server-rendered /@<handle> page gathers, as JSON for the SPA.
app.get("/api/u/:handle", async (c) => {
  const m = await db.getMemberByHandle(c.req.param("handle").toLowerCase());
  if (!m) return c.json({ error: "not found" }, 404);
  const viewer = await viewerOf(c);
  const [s, comments, pinned] = await Promise.all([
    db.stats(m.id, viewer?.id),
    db.listComments(m.id),
    db.listPinned(m.id),
  ]);
  return c.json({
    member: publicMember(m),
    stats: s,
    comments: shapeComments(comments, m.id, viewer?.id),
    pinned: pinned.map((p) => ({ ...publicMember(p), notes: p.notes })),
    isOwner: viewer?.id === m.id,
  });
});

app.post("/api/follow", async (c) => {
  const viewer = await viewerOf(c);
  if (!viewer) return c.json({ error: "sign in" }, 401);
  const id = String((await body(c))?.id || "");
  if (!id) return c.json({ error: "id required" }, 400);
  if (id === viewer.id) return c.json({ error: "cannot follow yourself" }, 400);
  let followed = false;
  if (await db.hasEdge(viewer.id, id)) await db.removeEdge(viewer.id, id); // unfollow drops the edge; the save stays in their library
  else { await db.follow(viewer.id, id); notifyOwner("follow", id, viewer); followed = true; } // a follow also saves the site; email only on a new follow (the save is implicit, no separate "save" email)
  const s = await db.stats(id, viewer.id);
  if (followed) maybeMilestone("followers", id, s.followers); // celebrate on the way up only
  return c.json(s);
});

app.post("/api/save", async (c) => {
  const viewer = await viewerOf(c);
  if (!viewer) return c.json({ error: "sign in" }, 401);
  const id = String((await body(c))?.id || "");
  if (!id) return c.json({ error: "id required" }, 400);
  if (await db.hasSave(viewer.id, id)) await db.removeSave(viewer.id, id);
  else { await db.setSave(viewer.id, id); notifyOwner("save", id, viewer); } // email only on a new save, not unsave
  return c.json(await db.stats(id, viewer.id));
});

// Toggle a public pin. Capped at db.PIN_LIMIT: pinning a 4th is rejected (409)
// so the showcase stays a deliberate, small set — the owner unpins one first.
app.post("/api/pin", async (c) => {
  const viewer = await viewerOf(c);
  if (!viewer) return c.json({ error: "sign in" }, 401);
  const id = String((await body(c))?.id || "");
  if (!id) return c.json({ error: "id required" }, 400);
  if (id === viewer.id) return c.json({ error: "cannot pin yourself" }, 400);
  if (await db.hasPin(viewer.id, id)) {
    await db.removePin(viewer.id, id);
  } else {
    if ((await db.countPins(viewer.id)) >= db.PIN_LIMIT)
      return c.json({ error: "pin limit", limit: db.PIN_LIMIT }, 409);
    await db.setPin(viewer.id, id);
  }
  return c.json(await db.stats(id, viewer.id));
});

app.get("/api/viewer", async (c) => {
  const viewer = await viewerOf(c);
  // onboarded + verified ride along only for the signed-in viewer (the SPA gates
  // the signup wizard / verify prompts on them); both are left off public profiles.
  return c.json(viewer ? viewerJson(viewer) : null);
});

// Lets the same-origin auth popup read its own session token so it can hand it
// to the widget via postMessage. Needed for magic link: the email link opens a
// fresh tab with no window.opener, so it can't deliver the token itself — the
// original popup polls this instead. (Google delivers in-popup, so it doesn't.)
app.get("/api/auth/session-token", async (c) => {
  const t = getCookie(c, COOKIE);
  const m = t ? await db.getSessionMember(t) : undefined;
  return c.json({ token: m ? t : null });
});

// ---- profile editing -----------------------------------------------------
app.patch("/api/profile", async (c) => {
  const viewer = await viewerOf(c);
  if (!viewer) return c.json({ error: "sign in" }, 401);
  const b = await body(c);
  const patch: Partial<db.Member> = {};
  if (typeof b.name === "string" && b.name.trim()) patch.name = b.name.trim().slice(0, 80);
  if (typeof b.url === "string") {
    const url = b.url.trim() || null;
    patch.url = url;
    if (url !== viewer.url) patch.verified = false; // a new site must be re-verified
  }
  if (typeof b.avatar === "string") patch.avatar = b.avatar.trim().slice(0, 2048) || null;
  if (typeof b.handle === "string" && b.handle.trim()) {
    const h = b.handle.trim().toLowerCase();
    const owner = await db.getMemberByHandle(h);
    if (owner && owner.id !== viewer.id) return c.json({ error: "handle taken" }, 409);
    patch.handle = h;
  }
  if (Array.isArray(b.links)) patch.links = normalizeLinks(b.links);
  const updated = await db.updateMember(viewer.id, patch);
  return c.json(publicMember(updated!));
});

// ---- avatars (profile pictures) ------------------------------------------
// Upload a profile picture. The client crops + resizes to a small square and
// re-encodes via <canvas>, which also strips EXIF and neutralizes any SVG/script
// payload — so we receive plain raster bytes. We enforce type + size, store the
// bytes, and point members.avatar at /avatars/<id>?v=<hash>: a stable, cacheable
// URL whose hash changes on each upload, so the immutable cache busts itself.
app.post("/api/avatar", async (c) => {
  const viewer = await viewerOf(c);
  if (!viewer) return c.json({ error: "sign in" }, 401);
  const mime = (c.req.header("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!AVATAR_TYPES.has(mime)) return c.json({ error: "use a PNG, JPEG, or WebP image" }, 415);
  if (Number(c.req.header("content-length") || 0) > AVATAR_MAX_BYTES) return c.json({ error: "image too large" }, 413);
  const bytes = Buffer.from(await c.req.arrayBuffer());
  if (!bytes.length) return c.json({ error: "empty upload" }, 400);
  if (bytes.length > AVATAR_MAX_BYTES) return c.json({ error: "image too large" }, 413);
  await db.setAvatar(viewer.id, bytes, mime);
  const version = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  const url = `${BASE}/avatars/${viewer.id.replace(/^signmysite:/, "")}?v=${version}`;
  const updated = await db.updateMember(viewer.id, { avatar: url });
  return c.json(publicMember(updated!));
});

// Serve an avatar's bytes. Long-lived + immutable: the ?v=<hash> in the URL
// changes whenever the image does, so caches never serve a stale picture. Public
// and cross-origin so the widget can render it embedded on any site.
app.get("/avatars/:id", async (c) => {
  const a = await db.getAvatar("signmysite:" + c.req.param("id"));
  if (!a) return c.notFound();
  c.header("content-type", a.mime);
  c.header("cache-control", "public, max-age=31536000, immutable");
  c.header("access-control-allow-origin", "*");
  return c.body(a.bytes);
});

// ---- signup wizard (username + optional site) ----------------------------
// Live username availability for the picker. Normalizes server-side so client
// and server always agree on what a handle becomes; your own handle reads as
// available to you.
app.get("/api/handle/check", async (c) => {
  const viewer = await viewerOf(c);
  const handle = normHandle(c.req.query("h") || "");
  const reason = handleProblem(handle);
  if (reason) return c.json({ handle, available: false, reason });
  const owner = await db.getMemberByHandle(handle);
  const available = !owner || owner.id === viewer?.id;
  return c.json({ handle, available, reason: available ? null : "Already taken." });
});

// Finish signup: claim a username (required) + optionally link a site, then mark
// the member onboarded. (The site is usually already set via /api/site/scrape;
// url here is a fallback for the no-scrape path.)
app.post("/api/onboard", async (c) => {
  const viewer = await viewerOf(c);
  if (!viewer) return c.json({ error: "sign in" }, 401);
  const b = await body(c);

  const handle = normHandle(String(b?.handle || ""));
  const problem = handleProblem(handle);
  if (problem) return c.json({ error: problem }, 400);
  const owner = await db.getMemberByHandle(handle);
  if (owner && owner.id !== viewer.id) return c.json({ error: "handle taken" }, 409);

  const patch: Partial<db.Member> = { handle, onboarded: true };
  const raw = String(b?.url || "").trim();
  if (raw) {
    const url = /^https?:\/\//i.test(raw) ? raw : "https://" + raw;
    try { new URL(url); if (!isLocalUrl(url) && url !== viewer.url) { patch.url = url; patch.verified = false; } } catch { /* skip junk */ }
  }
  if (Array.isArray(b?.links)) patch.links = normalizeLinks(b.links); // optional socials from the wizard
  const updated = await db.updateMember(viewer.id, patch);
  return c.json(viewerJson(updated!));
});

const normSiteUrl = (raw: string): string | null => {
  const t = (raw || "").trim();
  if (!t) return null;
  const url = /^https?:\/\//i.test(t) ? t : "https://" + t;
  try { new URL(url); } catch { return null; }
  return isLocalUrl(url) ? null : url;
};

// Social/profile links the member adds (Instagram, X, …). Stored as plain URL
// strings — presentation is derived from each host at render time. We normalize the
// scheme, drop anything that isn't a real public http(s) URL, de-dupe, and cap the
// count so the column stays small. This is the authority; the client just mirrors it.
const MAX_LINKS = 10;
const normalizeLink = (raw: string): string | null => {
  const t = (raw || "").trim();
  if (!t) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : "https://" + t;
  let u: URL;
  try { u = new URL(withScheme); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (!u.hostname.includes(".") || isLocalUrl(u.toString())) return null;
  const s = u.toString();
  return s.length <= 300 ? s : null;
};
const normalizeLinks = (input: unknown): string[] => {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const n = normalizeLink(raw);
    if (n && !out.includes(n)) out.push(n);
    if (out.length >= MAX_LINKS) break;
  }
  return out;
};

// Link a site and optimistically scrape it: capture a preview snapshot
// (thumbnail) and infer a profile picture (icon → favicon). Saves both and
// returns them so onboarding can show the result. Linking a new site resets
// verification — ownership must be re-proven.
app.post("/api/site/scrape", async (c) => {
  const viewer = await viewerOf(c);
  if (!viewer) return c.json({ error: "sign in" }, 401);
  const url = normSiteUrl(String((await body(c))?.url || ""));
  if (!url) return c.json({ error: "Enter a valid website address." }, 400);

  const patch: Partial<db.Member> = {};
  if (url !== viewer.url) { patch.url = url; patch.verified = false; }

  const p = await inspectSite(url); // one fetch → thumbnail + avatar + hash
  if (p) {
    await db.recordSiteContent(viewer.id, { hash: p.hash, thumbnail: p.thumbnail, title: p.title, excerpt: p.excerpt });
    if (p.avatar && !viewer.avatar) patch.avatar = p.avatar; // never clobber a real avatar
  }
  const updated = (await db.updateMember(viewer.id, patch)) || viewer;
  return c.json({
    host: new URL(url).host,
    reachable: !!p,
    thumbnail: updated.thumbnail ?? null,
    avatar: updated.avatar ?? null,
  });
});

// Prove the linked site is yours: fetch it and look for your own widget id.
// Found → verified; otherwise tell the client it's not there yet.
app.post("/api/verify", async (c) => {
  const viewer = await viewerOf(c);
  if (!viewer) return c.json({ error: "sign in" }, 401);
  if (!viewer.url) return c.json({ verified: false, reason: "no-site" }, 400);
  const found = await siteHasWidget(viewer.url, viewer.id.replace(/^signmysite:/, ""));
  if (!found) return c.json({ verified: false, reason: "not-found" });
  await db.updateMember(viewer.id, { verified: true });
  // Proven ownership: fold in any unclaimed placeholder that already represents this
  // site (e.g. the curated @pg), so the owner inherits its handle, followers, and
  // recommendation. The real account is the survivor, so their installed widget keeps working.
  const me = (await db.claimPlaceholderByUrl(viewer.id)) || (await db.getMember(viewer.id))!;
  return c.json({ verified: !!me.verified, reason: null, handle: me.handle });
});

// ---- views & analytics ---------------------------------------------------
// Body parser that also accepts a sendBeacon payload: the page-exit duration ping
// must use navigator.sendBeacon (it survives unload), which sends text/plain and
// can't set headers — so we parse the raw text as JSON rather than trusting the
// content-type the way c.req.json() does.
async function beaconBody(c: Context): Promise<any> {
  try { return JSON.parse(await c.req.text()); } catch { return {}; }
}
// Keep only the referrer's host (not the full URL) — enough for "came from X",
// small, and less to retain. Drops same-origin signmysite referrers as noise.
function refHost(ref: unknown): string | null {
  if (typeof ref !== "string" || !ref) return null;
  try {
    const h = new URL(ref).hostname.replace(/^www\./, "");
    return !h || ref.startsWith(BASE) ? null : h.slice(0, 120);
  } catch { return null; }
}

// One URL, two jobs — because the duration ping rides navigator.sendBeacon, which
// can't set the auth header, so it must be a header-free POST to a stable path:
//   • initial view  → { session, path?, ref? }   record the impression + WHO
//   • exit duration → { session, ms }             attach engaged time to that view
// Self-views (the owner opening their own site) are counted by neither — they'd
// just inflate your own numbers.
app.post("/api/profile/:id/view", async (c) => {
  const id = c.req.param("id");
  // The demo has no real member behind it (see demo.ts), so swallow its view + duration
  // beacons: nothing to attribute them to, and demo traffic shouldn't count as analytics.
  if (isDemo(id)) return c.json({ ok: true });
  const b = await beaconBody(c);
  const session = String(b?.session || "").slice(0, 64);
  if (!session) return c.json({ ok: false });

  // Duration ping: raise the engaged-time estimate on the existing view, nothing
  // else. Capped at 6h so a backgrounded tab can't report an absurd figure.
  if (typeof b?.ms === "number" && b.ms > 0) {
    await db.recordDuration(id, session, Math.min(b.ms, 6 * 3600 * 1000));
    return c.json({ ok: true });
  }

  // Initial view: goes through the authed path, so a signed-in signmysite visitor is
  // attributed by id (anonymous visitors stay anonymous, viewer NULL).
  const viewer = await viewerOf(c);
  if (viewer?.id === id) return c.json({ self: true }); // don't count self-views
  const views = await db.recordView({
    target: id,
    viewer: viewer?.id ?? null,
    session,
    path: typeof b?.path === "string" ? b.path.slice(0, 512) : null,
    referrer: refHost(b?.ref),
  });
  maybeMilestone("views", id, views);
  return c.json({ views });
});

// Relational analytics — owner-only, your own site. Headline counts, the real
// average engaged time, and the named signmysite members who've read you, each tagged
// with whether you already follow them: the "people with signmysite sites visited you —
// follow them back" discovery hook. Only ever returns the caller's own data.
app.get("/api/analytics", async (c) => {
  const viewer = await viewerOf(c);
  if (!viewer) return c.json({ error: "sign in" }, 401);
  const range = (["day", "week", "month", "all"] as const).find((r) => r === c.req.query("range")) ?? "all";
  return c.json(await db.analytics(viewer.id, range));
});

// The operator dashboard — whole-instance health at a glance (signup funnel, new
// users per week, graph size). Gated to ADMIN_EMAILS (see isAdmin): a signed-out
// visitor gets a sign-in link back here; a signed-in non-admin gets a plain 404, so
// the page's existence is never advertised to regular users.
app.get("/admin", async (c) => {
  const viewer = await viewerOf(c);
  if (!viewer) return c.html(adminSignIn());
  if (!isAdmin(viewer)) return c.notFound();
  return c.html(adminPage(await db.adminStats(), viewer.email!));
});

function adminSignIn(): string {
  return sitePage("Admin · signmysite", "", null, `
    <div class="narrow" style="text-align:center;padding:48px 0">
      <h1 style="font-size:24px;font-weight:600;color:var(--ink);margin:0 0 8px">Admin</h1>
      <p style="color:var(--muted);margin:0 0 24px">Sign in with an operator account to continue.</p>
      <a class="btn pink" href="/api/auth/google?return=/admin">Sign in with Google</a>
    </div>`);
}

// The dashboard itself. All inputs are server-computed numbers and ISO date strings,
// so the only untrusted value to escape is the signed-in admin's own email. Styling
// reuses the shared theme tokens (theme.css), like the notify page.
function adminPage(s: db.AdminStats, email: string): string {
  const n = (x: number) => x.toLocaleString("en-US");
  const pct = (x: number) => (s.users ? Math.round((x / s.users) * 100) : 0);
  const maxWeek = Math.max(1, ...s.perWeek.map((w) => w.count));
  const stage = (label: string, value: number, sub?: string) =>
    `<div class="astat"><div class="anum">${n(value)}</div>
       <div class="alabel">${label}</div>
       ${sub ? `<div class="asub">${sub}</div>` : ""}</div>`;
  const mini = (label: string, value: number) =>
    `<div class="amini"><div class="amininum">${n(value)}</div><div class="aminilabel">${label}</div></div>`;
  const bars = s.perWeek.map((w) =>
    `<div class="abar"><span class="abarwk">${w.week}</span>
       <span class="abartrack"><span class="abarfill" style="width:${Math.round((w.count / maxWeek) * 100)}%"></span></span>
       <span class="abarn">${w.count}</span></div>`).join("");

  // Recent-activity lists. who() prefers a @handle, falling back to the display name;
  // clip() trims a note to one tidy line. Everything here is user content, so escape.
  const who = (name: string, handle: string | null) =>
    handle ? "@" + escapeHtml(handle) : escapeHtml(name || "someone");
  const host = (url: string | null) => { try { return url ? new URL(url).host.replace(/^www\./, "") : ""; } catch { return ""; } };
  const clip = (str: string, max = 90) => { const t = (str || "").replace(/\s+/g, " ").trim(); return escapeHtml(t.length > max ? t.slice(0, max - 1) + "…" : t); };
  const signupRows = s.recentSignups.map((u) => {
    const meta = [u.handle ? "@" + escapeHtml(u.handle) : null, escapeHtml(host(u.url)) || null, relTime(u.created)].filter(Boolean).join(" · ");
    return `<div class="arow"><div class="amain">${escapeHtml(u.name || "Someone")}${u.verified ? ` <span class="achk" title="verified">✓</span>` : ""}</div><div class="ameta">${meta}</div></div>`;
  }).join("");
  const commentRows = s.recentComments.map((c) =>
    `<div class="arow"><div class="amain">${clip(c.body)}</div><div class="ameta">${who(c.authorName, c.authorHandle)} on ${who(c.targetName, c.targetHandle)} · ${relTime(c.created)}</div></div>`).join("");
  const followRows = s.recentFollows.map((f) =>
    `<div class="arow"><div class="amain">${who(f.followerName, f.followerHandle)} <span class="aarrow">→</span> ${who(f.targetName, f.targetHandle)}</div><div class="ameta">${relTime(f.created)}</div></div>`).join("");
  const col = (title: string, rows: string, empty: string) =>
    `<div class="acol"><h2 class="ah2">${title}</h2><div class="alist">${rows || `<p class="aempty">${empty}</p>`}</div></div>`;

  const inner = `<div class="awrap">
    <h1 class="atitle">Admin</h1>
    <p class="asubtitle">signmysite at a glance · ${escapeHtml(email)}</p>

    <div class="afunnel">
      ${stage("Total users", s.users)}
      ${stage("Added a site", s.withSite, pct(s.withSite) + "% of users")}
      ${stage("Verified site", s.verified, pct(s.verified) + "% of users")}
    </div>

    <div class="aminis">
      ${mini("New this week", s.new7d)}
      ${mini("Onboarded", s.onboarded)}
      ${mini("Follows", s.follows)}
      ${mini("Total views", s.views)}
      ${mini("Sites indexed", s.indexed)}
    </div>

    <h2 class="ah2">New users per week</h2>
    <div class="abars">${bars || `<p class="asubtitle">No sign-ups yet.</p>`}</div>

    <div class="aacts">
      ${col("Recent sign-ups", signupRows, "No sign-ups yet.")}
      ${col("Recent comments", commentRows, "No comments yet.")}
      ${col("Recent follows", followRows, "No follows yet.")}
    </div>
  </div>
  <style>
    .awrap{max-width:820px;margin:0 auto}
    .atitle{margin:18px 0 4px;font-size:26px;font-weight:600;color:var(--ink)}
    .asubtitle{margin:0 0 24px;color:var(--muted);font-size:14px}
    .afunnel{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:14px}
    .astat{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:22px 20px}
    .anum{font-size:40px;font-weight:700;color:var(--ink);line-height:1;letter-spacing:-.02em}
    .alabel{margin-top:10px;color:var(--text);font-size:14px;font-weight:500}
    .asub{margin-top:4px;color:var(--accent);font-size:13px;font-weight:500}
    .aminis{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:34px}
    .amini{background:var(--surface-3);border:1px solid var(--line);border-radius:var(--radius-sm);padding:14px 16px}
    .amininum{font-size:22px;font-weight:600;color:var(--ink)}
    .aminilabel{margin-top:3px;color:var(--muted);font-size:12px}
    .ah2{font-size:15px;font-weight:600;color:var(--ink);margin:0 0 14px}
    .abars{display:flex;flex-direction:column;gap:9px}
    .abar{display:flex;align-items:center;gap:12px;font-size:13px}
    .abarwk{width:92px;color:var(--muted);flex:0 0 auto;font-variant-numeric:tabular-nums}
    .abartrack{flex:1;height:10px;background:var(--surface-3);border-radius:999px;overflow:hidden}
    .abarfill{display:block;height:100%;background:var(--accent);border-radius:999px}
    .abarn{width:40px;text-align:right;color:var(--ink);font-weight:600;flex:0 0 auto;font-variant-numeric:tabular-nums}
    .aacts{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px 22px;margin-top:36px}
    .acol{min-width:0}
    .alist{display:flex;flex-direction:column}
    .arow{padding:9px 0;border-top:1px solid var(--line)}
    .arow:first-child{border-top:0}
    .amain{color:var(--ink);font-size:13px;font-weight:500;line-height:1.4}
    .ameta{margin-top:2px;color:var(--muted);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .achk{color:var(--accent);font-weight:700}
    .aarrow{color:var(--muted)}
    .aempty{color:var(--muted);font-size:13px;margin:8px 0 0}
    @media(max-width:620px){.afunnel{grid-template-columns:1fr}.aminis{grid-template-columns:repeat(2,1fr)}}
  </style>`;
  return sitePage("Admin · signmysite", "", null, inner);
}

// The home feed — one reverse-chron activity stream (see db.feed). Cursor-paginated
// by the `at` of the oldest item shown: pass it back as ?before= for the next page.
// The "since you've been gone" digest rides along on the first page only.
const feedItemJson = (r: db.FeedRow) => ({
  kind: r.kind, at: r.at, id: r.id,
  actor: r.actor ? faceJson(r.actor) : null,
  target: { ...faceJson(r.target), thumbnail: r.target.thumbnail },
  body: r.body, visibility: r.visibility,
});
app.get("/api/feed", async (c) => {
  const viewer = await viewerOf(c);
  if (!viewer) return c.json({ error: "sign in" }, 401);
  const before = c.req.query("before") || null;
  const limit = Math.min(Number(c.req.query("limit")) || 30, 60);
  const rows = await db.feed(viewer.id, { limit, before });
  const items = rows.map(feedItemJson);
  return c.json({
    items,
    cursor: items.length === limit ? items[items.length - 1].at : null,
    digest: before ? undefined : await db.feedDigest(viewer.id),
  });
});

// ---- email notification preferences --------------------------------------
// The kinds shown on the manage page (one toggle each). Adding a kind here + in
// the sender is all it takes — storage is the open-ended `notify` JSON.
const NOTIFY_KINDS: Array<[db.NotifyKind, string, string]> = [
  ["follow", "New followers", "When someone follows your site"],
  ["reaction", "Reactions", "When someone reacts to your site"],
  ["comment", "Comments", "When someone leaves a comment on your site"],
  ["message", "Direct messages", "When someone sends you a message"],
  ["save", "Saves", "When someone saves your site"],
  ["followedUpdate", "Sites you follow", "When a site you follow posts an update"],
  ["siteUpdated", "Your site updates", "When signmysite detects your own site changed"],
  ["milestone", "Milestones", "When you pass 100 views, 10 followers, and so on"],
];

// Manage notifications — reached from any email's footer link. Token-gated, so it
// works with NO sign-in (the recipient may not have a signmysite.com session) yet a
// stranger can't open it. See util.notifyToken.
app.get("/notify", async (c) => {
  const id = c.req.query("m") || "";
  const t = c.req.query("t") || "";
  if (!checkNotifyToken(id, t)) return c.html(page("Link expired", "<h1>Link expired</h1><p>This settings link is no longer valid. Use the link in a recent signmysite email.</p>"), 400);
  const m = await db.getMember(id);
  if (!m) return c.html(page("Not found", "<h1>Not found</h1>"), 404);
  return c.html(notifyPage(m, t));
});

app.post("/api/notify", async (c) => {
  const b = await body(c);
  const id = String(b?.m || "");
  const t = String(b?.t || "");
  if (!checkNotifyToken(id, t)) return c.json({ error: "invalid token" }, 401);
  const prefs: Record<string, boolean> = {};
  for (const [kind] of NOTIFY_KINDS) prefs[kind] = b?.prefs?.[kind] !== false;
  await db.setNotify(id, prefs);
  return c.json({ ok: true });
});

// ---- one-click unsubscribe (RFC 8058) ------------------------------------
// The target of the List-Unsubscribe header AND the footer "Unsubscribe" link.
// Token-gated like /notify (no sign-in needed, but a stranger can't mute you).
// `k` names the kind to drop; absent ⇒ everything. GET shows a confirm page so a
// mail scanner that pre-fetches links can't unsubscribe someone by accident; POST
// does the deed — the path Gmail's one-click button and the confirm button share.
const NOTIFY_LABEL: Record<string, string> = Object.fromEntries(NOTIFY_KINDS.map(([k, label]) => [k, label]));
const unsubLabel = (k: string): string => NOTIFY_LABEL[k] ? `"${NOTIFY_LABEL[k]}" emails` : "all email notifications";
const notifyHref = (id: string, t: string): string => `/notify?m=${encodeURIComponent(id)}&t=${encodeURIComponent(t)}`;
const unsubAction = (id: string, t: string, k: string): string =>
  `/unsubscribe?m=${encodeURIComponent(id)}&t=${encodeURIComponent(t)}${k ? `&k=${encodeURIComponent(k)}` : ""}`;
const UNSUB_BTN = `style="font:inherit;font-size:15px;font-weight:600;padding:10px 18px;border:0;border-radius:10px;background:#0b0b0c;color:#fff;cursor:pointer"`;

app.get("/unsubscribe", (c) => {
  const id = c.req.query("m") || "", t = c.req.query("t") || "", k = c.req.query("k") || "";
  if (!checkNotifyToken(id, t)) return c.html(page("Link expired", "<h1>Link expired</h1><p>This unsubscribe link is no longer valid. Use the link in a recent signmysite email.</p>"), 400);
  return c.html(page("Unsubscribe", `<h1>Unsubscribe</h1>
    <p>Stop sending ${escapeHtml(unsubLabel(k))} to this address?</p>
    <form method="post" action="${escapeHtml(unsubAction(id, t, k))}"><button type="submit" ${UNSUB_BTN}>Unsubscribe</button></form>
    <p style="margin-top:16px"><a href="${escapeHtml(notifyHref(id, t))}">Choose which emails instead</a></p>`));
});

app.post("/unsubscribe", async (c) => {
  const id = c.req.query("m") || "", t = c.req.query("t") || "", k = c.req.query("k") || "";
  if (!checkNotifyToken(id, t)) return c.html(page("Link expired", "<h1>Link expired</h1><p>This unsubscribe link is no longer valid.</p>"), 400);
  const kind = (db.ALL_NOTIFY_KINDS as string[]).includes(k) ? (k as db.NotifyKind) : undefined;
  await db.muteNotify(id, kind);
  return c.html(page("Unsubscribed", `<h1>You're unsubscribed</h1>
    <p>You won't get ${escapeHtml(unsubLabel(kind || ""))} anymore.</p>
    <p style="margin-top:16px"><a href="${escapeHtml(notifyHref(id, t))}">Manage all notifications</a></p>`));
});

// The manage page, server-rendered with the shared styling (theme.css + app.css).
function notifyPage(m: db.Member, t: string): string {
  const rows = NOTIFY_KINDS.map(([kind, label, desc]) =>
    `<label class="nrow">
       <span class="ninfo"><b>${escapeHtml(label)}</b><span>${escapeHtml(desc)}</span></span>
       <input type="checkbox" data-kind="${kind}"${db.wantsNotify(m, kind) ? " checked" : ""}>
     </label>`).join("");
  const inner = `<div class="narrow">
    <h1 class="ntitle">Email notifications</h1>
    <p class="nsub">for ${escapeHtml(m.name || "your signmysite profile")}${m.email ? ` · ${escapeHtml(m.email)}` : ""}</p>
    <div class="card nlist">${rows}</div>
    <div class="nactions"><button id="nsave" class="btn pink">Save preferences</button><span id="nstatus" class="nstatus"></span></div>
  </div>
  <style>
    .ntitle{margin:18px 0 4px;font-size:26px;font-weight:600;color:var(--ink)}
    .nsub{margin:0 0 22px;color:var(--muted);font-size:14px}
    .nlist{padding:6px 20px}
    .nrow{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:16px 0;border-top:1px solid var(--line);cursor:pointer}
    .nrow:first-child{border-top:0}
    .ninfo{display:flex;flex-direction:column;gap:3px}.ninfo b{color:var(--ink);font-weight:600;font-size:15px}.ninfo span{color:var(--muted);font-size:13px}
    .nrow input{width:20px;height:20px;accent-color:var(--accent);flex:0 0 auto;cursor:pointer}
    .nactions{display:flex;align-items:center;gap:14px;margin-top:20px}
    .nstatus{color:var(--muted);font-size:14px}
  </style>
  <script>
    var M=${JSON.stringify(m.id)},T=${JSON.stringify(t)};
    document.getElementById("nsave").addEventListener("click",function(){
      var prefs={};document.querySelectorAll("[data-kind]").forEach(function(el){prefs[el.getAttribute("data-kind")]=el.checked;});
      var s=document.getElementById("nstatus");s.textContent="Saving…";
      fetch("/api/notify",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({m:M,t:T,prefs:prefs})})
        .then(function(r){return r.json();}).then(function(j){s.textContent=j&&j.ok?"Saved.":(j&&j.error)||"Could not save.";})
        .catch(function(){s.textContent="Could not save.";});
    });
  </script>`;
  return sitePage("Notifications · signmysite", "Manage your signmysite email notifications.", null, inner);
}

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
  const when = typeof b?.at === "string" ? b.at : undefined;
  await db.markEdited(id, when);
  // Capture a snapshot in the background — don't make the deploy wait on it.
  refreshPreview(id, m.url, when).catch(() => {});
  return c.json({ ok: true });
});

// Inspect the site and, if its content actually changed, refresh the member's live
// preview + freshness clock (recordSiteContent). On a real, non-first change, quietly
// tell the owner we noticed. `when` carries an owner-asserted edit time (me.json
// `updated` / ping `at`).
async function refreshPreview(id: string, url: string | null, when?: string): Promise<void> {
  if (!url) return;
  const p = await inspectSite(url);
  if (!p) return;
  const change = await db.recordSiteContent(
    id, { hash: p.hash, thumbnail: p.thumbnail, title: p.title, excerpt: p.excerpt }, when
  );
  if (change && !change.isFirst) notifyUpdate(change.site).catch(() => {}); // owner + their followers
}

// Celebrate a round-number milestone exactly once. The view counter and follower
// count only ever rise by 1, so an exact-threshold match never skips one, and
// markNotified keeps it idempotent under races. Fire-and-forget, prefs-gated.
const MILESTONES: Record<"views" | "followers", number[]> = {
  views: [100, 500, 1000, 5000, 10000, 50000, 100000],
  followers: [1, 10, 25, 50, 100, 250, 500, 1000],
};
function maybeMilestone(metric: "views" | "followers", ownerId: string, count: number): void {
  if (!MILESTONES[metric].includes(count)) return;
  (async () => {
    const owner = await db.getMember(ownerId);
    if (!owner || !db.wantsNotify(owner, "milestone")) return;
    if (await db.markNotified(ownerId, `${metric}:${count}`)) await notifyMilestone(owner, metric, count);
  })().catch(() => {});
}

// ---- widget card ---------------------------------------------------------
// Everything the widget needs in ONE request: identity, stats, who's viewing
// (for owner mode), and notes. Fewer round-trips = faster on slow third-party
// pages, and the widget's loader collapses to a single fetch.
app.get("/api/profile/:id/card", async (c) => {
  // The public demo is a fixed fixture, not DB rows, so it looks identical on prod and
  // local with no seed (see demo.ts). Served for any visitor, signed in or not.
  if (isDemo(c.req.param("id"))) return c.json(demoCard());
  return cardPayload(c, c.req.param("id"));
});

async function cardPayload(c: Context, id: string) {
  let m = await db.getMember(id);
  if (!m) return c.json({ error: "not found" }, 404);
  const auth = await viewerAuth(c); // how the viewer authed — surfaced for the dev HUD
  let viewer = auth.member;
  const origin = c.req.header("origin");
  if (viewer && viewer.id !== m.id && isUnclaimed(m) && claimable(origin, m)) {
    m = (await db.claimUnclaimedMember(m.id, viewer.id)) || m;
    // First real (non-local) load is when we learn the site's permanent URL —
    // register/claim may have happened from localhost where we kept it blank.
    if (m && origin && !isLocalUrl(origin) && (!m.url || isLocalUrl(m.url))) {
      m = (await db.updateMember(m.id, { url: origin })) || m;
    }
    viewer = m;
  }
  // Passive verification, no polling: the widget carrying this id is loading from
  // the member's own site — exactly what /api/verify fetches the page to prove,
  // observed live instead. Only the owner controls that origin, so even an
  // anonymous visitor's load is valid proof. Flip verified once, the instant it runs.
  if (m.url && !m.verified && sameOrigin(origin, m.url)) {
    await db.updateMember(m.id, { verified: true });
    // The same claim as /api/verify, observed passively: the owner inherits any
    // placeholder for this site. The real account is the survivor, so m's id (and the
    // widget loading this very card) stays valid.
    m = (await db.claimPlaceholderByUrl(m.id)) || (await db.getMember(m.id)) || m;
    if (viewer && viewer.id === m.id) viewer = m;
  }
  // Social proof on someone else's card: who notable follows them, and which of
  // those the signed-in viewer also follows. Skipped on the owner's own card (they
  // get analytics instead). Both ride the single card request — one round-trip.
  const isOwnerView = !!viewer && viewer.id === m.id;
  const [s, comments, pinned, followers, mutuals] = await Promise.all([
    db.stats(id, viewer?.id),
    db.listComments(id),
    db.listPinned(m.id),
    isOwnerView ? Promise.resolve([] as db.Identity[]) : db.notableFollowers(m.id, 5),
    viewer && !isOwnerView ? db.mutualFollowers(m.id, viewer.id, 5) : Promise.resolve({ faces: [] as db.Identity[], total: 0 }),
  ]);
  // A signed-in viewer opening the card = they've "seen" this site now, so it
  // stops showing as new to them until the next edit.
  if (viewer && viewer.id !== id) db.recordVisit(viewer.id, id).catch(() => {});
  return c.json({
    profile: publicMember(m),
    stats: s,
    viewer: viewer ? { id: viewer.id, handle: viewer.handle, name: viewer.name } : null,
    auth: auth.via, // "bearer" | "cookie" | null — which credential the server used
    comments: shapeComments(comments, id, viewer?.id),
    pinned: pinned.map(pinnedRow),
    // "Followed by" facepile (notable followers; total = full follower count) and
    // the viewer's mutuals among them.
    followedBy: { faces: followers.map(faceJson), total: s.followers },
    mutuals: { faces: mutuals.faces.map(faceJson), total: mutuals.total },
    script: `${BASE}/w/${m.id.replace(/^signmysite:/, "")}.js`,
  });
}

function isUnclaimed(m: db.Member): boolean {
  return !m.email && !m.google_sub;
}

// When may a signed-in viewer adopt an unclaimed site? Knowing the (unguessable)
// id and embedding the widget is the ownership proof. On prod we still require
// the origin to match the stored URL so a stranger can't grab a site by URL
// alone; but when the site has no real URL yet, or either side is a local/preview
// origin, we allow it — that's the local-first path the docs steer agents to.
function claimable(origin: string | undefined, m: db.Member): boolean {
  return sameOrigin(origin, m.url) || !m.url || isLocalUrl(m.url) || (!!origin && isLocalUrl(origin));
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
      views: 0, thumbnail: null, lastEdited: null,
    },
    stats: { views: 0, followers: 0, following: 0, saved: 0, pinned: 0, viewerFollows: false, viewerSaved: false, viewerPinned: false },
    viewer: null,
    comments: [],
    pinned: [],
    followedBy: { faces: [], total: 0 },
    mutuals: { faces: [], total: 0 },
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
  const note = text.slice(0, 1000);
  // Basic anti-spam: cap how many comments one member can leave on a single site
  // per day. Generous enough for real back-and-forth (reactions post here too),
  // tight enough to stop a flood.
  const dayAgo = new Date(Date.now() - 864e5).toISOString();
  if ((await db.countCommentsBy(viewer.id, targetId, dayAgo)) >= COMMENTS_PER_SITE_PER_DAY) {
    return c.json({ error: "You've commented on this site a lot today. Try again tomorrow." }, 429);
  }
  await db.addComment({ id: "c_" + token(8), target_id: targetId, author_id: viewer.id, body: note, visibility });
  // Tell the owner. An emoji-only body is a reaction; anything else is a note.
  notifyOwner(isReaction(note) ? "reaction" : "comment", targetId, viewer, note);
  const rows = await db.listComments(targetId);
  return c.json(shapeComments(rows, targetId, viewer.id));
});

// Note: reactions are no longer a separate endpoint. An emoji reaction is just a
// public comment whose body is an emoji, posted through POST /comments so it's
// always attributed to a signed-in member — never anonymous. The widget posts it
// inline when signed in; otherwise the /reacted page posts it after sign-in.

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

// ---- direct messages (DMs) -----------------------------------------------
// A basic 1:1 chat. A "thread" is addressed by the OTHER member's id — there's no
// thread object to create, the first message makes it real. Edit + delete are
// sender-only; either participant can react. Bodies are capped; receipts/typing are
// deliberately omitted — keep it simple, leave room to grow.
const MESSAGE_MAX = 4000;

// A reaction as the client sees it: the emoji + who left it. The client groups these
// per-viewer (count + "I reacted"), so the wire shape stays a flat list.
const reactionJson = (r: db.MsgReaction) => ({ emoji: r.emoji, by: r.member_id });
// Shape a stored message for the client: a deleted body reads as null; `from`/`to`
// are member ids.
function messageJson(m: db.Message, reactions: db.MsgReaction[] = []) {
  return {
    id: m.id, from: m.sender_id, to: m.recipient_id,
    body: m.deleted ? null : m.body,
    created: m.created, edited: m.edited, deleted: m.deleted,
    reactions: reactions.map(reactionJson),
  };
}
const peerJson = (m: db.Member) => ({ id: m.id, handle: m.handle, name: m.name, avatar: m.avatar, url: m.url });

// The inbox: one row per conversation, newest activity first.
app.get("/api/threads", async (c) => {
  const viewer = await viewerOf(c);
  if (!viewer) return c.json({ error: "sign in" }, 401);
  const rows = await db.listConversations(viewer.id);
  return c.json(rows.map((r) => ({
    peer: { id: r.peer_id, handle: r.handle, name: r.name, avatar: r.avatar, url: r.url },
    lastBody: r.last_deleted ? null : r.last_body,
    lastAt: r.last_at,
    lastFromMe: r.last_sender === viewer.id,
    lastDeleted: r.last_deleted,
    unread: r.unread,
  })));
});

// One conversation with member :id — the peer's identity + the full thread. Opening
// it marks their messages read. Returns an empty thread (not 404) when none exists
// yet, so a "Message" deep-link from a profile lands on a ready, empty chat.
app.get("/api/threads/:id", async (c) => {
  const viewer = await viewerOf(c);
  if (!viewer) return c.json({ error: "sign in" }, 401);
  const peer = await db.getMember(c.req.param("id"));
  if (!peer) return c.json({ error: "not found" }, 404);
  await db.markThreadRead(viewer.id, peer.id);
  const msgs = await db.listThread(viewer.id, peer.id);
  return c.json({ peer: peerJson(peer), messages: msgs.map((m) => messageJson(m, m.reactions)) });
});

// Send a message to member :id. The first one to a person creates the conversation.
app.post("/api/threads/:id", async (c) => {
  const viewer = await viewerOf(c);
  if (!viewer) return c.json({ error: "sign in" }, 401);
  const recipientId = c.req.param("id");
  if (recipientId === viewer.id) return c.json({ error: "cannot message yourself" }, 400);
  const recipient = await db.getMember(recipientId);
  if (!recipient) return c.json({ error: "not found" }, 404);
  const text = String((await body(c))?.body || "").trim().slice(0, MESSAGE_MAX);
  if (!text) return c.json({ error: "empty message" }, 400);
  // Email the recipient only on the first unread in the thread, so a burst of
  // messages is one notification rather than one per line. Best-effort.
  const firstUnread = (await db.unreadFrom(recipientId, viewer.id)) === 0;
  const m = await db.sendMessage({ id: "msg_" + token(8), sender_id: viewer.id, recipient_id: recipientId, body: text });
  if (firstUnread) {
    notifyMessage(recipient, { id: viewer.id, name: viewer.name, handle: viewer.handle, avatar: viewer.avatar, url: viewer.url }, text)
      .catch(() => {});
  }
  return c.json(messageJson(m));
});

// Edit a message — sender only, never a deleted one. Re-sends the reactions so the
// client can replace the message wholesale.
app.patch("/api/messages/:id", async (c) => {
  const viewer = await viewerOf(c);
  if (!viewer) return c.json({ error: "sign in" }, 401);
  const m = await db.getMessage(c.req.param("id"));
  if (!m || m.deleted) return c.json({ error: "not found" }, 404);
  if (m.sender_id !== viewer.id) return c.json({ error: "not yours" }, 403);
  const text = String((await body(c))?.body || "").trim().slice(0, MESSAGE_MAX);
  if (!text) return c.json({ error: "empty message" }, 400);
  const updated = await db.editMessage(m.id, text);
  return c.json(messageJson(updated!, await db.listReactions(m.id)));
});

// Delete a message — sender only. Soft, so the thread keeps its shape ("deleted").
app.delete("/api/messages/:id", async (c) => {
  const viewer = await viewerOf(c);
  if (!viewer) return c.json({ error: "sign in" }, 401);
  const m = await db.getMessage(c.req.param("id"));
  if (!m) return c.json({ error: "not found" }, 404);
  if (m.sender_id !== viewer.id) return c.json({ error: "not yours" }, 403);
  const updated = await db.deleteMessage(m.id);
  return c.json(messageJson(updated!));
});

// React to a message with an emoji (toggle). Either participant may react. Returns
// the message's full reaction set after the change.
app.post("/api/messages/:id/react", async (c) => {
  const viewer = await viewerOf(c);
  if (!viewer) return c.json({ error: "sign in" }, 401);
  const m = await db.getMessage(c.req.param("id"));
  if (!m || m.deleted) return c.json({ error: "not found" }, 404);
  if (viewer.id !== m.sender_id && viewer.id !== m.recipient_id) return c.json({ error: "not in this thread" }, 403);
  const emoji = String((await body(c))?.emoji || "").trim().slice(0, 16);
  if (!emoji) return c.json({ error: "emoji required" }, 400);
  const reactions = await db.toggleMessageReaction(m.id, viewer.id, emoji);
  return c.json(reactions.map(reactionJson));
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

// The members who follow you (+ whether you follow back, + when they followed) —
// backs the home's "Follow back" rail.
app.get("/api/followers", async (c) => {
  const viewer = await viewerOf(c);
  if (!viewer) return c.json({ error: "sign in" }, 401);
  return c.json((await db.followers(viewer.id)).map((f) => ({
    ...faceJson(f), followedAt: f.followedAt, viewerFollows: f.viewerFollows,
  })));
});

// A member's public pin showcase (max 3), each with the notes they left on it.
// Public so any profile/widget can render it; defaults to the viewer's own.
app.get("/api/pinned", async (c) => {
  const viewer = await viewerOf(c);
  const who = c.req.query("id") || viewer?.id;
  if (!who) return c.json({ error: "sign in" }, 401);
  return c.json((await db.listPinned(who)).map((p) => ({ ...publicMember(p), notes: p.notes })));
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

// ---- cohorts ("crews": closed groups) ------------------------------------
// The unit of onboarding for a whole friend group at once. A crew is closed (only
// members see the roster) and self-wiring: joining mutually follows everyone in,
// so a newcomer's feed is alive immediately. The shareable surface is the invite
// link, GET /join/<code> (rendered further below).
const cohortJson = (o: { id: string; name: string; code: string; role: string; memberCount: number; faces: db.Identity[] }) => ({
  id: o.id, name: o.name, code: o.code, role: o.role,
  memberCount: o.memberCount, joinUrl: `${BASE}/join/${o.code}`,
  faces: o.faces.map(faceJson),
});
// One crew's full detail (roster + the viewer's role), shared by GET :id and join.
function cohortDetail(cohort: db.Cohort, members: db.CohortMember[], viewerId: string) {
  return {
    id: cohort.id, name: cohort.name, code: cohort.code,
    joinUrl: `${BASE}/join/${cohort.code}`,
    role: members.find((m) => m.id === viewerId)?.role || "member",
    members: members.map((m) => ({ ...faceJson(m), role: m.role })),
  };
}
async function uniqueInviteCode(): Promise<string> {
  for (let i = 0; i < 6; i++) {
    const code = newInviteCode();
    if (!(await db.getCohortByCode(code))) return code;
  }
  return newInviteCode(10); // a longer tail in the (vanishing) event of repeated collisions
}

// Create a crew. The creator becomes its owner + first member.
app.post("/api/cohorts", async (c) => {
  const viewer = await viewerOf(c);
  if (!viewer) return c.json({ error: "sign in" }, 401);
  const name = String((await body(c))?.name || "").trim().slice(0, db.COHORT_NAME_MAX);
  if (!name) return c.json({ error: "name required" }, 400);
  const cohort = await db.createCohort({ id: newCohortId(), name, code: await uniqueInviteCode(), ownerId: viewer.id });
  return c.json(cohortJson({ ...cohort, role: "owner", memberCount: 1, faces: [viewer] }));
});

// The crews the signed-in member is in.
app.get("/api/cohorts", async (c) => {
  const viewer = await viewerOf(c);
  if (!viewer) return c.json({ error: "sign in" }, 401);
  return c.json((await db.listCohortsForMember(viewer.id)).map(cohortJson));
});

// One crew's roster — members only (the group is closed).
app.get("/api/cohorts/:id", async (c) => {
  const viewer = await viewerOf(c);
  if (!viewer) return c.json({ error: "sign in" }, 401);
  const id = c.req.param("id");
  const cohort = await db.getCohort(id);
  if (!cohort) return c.json({ error: "not found" }, 404);
  if (!(await db.isCohortMember(id, viewer.id))) return c.json({ error: "not a member" }, 403);
  return c.json(cohortDetail(cohort, await db.listCohortMembers(id), viewer.id));
});

// Join a crew by invite code. Idempotent; a real (new) join mutually follows
// everyone already in. Rejects only an unknown code or a full crew.
app.post("/api/cohorts/join", async (c) => {
  const viewer = await viewerOf(c);
  if (!viewer) return c.json({ error: "sign in" }, 401);
  const code = String((await body(c))?.code || "").trim().toLowerCase();
  if (!code) return c.json({ error: "code required" }, 400);
  const cohort = await db.getCohortByCode(code);
  if (!cohort) return c.json({ error: "invite not found" }, 404);

  const already = await db.isCohortMember(cohort.id, viewer.id);
  if (!already) {
    if ((await db.countCohortMembers(cohort.id)) >= db.COHORT_MAX)
      return c.json({ error: "cohort full", limit: db.COHORT_MAX }, 409);
    await db.addCohortMember(cohort.id, viewer.id, "member");
    await db.wireCohortFollows(cohort.id, viewer.id); // the cohort contract: mutual follows
  }
  const members = await db.listCohortMembers(cohort.id);
  return c.json({ ...cohortDetail(cohort, members, viewer.id), joined: !already });
});

// Leave a crew (membership only — your follows stay). Owner-leave reassigns
// ownership to the next member; an empty crew is removed. Idempotent.
app.post("/api/cohorts/:id/leave", async (c) => {
  const viewer = await viewerOf(c);
  if (!viewer) return c.json({ error: "sign in" }, 401);
  await db.leaveCohort(c.req.param("id"), viewer.id);
  return c.json({ ok: true });
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

// The widget opens this in a popup over someone else's site, so it's server
// rendered (not the SPA). It links the same stylesheets as the app and reuses the
// /#/auth markup (.auth-form + .signin) verbatim, so the popup is the focused
// sign-in card with no second look to maintain.
app.get("/auth", (c) => {
  const ret = c.req.query("return") || "/";
  const popup = c.req.query("popup") === "1";
  const gHref = `/api/auth/google?return=${encodeURIComponent(ret)}${popup ? "&popup=1" : ""}`;
  const stub = auth.GOOGLE_LIVE ? "" : " (dev stub)";
  return c.html(`<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Join signmysite</title>
<link rel="stylesheet" href="/theme.css">
<link rel="stylesheet" href="/site/app.css">
<style>
  body { min-height: 100dvh; display: flex; align-items: center; justify-content: center; padding: 28px 22px; box-sizing: border-box; background: var(--surface); }
  .auth-form { max-width: 360px; }
  .auth-title { font-size: 28px; }
</style>
</head><body>
<div class="auth-form">
  <h1 class="auth-title">Join signmysite</h1>
  <p class="auth-sub">Sign in to follow, comment, and claim your own page.</p>
  <div class="signin">
    <a class="google" href="${gHref}">
      <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.9 2.4 30.3 0 24 0 14.6 0 6.4 5.4 2.5 13.3l7.9 6.1C12.3 13.2 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.1 5.3-4.6 7l7.1 5.5c4.2-3.9 6.6-9.6 6.6-16.5z"/><path fill="#FBBC05" d="M10.4 28.6c-.5-1.5-.8-3-.8-4.6s.3-3.1.8-4.6l-7.9-6.1C.9 16.5 0 20.1 0 24s.9 7.5 2.5 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.3 0 11.6-2.1 15.5-5.6l-7.1-5.5c-2 1.4-4.6 2.2-8.4 2.2-6.3 0-11.7-3.7-13.6-9.4l-7.9 6.1C6.4 42.6 14.6 48 24 48z"/></svg>
      Continue with Google${stub}
    </a>
    <div class="signin-or"><span>or</span></div>
    <form class="signin-email" id="f">
      <input id="e" type="email" placeholder="you@example.com" aria-label="Email address" autocomplete="email" required />
      <button class="btn pink" type="submit">Email me a sign-in link</button>
    </form>
    <div class="signin-sent" id="out" hidden></div>
  </div>
  <p class="auth-fine">We'll email you a link, no password needed.</p>
</div>
<script>
  var ret = ${JSON.stringify(ret)}, popup = ${popup ? "true" : "false"};
  var form = document.getElementById("f"), out = document.getElementById("out");
  function say(html) { out.innerHTML = html; out.hidden = false; }
  form.addEventListener("submit", async function (ev) {
    ev.preventDefault();
    var btn = form.querySelector("button");
    btn.disabled = true;
    var r = await fetch("/api/auth/magic-link", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: document.getElementById("e").value, return: ret, popup: popup })
    });
    var j = await r.json();
    if (j.dev_link) { say('Dev mode. <a href="' + j.dev_link + '">Continue &rarr;</a>'); if (popup) pollForSession(); }
    else if (j.ok) { form.hidden = true; say("<b>Check your email.</b> Keep this window open."); if (popup) pollForSession(); }
    else { btn.disabled = false; say(j.error || "Something went wrong, try again."); }
  });
  // The magic link lands in a separate tab that can't reach the widget, so poll
  // here for the session it creates, then hand the token to the opener.
  function pollForSession() {
    var tries = 0;
    var timer = setInterval(async function () {
      if (++tries > 150) return clearInterval(timer); // ~5 min, then give up
      try {
        var r = await fetch("/api/auth/session-token", { credentials: "include" });
        var j = await r.json();
        if (j && j.token) {
          clearInterval(timer);
          try { if (window.opener) window.opener.postMessage({ signmysite: "signed-in", token: j.token }, "*"); } catch (e) {}
          say("<b>Signed in.</b> You can close this window.");
          setTimeout(function () { try { window.close(); } catch (e) {} }, 500);
        }
      } catch (e) {}
    }, 2000);
  }
</script>
</body></html>`);
});

// ---- join a crew (the shareable invite link) -----------------------------
// Server-rendered so the link unfurls when shared in a chat and works without the
// SPA. Shows who's already in (the incentive), then funnels to sign-in + a
// one-tap join. Registered before the SPA/static catch-alls (in index.ts).
app.get("/join/:code", async (c) => {
  const code = c.req.param("code").toLowerCase();
  const preview = await db.cohortPreview(code);
  if (!preview) {
    return c.html(sitePage("Invite not found · signmysite", "This invite link isn’t valid.", null,
      `<div class="hero"><h1>This invite isn’t valid.</h1>
       <p>The link may be mistyped, or the crew may have closed. Ask a friend for a fresh link.</p>
       <a class="btn primary" href="/">Go to signmysite</a></div>`), 404);
  }
  const { cohort, memberCount, faces } = preview;
  const viewer = await viewerOf(c);
  const here = `${BASE}/join/${cohort.code}`;
  const isMember = !!viewer && (await db.isCohortMember(cohort.id, viewer.id));
  const desc = `Join ${cohort.name} on signmysite — ${memberCount} ${memberCount === 1 ? "site" : "sites"} in this crew.`;
  return c.html(sitePage(
    `Join ${cohort.name} · signmysite`, escapeHtml(desc), null,
    renderJoin({ cohort, memberCount, faces, viewer, isMember }),
    siteHeader(viewer, here),
  ));
});

// A row of overlapping avatars (the crew) — the "your friends are here" proof.
function joinFacepile(faces: db.Identity[], total: number): string {
  if (!faces.length) return "";
  const list = faces.slice(0, 6).map((f) => f.avatar
    ? `<span class="jface" style="background-image:url(${escapeHtml(JSON.stringify(f.avatar))})"></span>`
    : `<span class="jface jface-i">${escapeHtml((f.name || f.handle || "?").charAt(0).toUpperCase())}</span>`
  ).join("");
  const more = total > faces.length ? `<span class="jface jface-more">+${total - faces.length}</span>` : "";
  return `<div class="jfaces">${list}${more}</div>`;
}

function renderJoin(o: {
  cohort: db.Cohort; memberCount: number; faces: db.Identity[]; viewer?: db.Member; isMember: boolean;
}): string {
  const { cohort, memberCount, faces, viewer, isMember } = o;
  const here = `${BASE}/join/${cohort.code}`;
  const count = `${memberCount} ${memberCount === 1 ? "site" : "sites"} in this crew`;
  let cta: string;
  if (!viewer) {
    // Sign-in IS sign-up here; on return the page shows the one-tap Join.
    cta = `<a class="btn primary jcta" href="/auth?return=${encodeURIComponent(here)}">Sign in to join</a>
      <p class="jfine">Joining follows everyone in the crew, and they’ll follow you. No passwords, no keys.</p>`;
  } else if (isMember) {
    cta = `<div class="jdone">You’re already in this crew.</div>
      <a class="btn primary jcta" href="/">Go to your crew</a>`;
  } else {
    cta = `<button id="jbtn" class="btn primary jcta" type="button">Join ${escapeHtml(cohort.name)}</button>
      <p class="jfine">Joining follows everyone in the crew, and they’ll follow you.</p>
      <div id="jerr" class="jerr" hidden></div>`;
  }
  return `<div class="join"><div class="join-card">
      <div class="jbadge">Crew invite</div>
      <h1 class="jname">${escapeHtml(cohort.name)}</h1>
      ${joinFacepile(faces, memberCount)}
      <div class="jcount">${escapeHtml(count)}</div>
      ${cta}
    </div></div>
    ${viewer && !isMember ? `<script>${joinScript(cohort.code)}</script>` : ""}`;
}

// One-tap join for a signed-in visitor: POST the code, then land in the app where
// their new crew (and freshly populated feed) is waiting.
function joinScript(code: string): string {
  return `(function(){
  var b=document.getElementById('jbtn'),e=document.getElementById('jerr');
  if(!b)return;
  var label=b.textContent;
  b.addEventListener('click',function(){
    b.disabled=true;b.textContent='Joining…';if(e){e.hidden=true;}
    fetch('/api/cohorts/join',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({code:${JSON.stringify(code)}})})
      .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});})
      .then(function(res){
        if(res.ok){location.href='/';return;}
        b.disabled=false;b.textContent=label;
        if(e){e.hidden=false;e.textContent=(res.j&&res.j.error==='cohort full')?'This crew is full.':'Could not join. Try again.';}
      })
      .catch(function(){b.disabled=false;b.textContent=label;if(e){e.hidden=false;e.textContent='Could not join. Try again.';}});
  });
})();`;
}

// ---- public profile page (signmysite.com/@handle) ------------------------------
// Server-rendered so it's shareable + crawlable (link previews, instant load).
// Reuses site/app.css — no new styles. The owner (signed in, on their own
// profile) gets Edit profile + their widget; everyone else gets Follow/Save +
// pinned blogs. See server/profile.ts for the components.
app.get("/:at{@.+}", async (c) => {
  const handle = c.req.param("at").slice(1).toLowerCase();
  const m = await db.getMemberByHandle(handle);
  if (!m) return c.html(notFoundPage(handle), 404);

  const viewer = await viewerOf(c);
  const isOwner = viewer?.id === m.id;

  const [s, comments, pinned] = await Promise.all([
    db.stats(m.id, viewer?.id),
    db.listComments(m.id),
    db.listPinned(m.id),
  ]);

  const inner = renderProfileInner({ m, s, pinned, comments, isOwner });
  const desc = `${m.name} on signmysite`;
  return c.html(sitePage(`${m.name} (@${m.handle}) · signmysite`, escapeHtml(desc), m.avatar, inner, profileChrome(!!viewer, m.handle ?? "")));
});

// Clean, minimal chrome for the public profile: just the wordmark + a single CTA — no
// app nav bar. A logged-out visitor lands on the profile itself with one way to get
// their own; a signed-in visitor gets a jump into the in-app shell (/u/<handle>).
function profileChrome(signedIn: boolean, handle: string): string {
  const cta = signedIn
    ? `<a class="btn sm" href="/#/u/${escapeHtml(handle)}">Open in app</a>`
    : `<a class="btn sm primary" href="/">Add my site</a>`;
  return `<header class="pbar"><a class="brand" href="/">signmysite</a>${cta}</header>`;
}

function notFoundPage(handle: string): string {
  return sitePage("Not on signmysite", "", null, `
    <div class="hero"><h1>@${escapeHtml(handle)} isn't on signmysite yet.</h1>
    <p>signmysite links personal websites into one social graph.</p>
    <a class="btn primary" href="/">Add my site</a></div>`);
}

// A page that wears the main site's chrome + stylesheet (so profiles match the
// app exactly with no duplicated CSS), plus Open Graph tags for link previews.
function sitePage(title: string, desc: string, image: string | null, inner: string, header?: string): string {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${desc}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${desc}">
<meta property="og:type" content="profile">
${image ? `<meta property="og:image" content="${escapeHtml(image)}">` : ""}
<meta name="twitter:card" content="summary">
<link rel="stylesheet" href="/theme.css">
<link rel="stylesheet" href="/site/app.css">
</head><body>
${header || `<header class="top"><a class="brand" href="/">signmysite</a><nav><a class="btn sm" href="/">Home</a></nav></header>`}
<main class="sr-main">${inner}</main>
<footer class="foot"><span>signmysite is an open protocol.</span><a href="/skill.md">For agents</a><a href="/widget/demo.html">Widget demo</a></footer>
</body></html>`;
}

function page(title: string, inner: string): string {
  return `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:380px;margin:80px auto;padding:0 24px;line-height:1.5;color:#0b0b0c}
  h1{font-size:24px;margin:0 0 8px}
  .sub{color:#5f6368;font-size:14px;margin:0 0 22px}
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
