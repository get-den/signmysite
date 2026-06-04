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
 *   POST /api/profile/:id/view   log a view (who/where/referrer), or attach exit duration
 *   GET  /api/analytics          owner-only: counts, avg engaged time, named Den visitors
 *   GET  /api/profile/:id/history    the site's version timeline (snapshots)
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
import { createHash } from "node:crypto";
import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import * as db from "./db.ts";
import { newId, newHandle, token, escapeHtml, normHandle, handleProblem, isReaction, checkNotifyToken } from "./util.ts";
import { inspectSite, siteHasWidget } from "./preview.ts";
import { sendMagicLink, MAIL_LIVE, notifyUpdate, notifyActivity, notifyMilestone, type ActivityKind } from "./mail.ts";
import * as auth from "./auth.ts";
import { renderProfileInner, siteHeader } from "./profile.ts";

export const PORT = Number(process.env.PORT || 8787);
export const BASE = (process.env.DEN_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const SECURE = BASE.startsWith("https://");
const COOKIE = "den_session";
const HAS_MAILER = MAIL_LIVE; // true when RESEND_API_KEY is set (see mail.ts)
const oauthStates = new Set<string>();               // CSRF state for the OAuth dance
// Uploaded avatars. The client crops + re-encodes to a small square before upload,
// so this ceiling is an abuse guard, not the expected size (~15KB WebP in practice).
const AVATAR_TYPES = new Set(["image/webp", "image/png", "image/jpeg"]);
const AVATAR_MAX_BYTES = 256 * 1024;

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
  id: m.id, handle: m.handle, name: m.name, url: m.url, avatar: m.avatar,
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
// bubble). Where it links — own URL if any, else the Den profile. The thumbnail
// is a short cacheable URL (og:image), never inline bytes, so it loads in
// parallel off the critical path and the edge can cache it.
const pinnedRow = (p: db.PinnedSite) => ({
  id: p.id, handle: p.handle, name: p.name, avatar: p.avatar, url: p.url,
  thumbnail: p.thumbnail, notes: p.notes,
});
// A compact identity for the widget's facepile rows ("Followed by …" + mutuals).
const faceJson = (m: db.Identity) => ({ id: m.id, name: m.name, handle: m.handle, avatar: m.avatar, url: m.url });
// Resolve the signed-in member from either credential. The widget (embedded
// cross-site, where cookies are blocked) sends a Bearer token; den.com itself
// sends the first-party cookie. We try the Bearer token first, but FALL BACK to
// the cookie when it yields nothing — so a stale token left in a host site's
// localStorage (e.g. after logging out elsewhere) can never shadow a valid
// den.com session. Sessions are token-keyed in the DB, same either way.
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
  if (!/^den:[a-z0-9]{8,}$/.test(id)) return c.json({ error: "valid id required" }, 400);
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

app.post("/api/follow", async (c) => {
  const viewer = await viewerOf(c);
  if (!viewer) return c.json({ error: "sign in" }, 401);
  const id = String((await body(c))?.id || "");
  if (!id) return c.json({ error: "id required" }, 400);
  if (id === viewer.id) return c.json({ error: "cannot follow yourself" }, 400);
  let followed = false;
  if (await db.hasEdge(viewer.id, id)) await db.removeEdge(viewer.id, id);
  else { await db.setEdge(viewer.id, id, "follow"); notifyOwner("follow", id, viewer); followed = true; } // email only on a new follow, not unfollow
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
  const url = `${BASE}/avatars/${viewer.id.replace(/^den:/, "")}?v=${version}`;
  const updated = await db.updateMember(viewer.id, { avatar: url });
  return c.json(publicMember(updated!));
});

// Serve an avatar's bytes. Long-lived + immutable: the ?v=<hash> in the URL
// changes whenever the image does, so caches never serve a stale picture. Public
// and cross-origin so the widget can render it embedded on any site.
app.get("/avatars/:id", async (c) => {
  const a = await db.getAvatar("den:" + c.req.param("id"));
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
    await db.recordSnapshot(viewer.id, { hash: p.hash, thumbnail: p.thumbnail, title: p.title, excerpt: p.excerpt });
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
  const found = await siteHasWidget(viewer.url, viewer.id.replace(/^den:/, ""));
  const updated = found ? await db.updateMember(viewer.id, { verified: true }) : viewer;
  return c.json({ verified: !!updated!.verified, reason: found ? null : "not-found" });
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
// small, and less to retain. Drops same-origin Den referrers as noise.
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
  const b = await beaconBody(c);
  const session = String(b?.session || "").slice(0, 64);
  if (!session) return c.json({ ok: false });

  // Duration ping: raise the engaged-time estimate on the existing view, nothing
  // else. Capped at 6h so a backgrounded tab can't report an absurd figure.
  if (typeof b?.ms === "number" && b.ms > 0) {
    await db.recordDuration(id, session, Math.min(b.ms, 6 * 3600 * 1000));
    return c.json({ ok: true });
  }

  // Initial view: goes through the authed path, so a signed-in Den visitor is
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
// average engaged time, and the named Den members who've read you, each tagged
// with whether you already follow them: the "people with Den sites visited you —
// follow them back" discovery hook. Only ever returns the caller's own data.
app.get("/api/analytics", async (c) => {
  const viewer = await viewerOf(c);
  if (!viewer) return c.json({ error: "sign in" }, 401);
  return c.json(await db.analytics(viewer.id));
});

// ---- email notification preferences --------------------------------------
// The kinds shown on the manage page (one toggle each). Adding a kind here + in
// the sender is all it takes — storage is the open-ended `notify` JSON.
const NOTIFY_KINDS: Array<[db.NotifyKind, string, string]> = [
  ["follow", "New followers", "When someone follows your site"],
  ["reaction", "Reactions", "When someone reacts to your site"],
  ["comment", "Notes", "When someone leaves a note on your site"],
  ["save", "Saves", "When someone saves your site"],
  ["followedUpdate", "Sites you follow", "When a site you follow posts an update"],
  ["siteUpdated", "Your site updates", "When Den detects your own site changed"],
  ["milestone", "Milestones", "When you pass 100 views, 10 followers, and so on"],
];

// Manage notifications — reached from any email's footer link. Token-gated, so it
// works with NO sign-in (the recipient may not have a den.com session) yet a
// stranger can't open it. See util.notifyToken.
app.get("/notify", async (c) => {
  const id = c.req.query("m") || "";
  const t = c.req.query("t") || "";
  if (!checkNotifyToken(id, t)) return c.html(page("Link expired", "<h1>Link expired</h1><p>This settings link is no longer valid. Use the link in a recent Den email.</p>"), 400);
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

// The manage page, server-rendered with the shared styling (theme.css + app.css).
function notifyPage(m: db.Member, t: string): string {
  const rows = NOTIFY_KINDS.map(([kind, label, desc]) =>
    `<label class="nrow">
       <span class="ninfo"><b>${escapeHtml(label)}</b><span>${escapeHtml(desc)}</span></span>
       <input type="checkbox" data-kind="${kind}"${db.wantsNotify(m, kind) ? " checked" : ""}>
     </label>`).join("");
  const inner = `<div class="narrow">
    <h1 class="ntitle">Email notifications</h1>
    <p class="nsub">for ${escapeHtml(m.name || "your Den profile")}${m.email ? ` · ${escapeHtml(m.email)}` : ""}</p>
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
  return sitePage("Notifications · Den", "Manage your Den email notifications.", null, inner);
}

// The site's version history, newest first — the timeline behind the live
// thumbnail. Public + crawlable; the front-page preview is public anyway.
app.get("/api/profile/:id/history", async (c) => {
  const snaps = await db.listSnapshots(c.req.param("id"));
  return c.json(snaps.map((s) => ({
    id: s.id, thumbnail: s.thumbnail, title: s.title, excerpt: s.excerpt, captured: s.captured,
  })));
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
  const when = typeof b?.at === "string" ? b.at : undefined;
  await db.markEdited(id, when);
  // Capture a snapshot in the background — don't make the deploy wait on it.
  refreshPreview(id, m.url, when).catch(() => {});
  return c.json({ ok: true });
});

// Inspect the site and, if its content actually changed, append a new snapshot
// (capturing the thumbnail, title and excerpt for that version). On a real, non-
// first change, quietly tell the owner we noticed. `when` carries an owner-asserted
// edit time (me.json `updated` / ping `at`) so the snapshot is stamped with it.
async function refreshPreview(id: string, url: string | null, when?: string): Promise<void> {
  if (!url) return;
  const p = await inspectSite(url);
  if (!p) return;
  const change = await db.recordSnapshot(
    id, { hash: p.hash, thumbnail: p.thumbnail, title: p.title, excerpt: p.excerpt }, when
  );
  if (change && !change.isFirst) {
    const m = await db.getMember(id);
    if (m) notifyUpdate(m, change.snapshot).catch(() => {}); // owner + their followers
  }
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
    script: `${BASE}/w/${m.id.replace(/^den:/, "")}.js`,
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
  return c.html(page("Continue to Den", `
    <h1>Sign in or create your account</h1>
    <p class="sub">Den has no separate sign-up — continue with Google or email and your account is created if you're new.</p>
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
        if (j.dev_link) { out.innerHTML = '<p>Dev mode — <a href="' + j.dev_link + '">click to continue &rarr;</a></p>'; if (popup) pollForSession(out); }
        else if (j.ok) { out.innerHTML = "<p>Check your email for the link — keep this window open.</p>"; if (popup) pollForSession(out); }
        else out.innerHTML = "<p>" + (j.error || "Something went wrong, try again.") + "</p>";
      });
      // The magic link lands in a separate tab that can't reach the widget, so
      // poll here for the session it creates, then hand the token to the opener.
      function pollForSession(out) {
        var tries = 0;
        var timer = setInterval(async function () {
          if (++tries > 150) return clearInterval(timer); // ~5 min, then give up
          try {
            var r = await fetch("/api/auth/session-token", { credentials: "include" });
            var j = await r.json();
            if (j && j.token) {
              clearInterval(timer);
              try { if (window.opener) window.opener.postMessage({ den: "signed-in", token: j.token }, "*"); } catch (e) {}
              out.innerHTML = "<p>Signed in. You can close this window.</p>";
              setTimeout(function () { try { window.close(); } catch (e) {} }, 500);
            }
          } catch (e) {}
        }, 2000);
      }
    </script>`));
});

// ---- public profile page (den.com/@handle) ------------------------------
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

  const inner = renderProfileInner({ m, s, pinned, comments, isOwner, base: BASE });
  const desc = `${m.name} on Den`;
  return c.html(sitePage(`${m.name} (@${m.handle}) · Den`, escapeHtml(desc), m.avatar, inner, siteHeader(viewer, `${BASE}/@${m.handle}`, isOwner)));
});

function notFoundPage(handle: string): string {
  return sitePage("Not on Den", "", null, `
    <div class="hero"><h1>@${escapeHtml(handle)} isn't on Den yet.</h1>
    <p>Den links personal websites into one social graph.</p>
    <a class="btn primary" href="/">Get your own</a></div>`);
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
${header || `<header class="top"><a class="brand" href="/">den</a><nav><a class="btn sm" href="/">Home</a></nav></header>`}
<main>${inner}</main>
<footer class="foot"><span>Den is an open protocol.</span><a href="/skill.md">For agents</a><a href="/widget/demo.html">Widget demo</a></footer>
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
