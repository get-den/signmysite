/*
 * Data layer — the ONE place that talks to Postgres.
 *
 * Everything else depends only on the exported async functions, so the storage
 * engine stays swappable. Raw SQL, no ORM: minimal and transparent.
 */
import pg from "pg";
import { now, token } from "./util.ts";
import { CURATED } from "./curated.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS members (
  id          TEXT PRIMARY KEY,
  handle      TEXT UNIQUE,
  name        TEXT NOT NULL,
  email       TEXT UNIQUE,
  google_sub  TEXT UNIQUE,
  url         TEXT,
  avatar      TEXT,
  views       INTEGER NOT NULL DEFAULT 0,
  -- Freshness clock for the "new" badge: the latest of any owner ping, me.json
  -- 'updated', or a content change we detected. Kept on the member (not derived
  -- from snapshots) so an owner can assert "I changed something" even when our
  -- homepage hash didn't move (e.g. they edited a subpage).
  last_edited TEXT,
  -- The live site preview (og:image) + the last-seen normalized content hash for
  -- change detection. Kept right on the member — there is no snapshot/version table.
  thumbnail    TEXT,
  content_hash TEXT,
  -- Manual fame tier ranking a member in someone's "Followed by" facepile:
  -- 0 normal, 1 notable, 2 famous. ORDER BY prominence DESC sorts it directly.
  prominence   INTEGER NOT NULL DEFAULT 0,
  -- has the member finished the signup wizard? New sign-ups are inserted FALSE
  -- (see createMember); crawled/indexed members never sign in, so theirs is moot.
  onboarded   BOOLEAN NOT NULL DEFAULT FALSE,
  -- has the member proven they control members.url? Set true only after we fetch
  -- the site and find their own widget id in it; reset to false whenever the url
  -- changes. Guards against one account claiming another's site. Defaults FALSE
  -- (an unverified site shows "(unverified)" on the profile).
  verified    BOOLEAN NOT NULL DEFAULT FALSE,
  -- Email preferences: a per-kind override map, e.g. {"follow": false}. Absent /
  -- true = on, so the default ({}) means every email is on. Open-ended — adding a
  -- new notification kind needs no migration. Edited from the /notify page.
  notify      JSONB NOT NULL DEFAULT '{}',
  -- One-time-email bookkeeping: which milestones we've celebrated + whether the
  -- activation nudge was sent, e.g. {"views:100": true, "activation": true}. Keeps
  -- those emails idempotent without a separate table.
  notified    JSONB NOT NULL DEFAULT '{}',
  -- External / social profile links (Instagram, X, LinkedIn, …) shown on the public
  -- profile. Just an ordered array of URL strings — arbitrary platforms, no enum, so
  -- adding one is data, not a migration. The icon/label is derived from each URL at
  -- render time (see socialLabel), so this column never needs to know the platform.
  links       JSONB NOT NULL DEFAULT '[]',
  created     TEXT NOT NULL
);

-- Per-viewer "last seen this site" — powers the "new"/"updated" badge. (Distinct
-- from page_views below: this is one row per (viewer, site) tracking recency for
-- the feed; page_views is the append-only impression log behind analytics.)
CREATE TABLE IF NOT EXISTS visits (
  viewer_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  PRIMARY KEY (viewer_id, target_id)
);

-- Append-only page-view log — the substrate for relational analytics. One row per
-- widget impression: WHO (viewer_id, set only when the visitor is a signed-in signmysite
-- member — anonymous views keep it NULL), an opaque per-browser session, which
-- page, the referring host, and an engaged-time estimate filled in later by the
-- page-exit beacon (NULL until then). members.views stays the O(1) running total
-- for hot reads; this table is queried only for the owner's analytics view.
CREATE TABLE IF NOT EXISTS page_views (
  id          TEXT PRIMARY KEY,
  target_id   TEXT NOT NULL,
  viewer_id   TEXT,
  session     TEXT NOT NULL,
  path        TEXT,
  referrer    TEXT,
  duration_ms INTEGER,
  started     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS page_views_target ON page_views (target_id, started DESC);
CREATE INDEX IF NOT EXISTS page_views_known ON page_views (target_id, viewer_id) WHERE viewer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS page_views_session ON page_views (target_id, session, started DESC);

-- Follows. One row per (follower → target); the whole social graph is this table.
CREATE TABLE IF NOT EXISTS edges (
  follower_id TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  created     TEXT NOT NULL,
  PRIMARY KEY (follower_id, target_id)
);
CREATE INDEX IF NOT EXISTS edges_target ON edges (target_id);
-- Saves: a private library (unbounded). Same shape as edges.
CREATE TABLE IF NOT EXISTS saves (
  member_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  created   TEXT NOT NULL,
  PRIMARY KEY (member_id, target_id)
);
CREATE INDEX IF NOT EXISTS saves_target ON saves (target_id);
-- Public "pins": a tiny curated showcase (max 3, enforced in the API) of sites a
-- member points visitors to from their profile. Same shape as saves, kept its own
-- table because it's public + capped where saves are a private, unbounded bookmark.
CREATE TABLE IF NOT EXISTS pins (
  member_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  created   TEXT NOT NULL,
  PRIMARY KEY (member_id, target_id)
);
CREATE INDEX IF NOT EXISTS pins_member ON pins (member_id, created);
-- Notes + reactions left on a site. A reaction is just a comment whose body is a
-- single emoji (see isReaction) — one table, no separate reactions store. author_id
-- is null for an anonymous reaction.
CREATE TABLE IF NOT EXISTS comments (
  id         TEXT PRIMARY KEY,
  target_id  TEXT NOT NULL,
  author_id  TEXT,
  body       TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'public',  -- 'public' | 'private'
  created    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_target ON comments (target_id, created DESC);
CREATE INDEX IF NOT EXISTS comments_author ON comments (author_id, created DESC);
-- Recommended sites surfaced in the feed. Deliberately tiny + open-ended: a blanket
-- recommendation has for_id NULL (everyone sees it); a future personalized engine just
-- writes rows with for_id set to a member — the feed already unions both. reason is
-- free text shown under the card. (Today these are a hand-picked starter set so even a
-- brand-new feed isn't empty; real ranking comes later.)
CREATE TABLE IF NOT EXISTS recommendations (
  id        TEXT PRIMARY KEY,
  target_id TEXT NOT NULL,
  for_id    TEXT,            -- the member it's for; NULL = blanket (everyone)
  reason    TEXT,
  created   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS recommendations_for ON recommendations (for_id, created DESC);
-- Direct messages between two members. A "conversation" is just every message
-- exchanged by a pair, in either direction — there's no separate threads table, the
-- (sender, recipient) pair IS the thread. Deliberately close to the comments shape.
-- Soft-deletable (keeps the row + its place in the thread) and editable; the edited
-- stamp drives the "edited" hint, and read flips once the recipient opens the thread.
CREATE TABLE IF NOT EXISTS messages (
  id           TEXT PRIMARY KEY,
  sender_id    TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  body         TEXT NOT NULL,
  created      TEXT NOT NULL,
  edited       TEXT,                          -- set when the sender edits; null otherwise
  deleted      BOOLEAN NOT NULL DEFAULT FALSE, -- soft delete: body blanked, row + reactions kept
  read         BOOLEAN NOT NULL DEFAULT FALSE  -- the recipient has opened the thread
);
CREATE INDEX IF NOT EXISTS messages_pair ON messages (sender_id, recipient_id, created);
CREATE INDEX IF NOT EXISTS messages_inbox ON messages (recipient_id, created DESC);
-- Emoji reactions on a message. One row per (message, member, emoji): a member can
-- stack several different emoji on a message, but each emoji only once (a toggle).
-- Open-ended on the emoji, so the reaction set can grow with no migration.
CREATE TABLE IF NOT EXISTS message_reactions (
  message_id TEXT NOT NULL,
  member_id  TEXT NOT NULL,
  emoji      TEXT NOT NULL,
  created    TEXT NOT NULL,
  PRIMARY KEY (message_id, member_id, emoji)
);
CREATE INDEX IF NOT EXISTS message_reactions_msg ON message_reactions (message_id);
CREATE TABLE IF NOT EXISTS sessions (
  token     TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  created   TEXT NOT NULL,
  expires   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS magic_links (
  token    TEXT PRIMARY KEY,
  email    TEXT NOT NULL,
  created  TEXT NOT NULL,
  expires  TEXT NOT NULL,
  consumed BOOLEAN NOT NULL DEFAULT FALSE
);
-- Uploaded profile pictures. The bytes live here — never in members or any API
-- payload — so list responses and the embeddable widget's card JSON stay small;
-- members.avatar holds /avatars/<id>?v=<hash> and the bytes are served from here
-- with a long, immutable cache header. One (latest) row per member.
CREATE TABLE IF NOT EXISTS avatars (
  member_id TEXT PRIMARY KEY,
  bytes     BYTEA NOT NULL,
  mime      TEXT NOT NULL,
  updated   TEXT NOT NULL
);
-- Cohorts ("crews"): a small, CLOSED group — a class, a friend circle. The unit
-- of onboarding for a whole group at once: it fixes the cold-start problem (you
-- land among friends, not alone) and gives minors a bounded, safer space. The
-- invite 'code' rides in a shareable link (/join/<code>); joining mutually follows
-- everyone already in (see wireCohortFollows), so a newcomer's feed is alive on
-- arrival. Membership is its own concern, layered on the existing follow graph —
-- not a second copy of it.
CREATE TABLE IF NOT EXISTS cohorts (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  code     TEXT UNIQUE NOT NULL,   -- the invite code in /join/<code> (lowercase, unguessable)
  owner_id TEXT NOT NULL,          -- the member who created it (also has a cohort_members row)
  created  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cohort_members (
  cohort_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  role      TEXT NOT NULL DEFAULT 'member',  -- 'owner' | 'member'
  created   TEXT NOT NULL,
  PRIMARY KEY (cohort_id, member_id)
);
CREATE INDEX IF NOT EXISTS cohort_members_member ON cohort_members (member_id);
CREATE INDEX IF NOT EXISTS cohort_members_cohort ON cohort_members (cohort_id, created);
`;

// Default to a local unix-socket connection (peer auth) so it "just works"
// on a Homebrew Postgres. Override with DATABASE_URL in production.
const connectionString = process.env.DATABASE_URL || "postgres:///signmysite";
// Managed Postgres (Render, Neon, Supabase, Heroku, RDS…) requires TLS; a local
// socket or localhost host does not. So default SSL on for a remote DATABASE_URL
// and off locally — override either way with DATABASE_SSL=1/0. rejectUnauthorized
// is false because most managed providers present an intermediate/self-signed chain.
const isLocalDb =
  !process.env.DATABASE_URL ||
  /^postgres(ql)?:\/\/\/|@(localhost|127\.0\.0\.1)([:/]|$)/.test(connectionString);
const sslEnv = process.env.DATABASE_SSL;
const useSsl = sslEnv != null ? /^(1|true|require|on|yes)$/i.test(sslEnv) : !isLocalDb;
const pool = new pg.Pool({
  connectionString,
  ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
});

// One-time launch reset. The startup SCHEMA is CREATE TABLE IF NOT EXISTS, so it
// never alters a table that already exists — fine for a fresh DB, useless against a
// stale one. When SIGNMYSITE_RESET_DB=1, drop every object first (incl. objects from
// older schema versions) so the next line recreates everything clean. Set the env on
// the one deploy that ships a breaking schema change, then REMOVE it. Inert without it.
if (process.env.SIGNMYSITE_RESET_DB === "1") {
  await pool.query(`
    DROP TABLE IF EXISTS members, snapshots, visits, page_views, edges, saves, pins,
      comments, recommendations, messages, message_reactions, sessions, magic_links,
      avatars, cohorts, cohort_members CASCADE;
    DROP VIEW IF EXISTS member_cards CASCADE;
    DROP TYPE IF EXISTS prominence CASCADE;`);
  console.warn("[db] SIGNMYSITE_RESET_DB=1 — dropped all objects before recreating the schema");
}
await pool.query(SCHEMA);

// Re-insert accounts captured before a reset, passed as a JSON array in
// SIGNMYSITE_RESTORE (so no personal data ever lives in the repo). Each entry is a
// full members row. Paired with SIGNMYSITE_RESET_DB; remove both env vars once the
// launch deploy has run. ON CONFLICT DO NOTHING keeps it safe to re-run.
if (process.env.SIGNMYSITE_RESET_DB === "1" && process.env.SIGNMYSITE_RESTORE) {
  let rows: Array<Record<string, unknown>> = [];
  try { rows = JSON.parse(process.env.SIGNMYSITE_RESTORE); } catch { console.error("[db] SIGNMYSITE_RESTORE is not valid JSON; skipping"); }
  for (const a of rows) {
    await pool.query(
      `INSERT INTO members (id, handle, name, email, google_sub, url, avatar, verified, onboarded, links, views, last_edited, created)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13)
       ON CONFLICT (id) DO NOTHING`,
      [a.id, a.handle, a.name, a.email ?? null, a.google_sub ?? null, a.url ?? null, a.avatar ?? null,
       a.verified ?? false, a.onboarded ?? false, JSON.stringify(a.links ?? []), a.views ?? 0, a.last_edited ?? null, a.created ?? now()]
    );
  }
  if (rows.length) console.warn(`[db] restored ${rows.length} account(s) from SIGNMYSITE_RESTORE`);
}

// Curated baseline — the recommended starter sites + their blanket recommendations,
// upserted on every boot so a brand-new account's feed is never empty in ANY
// environment (prod runs no dev seed). Idempotent and never fatal to boot.
await seedCurated().catch((e) => console.error("[db] seedCurated failed:", e));

export const SESSION_TTL_SEC = 60 * 60 * 24 * 400;

// Wipe all data — for local dev / tests / seeding a clean slate.
export async function reset(): Promise<void> {
  await pool.query("TRUNCATE members, edges, saves, pins, comments, recommendations, messages, message_reactions, sessions, magic_links, visits, page_views, avatars, cohorts, cohort_members");
}

// Manual fame tier, ranking a member in someone's "Followed by" facepile:
// 0 normal, 1 notable, 2 famous. ORDER BY prominence DESC sorts it directly.
export type Prominence = number;
// A compact identity for facepiles ("Followed by …", mutuals) — just what a small
// avatar+name chip needs.
export type Identity = { id: string; handle: string | null; name: string; avatar: string | null; url: string | null };
export type Member = {
  id: string; handle: string | null; name: string; email: string | null;
  google_sub: string | null; url: string | null; avatar: string | null;
  views: number; last_edited: string | null; prominence: Prominence;
  thumbnail: string | null;       // live site preview (og:image), right on the member
  content_hash: string | null;    // last-seen normalized page hash (change detection)
  onboarded: boolean; verified: boolean;
  notify: Record<string, boolean>;    // email prefs: per-kind override ({} = all on)
  notified: Record<string, boolean>;  // one-time emails already sent (milestones, activation)
  links: string[];                    // external/social profile URLs (presentation derived per-URL)
  created: string;
};
// The email kinds a member can mute (the /notify page renders one toggle each).
export type NotifyKind =
  | "follow" | "save" | "comment" | "reaction" | "message"
  | "followedUpdate" | "siteUpdated" | "milestone";
// Does this member want `kind` emails? Default on — only an explicit false mutes.
export const wantsNotify = (m: { notify?: Record<string, boolean> }, kind: NotifyKind): boolean =>
  m.notify?.[kind] !== false;
// The canonical list of mutable kinds (mirrors NotifyKind). Lets a global
// one-click unsubscribe turn every stream off in one merge.
export const ALL_NOTIFY_KINDS: NotifyKind[] = [
  "follow", "save", "comment", "reaction", "message",
  "followedUpdate", "siteUpdated", "milestone",
];
export type Stats = {
  views: number; followers: number; following: number; saved: number; pinned: number;
  viewerFollows: boolean; viewerSaved: boolean; viewerPinned: boolean;
};
// A signmysite member who has viewed your site, with the relation that makes analytics
// relational: whether you already follow them (and they you). `views` is how many
// times they've opened your site in the window; `lastSeen` is the most recent.
export type ViewerVisit = {
  id: string; handle: string | null; name: string; avatar: string | null; url: string | null;
  views: number; lastSeen: string; viewerFollows: boolean; followsYou: boolean;
};
// The owner's analytics: headline counts, the real average engaged time (finally
// not a placeholder), and the named signmysite members behind the anonymous view total.
export type Analytics = {
  views: number;          // all-time running total (members.views)
  visitors: number;       // distinct sessions in the window
  visitorsWeek: number;   // distinct sessions in the last 7 days
  knownVisitors: number;  // distinct signed-in signmysite members in the window
  avgDurationMs: number | null;
  recent: ViewerVisit[];
};
export type Comment = {
  id: string; target_id: string; author_id: string; body: string; created: string;
};

// ---- members -------------------------------------------------------------
// Reads + writes both target the members table (thumbnail is a column on it now).

export async function getMember(id: string): Promise<Member | undefined> {
  return (await pool.query("SELECT * FROM members WHERE id = $1", [id])).rows[0];
}
export async function getMemberByEmail(email: string): Promise<Member | undefined> {
  return (await pool.query("SELECT * FROM members WHERE email = $1", [email])).rows[0];
}
export async function getMemberByHandle(handle: string): Promise<Member | undefined> {
  return (await pool.query("SELECT * FROM members WHERE handle = $1", [handle])).rows[0];
}
export async function getMemberByUrl(url: string): Promise<Member | undefined> {
  return (await pool.query(
    `SELECT * FROM members WHERE url = $1
     ORDER BY (email IS NOT NULL OR google_sub IS NOT NULL) DESC, created DESC
     LIMIT 1`,
    [url]
  )).rows[0];
}
export async function getMemberByGoogleSub(sub: string): Promise<Member | undefined> {
  return (await pool.query("SELECT * FROM members WHERE google_sub = $1", [sub])).rows[0];
}
// People search for the header typeahead: match a free query against name, @handle, or
// site URL. Prefix matches (and more prominent / more-viewed members) rank first.
// Deliberately one relevance-ranked query — open-ended; add columns to the WHERE to
// search more fields later. Only returns rows that are linkable (a handle or a URL).
export async function searchMembers(query: string, limit = 8): Promise<Member[]> {
  const q = query.trim();
  if (!q) return [];
  const esc = q.replace(/[%_\\]/g, (ch) => "\\" + ch);
  const like = `%${esc}%`, prefix = `${esc}%`;
  return (await pool.query(
    `SELECT * FROM members
      WHERE (handle IS NOT NULL OR url IS NOT NULL)
        AND (name ILIKE $1 OR handle ILIKE $1 OR url ILIKE $1)
      ORDER BY (handle ILIKE $2 OR name ILIKE $2) DESC, prominence DESC, views DESC, name ASC
      LIMIT $3`,
    [like, prefix, limit]
  )).rows;
}
export async function createMember(m: {
  id: string; name: string; handle?: string | null; email?: string | null;
  google_sub?: string | null; url?: string | null; avatar?: string | null;
}): Promise<Member> {
  // New members start un-onboarded — the signup wizard (username + optional
  // site) flips this to true. (Crawled/indexed members never sign in, so theirs
  // is moot.) Existing rows kept their column default of TRUE.
  await pool.query(
    `INSERT INTO members (id, handle, name, email, google_sub, url, avatar, onboarded, created)
     VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, $8)`,
    [m.id, m.handle ?? null, m.name, m.email ?? null, m.google_sub ?? null,
     m.url ?? null, m.avatar ?? null, now()]
  );
  return (await getMember(m.id))!;
}
// Columns a patch may write (excludes id/created) — so a Partial<Member> can't
// accidentally generate SQL against a column that doesn't exist.
const MUTABLE_MEMBER_COLS = new Set([
  "handle", "name", "email", "google_sub", "url", "avatar", "links",
  "views", "last_edited", "thumbnail", "content_hash", "onboarded", "verified", "prominence",
]);
// JSONB columns need an explicit ::jsonb cast and a JSON-encoded value — pg would
// otherwise try to coerce a JS array into a Postgres array literal.
const JSONB_MEMBER_COLS = new Set(["links"]);
export async function updateMember(id: string, patch: Partial<Member>): Promise<Member | undefined> {
  const keys = Object.keys(patch).filter((k) => MUTABLE_MEMBER_COLS.has(k));
  if (!keys.length) return getMember(id);
  const set = keys.map((k, i) => `${k} = $${i + 1}${JSONB_MEMBER_COLS.has(k) ? "::jsonb" : ""}`).join(", ");
  const vals = keys.map((k) => {
    const v = (patch as Record<string, unknown>)[k];
    return JSONB_MEMBER_COLS.has(k) ? JSON.stringify(v ?? []) : (v ?? null);
  });
  await pool.query(`UPDATE members SET ${set} WHERE id = $${keys.length + 1}`, [...vals, id]);
  return getMember(id);
}

// ---- claiming / merging members ------------------------------------------
// Two rows can turn out to be the same person's site: a no-login placeholder (crawled,
// or a curated recommendation like @pg) and the real owner. Whoever's widget id is
// installed on the page must SURVIVE the merge, or that <script src=".../w/<id>.js">
// breaks. So there are two entry points over one shared primitive (absorbMember):
// claimUnclaimedMember keeps the placeholder (its id is what's installed — the agent /
// local-first path); claimPlaceholderByUrl keeps the real account (a normal signup,
// whose own id is installed).

// Normalized site key for matching two rows to the same site: host+path, lowercased,
// without scheme, a leading "www.", or trailing slashes. Applied identically to a
// column or a bind param so both sides of a comparison normalize the same way.
// (function, not const — seedCurated() calls this from the boot block above, before
// this point in the module is evaluated; a function declaration is hoisted, a const isn't.)
function URLKEY(col: string): string {
  return `lower(regexp_replace(regexp_replace(${col}, '^https?://(www\\.)?', ''), '/+$', ''))`;
}

function isLocalUrlish(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".local");
  } catch { return false; }
}

// Run fn inside ONE pooled connection's transaction (commit on success, roll back on
// error). pool.query() can hand each call a different connection, so a BEGIN/COMMIT pair
// issued through the pool wouldn't actually wrap anything — a member merge must hold a
// single client for real atomicity.
async function withTx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// Flow A: the widget on the page carries the PLACEHOLDER's id. A signed-in viewer who
// controls that origin claims it — the placeholder survives (its installed widget keeps
// working) and adopts the claimant's login.
export async function claimUnclaimedMember(placeholderId: string, claimantId: string): Promise<Member | undefined> {
  if (placeholderId === claimantId) return getMember(placeholderId);
  const placeholder = await getMember(placeholderId);
  const claimant = await getMember(claimantId);
  if (!placeholder || !claimant || placeholder.email || placeholder.google_sub) return undefined;
  await withTx(async (client) => {
    // The placeholder adopts the claimant's login (+ avatar if it had none). Free the
    // claimant's UNIQUE columns first so the placeholder can take them.
    await client.query("UPDATE members SET email = NULL, google_sub = NULL WHERE id = $1", [claimantId]);
    await client.query(
      "UPDATE members SET email = $2, google_sub = $3, avatar = COALESCE(avatar, $4) WHERE id = $1",
      [placeholderId, claimant.email, claimant.google_sub, claimant.avatar]
    );
    await absorbMember(client, claimantId, placeholderId);
  });
  return getMember(placeholderId);
}

// Flow B: a normal signup proves ownership of a site a placeholder already represents
// (the real Paul Graham verifying paulgraham.com over the curated @pg). The real account
// SURVIVES — its installed widget id stays valid — and inherits the placeholder's
// well-known handle, public identity, social graph, and recommendation; the placeholder
// is absorbed. Run right after a member is verified; a no-op when no such placeholder
// exists. Returns the updated survivor if a merge happened.
export async function claimPlaceholderByUrl(keepId: string): Promise<Member | undefined> {
  const keep = await getMember(keepId);
  if (!keep || !keep.url || isLocalUrlish(keep.url)) return undefined;
  const merged = await withTx(async (client) => {
    const placeholder = (await client.query(
      `SELECT * FROM members
        WHERE id <> $1 AND email IS NULL AND google_sub IS NULL
          AND ${URLKEY("url")} = ${URLKEY("$2")}
        ORDER BY (handle IS NOT NULL) DESC, created ASC
        LIMIT 1`,
      [keepId, keep.url]
    )).rows[0] as Member | undefined;
    if (!placeholder) return false;
    // Inherit the placeholder's well-known handle; take its name only if ours is still a
    // default (so a real name from Google sign-in wins). Keep our own avatar/url/login.
    // Free the placeholder's handle first so the UNIQUE constraint lets us take it.
    const keepNameIsDefault = !keep.name || keep.name === "New member" ||
      (!!keep.email && keep.name === keep.email.split("@")[0]);
    const newHandle = placeholder.handle ?? keep.handle;
    const newName = keepNameIsDefault ? placeholder.name : keep.name;
    await client.query("UPDATE members SET handle = NULL WHERE id = $1", [placeholder.id]);
    await client.query(
      `UPDATE members
          SET handle = $2, name = $3,
              avatar = COALESCE(avatar, $4),
              thumbnail = COALESCE(thumbnail, $5),
              prominence = GREATEST(prominence, $6),
              onboarded = TRUE
        WHERE id = $1`,
      [keepId, newHandle, newName, placeholder.avatar, placeholder.thumbnail, placeholder.prominence]
    );
    await absorbMember(client, placeholder.id, keepId);
    return true;
  });
  return merged ? getMember(keepId) : undefined;
}

// The shared merge primitive: re-point every reference from dropId onto keepId, then
// delete dropId. Composite-key tables (edges/saves/pins/visits/reactions/cohort_members)
// move with a conflict / NOT-EXISTS guard so a row already on keepId can't clash; the
// rest are plain re-points. MUST run inside a transaction (both callers open one).
async function absorbMember(client: pg.PoolClient, dropId: string, keepId: string): Promise<void> {
  await client.query("UPDATE sessions SET member_id = $1 WHERE member_id = $2", [keepId, dropId]);
  await client.query("UPDATE comments SET author_id = $1 WHERE author_id = $2", [keepId, dropId]);
  await client.query("UPDATE comments SET target_id = $1 WHERE target_id = $2", [keepId, dropId]);
  await client.query("UPDATE recommendations SET target_id = $1 WHERE target_id = $2", [keepId, dropId]);
  await client.query("UPDATE recommendations SET for_id = $1 WHERE for_id = $2", [keepId, dropId]);
  await client.query("UPDATE page_views SET target_id = $1 WHERE target_id = $2", [keepId, dropId]);
  await client.query("UPDATE page_views SET viewer_id = $1 WHERE viewer_id = $2", [keepId, dropId]);
  await client.query("UPDATE messages SET sender_id = $1 WHERE sender_id = $2", [keepId, dropId]);
  await client.query("UPDATE messages SET recipient_id = $1 WHERE recipient_id = $2", [keepId, dropId]);
  await client.query("DELETE FROM messages WHERE sender_id = $1 AND recipient_id = $1", [keepId]);
  await client.query(
    `INSERT INTO message_reactions (message_id, member_id, emoji, created)
     SELECT message_id, $1, emoji, created FROM message_reactions WHERE member_id = $2
     ON CONFLICT DO NOTHING`,
    [keepId, dropId]
  );
  await client.query("DELETE FROM message_reactions WHERE member_id = $1", [dropId]);
  await moveEdges(client, dropId, keepId);
  await movePairs(client, "saves", "member_id", "target_id", dropId, keepId);
  await movePairs(client, "pins", "member_id", "target_id", dropId, keepId);
  await moveVisits(client, dropId, keepId);
  await client.query(
    `INSERT INTO avatars (member_id, bytes, mime, updated)
     SELECT $1, bytes, mime, updated FROM avatars WHERE member_id = $2
     ON CONFLICT (member_id) DO NOTHING`,
    [keepId, dropId]
  );
  await client.query("DELETE FROM avatars WHERE member_id = $1", [dropId]);
  // Cohort memberships + ownership follow the surviving id; the NOT EXISTS guard avoids
  // a PK clash when keepId is already in that cohort.
  await client.query(
    `UPDATE cohort_members SET member_id = $1
      WHERE member_id = $2
        AND NOT EXISTS (SELECT 1 FROM cohort_members x WHERE x.cohort_id = cohort_members.cohort_id AND x.member_id = $1)`,
    [keepId, dropId]
  );
  await client.query("DELETE FROM cohort_members WHERE member_id = $1", [dropId]);
  await client.query("UPDATE cohorts SET owner_id = $1 WHERE owner_id = $2", [keepId, dropId]);
  await client.query("DELETE FROM members WHERE id = $1", [dropId]);
}

async function movePairs(client: pg.PoolClient, table: string, left: string, right: string, sourceId: string, targetId: string): Promise<void> {
  await client.query(
    `INSERT INTO ${table} (${left}, ${right}, created)
     SELECT CASE WHEN ${left} = $1 THEN $2 ELSE ${left} END,
            CASE WHEN ${right} = $1 THEN $2 ELSE ${right} END,
            created
       FROM ${table}
      WHERE (${left} = $1 OR ${right} = $1)
        AND NOT (${left} = $1 AND ${right} = $2)
        AND NOT (${left} = $2 AND ${right} = $1)
     ON CONFLICT DO NOTHING`,
    [sourceId, targetId]
  );
  await client.query(`DELETE FROM ${table} WHERE ${left} = $1 OR ${right} = $1`, [sourceId]);
}

async function moveEdges(client: pg.PoolClient, sourceId: string, targetId: string): Promise<void> {
  await client.query(
    `INSERT INTO edges (follower_id, target_id, created)
     SELECT CASE WHEN follower_id = $1 THEN $2 ELSE follower_id END,
            CASE WHEN target_id = $1 THEN $2 ELSE target_id END,
            created
       FROM edges
      WHERE (follower_id = $1 OR target_id = $1)
        AND NOT (follower_id = $1 AND target_id = $2)
        AND NOT (follower_id = $2 AND target_id = $1)
     ON CONFLICT DO NOTHING`,
    [sourceId, targetId]
  );
  await client.query("DELETE FROM edges WHERE follower_id = $1 OR target_id = $1", [sourceId]);
}

async function moveVisits(client: pg.PoolClient, sourceId: string, targetId: string): Promise<void> {
  await client.query(
    `INSERT INTO visits (viewer_id, target_id, last_seen)
     SELECT CASE WHEN viewer_id = $1 THEN $2 ELSE viewer_id END,
            CASE WHEN target_id = $1 THEN $2 ELSE target_id END,
            last_seen
       FROM visits
      WHERE (viewer_id = $1 OR target_id = $1)
        AND NOT (viewer_id = $1 AND target_id = $2)
        AND NOT (viewer_id = $2 AND target_id = $1)
     ON CONFLICT DO NOTHING`,
    [sourceId, targetId]
  );
  await client.query("DELETE FROM visits WHERE viewer_id = $1 OR target_id = $1", [sourceId]);
}

// ---- edges (follow) ------------------------------------------------------
export async function setEdge(follower: string, target: string): Promise<void> {
  await pool.query(
    `INSERT INTO edges (follower_id, target_id, created) VALUES ($1, $2, $3)
     ON CONFLICT (follower_id, target_id) DO NOTHING`,
    [follower, target, now()]
  );
}
export async function removeEdge(follower: string, target: string): Promise<void> {
  await pool.query("DELETE FROM edges WHERE follower_id = $1 AND target_id = $2", [follower, target]);
}
export async function hasEdge(follower: string, target: string): Promise<boolean> {
  return (await pool.query("SELECT 1 FROM edges WHERE follower_id = $1 AND target_id = $2", [follower, target])).rowCount! > 0;
}

// Follow a site AND save it. A follow is the strong signal ("keep up with this
// site"); saving is the private library it lands in — so following a site puts it
// in your saved collection by default, written together here so the two can never
// drift. This is the deliberate user action: the low-level setEdge primitive
// (used by discovery, cohort wiring, and migration) stays save-free, so only a
// real follow seeds a save. Idempotent. The seeded save is independent afterward:
// an explicit unsave can drop it while you keep following, and unfollowing
// (removeEdge) leaves the save in your library to prune on its own.
export async function follow(follower: string, target: string): Promise<void> {
  await pool.query("BEGIN");
  try {
    await setEdge(follower, target);
    await setSave(follower, target);
    await pool.query("COMMIT");
  } catch (e) {
    await pool.query("ROLLBACK");
    throw e;
  }
}

// The most prominent accounts following `target` — the "Followed by …" facepile.
// Ranked by the manual prominence flag, then raw page-views, so the flag is an
// override on the view heuristic. Joins members directly (for prominence/views).
export async function notableFollowers(target: string, limit: number): Promise<Identity[]> {
  return (await pool.query(
    `SELECT m.id, m.handle, m.name, m.avatar, m.url
       FROM edges e JOIN members m ON m.id = e.follower_id
      WHERE e.target_id = $1
      ORDER BY m.prominence DESC, m.views DESC, m.name ASC
      LIMIT $2`,
    [target, limit]
  )).rows;
}

// Accounts that follow `target` AND that `viewer` also follows — the mutual
// connections a signed-in visitor sees ("… you follow"). `total` (a window count,
// computed before LIMIT) backs the "+N" in the label. Same fame ranking.
export async function mutualFollowers(target: string, viewer: string, limit: number): Promise<{ faces: Identity[]; total: number }> {
  const rows = (await pool.query(
    `SELECT m.id, m.handle, m.name, m.avatar, m.url, COUNT(*) OVER()::int AS total
       FROM edges ep
       JOIN edges ev ON ev.target_id = ep.follower_id AND ev.follower_id = $2
       JOIN members m ON m.id = ep.follower_id
      WHERE ep.target_id = $1
      ORDER BY m.prominence DESC, m.views DESC, m.name ASC
      LIMIT $3`,
    [target, viewer, limit]
  )).rows as Array<Identity & { total: number }>;
  return {
    faces: rows.map((r) => ({ id: r.id, handle: r.handle, name: r.name, avatar: r.avatar, url: r.url })),
    total: rows[0]?.total ?? 0,
  };
}

// ---- saves ---------------------------------------------------------------
export async function setSave(member: string, target: string, created?: string): Promise<void> {
  await pool.query(
    `INSERT INTO saves (member_id, target_id, created) VALUES ($1, $2, $3)
     ON CONFLICT (member_id, target_id) DO NOTHING`,
    [member, target, created ?? now()]
  );
}
export async function removeSave(member: string, target: string): Promise<void> {
  await pool.query("DELETE FROM saves WHERE member_id = $1 AND target_id = $2", [member, target]);
}
export async function hasSave(member: string, target: string): Promise<boolean> {
  return (await pool.query("SELECT 1 FROM saves WHERE member_id = $1 AND target_id = $2", [member, target])).rowCount! > 0;
}

// ---- pins (public, max 3) ------------------------------------------------
// The 3-pin cap is enforced in the API layer; the store stays a dumb set.
export const PIN_LIMIT = 3;
export async function setPin(member: string, target: string): Promise<void> {
  await pool.query(
    `INSERT INTO pins (member_id, target_id, created) VALUES ($1, $2, $3)
     ON CONFLICT (member_id, target_id) DO NOTHING`,
    [member, target, now()]
  );
}
export async function removePin(member: string, target: string): Promise<void> {
  await pool.query("DELETE FROM pins WHERE member_id = $1 AND target_id = $2", [member, target]);
}
export async function hasPin(member: string, target: string): Promise<boolean> {
  return (await pool.query("SELECT 1 FROM pins WHERE member_id = $1 AND target_id = $2", [member, target])).rowCount! > 0;
}
export async function countPins(member: string): Promise<number> {
  return (await pool.query("SELECT COUNT(*)::int AS c FROM pins WHERE member_id = $1", [member])).rows[0].c;
}
// A member's pinned sites (oldest-first, so the showcase order is stable), each
// carrying the public note(s) that member left on it — the bubble shown under
// the pin. Capped at PIN_LIMIT.
export type PinnedSite = SiteCard & { notes: Array<{ id: string; body: string; created: string }> };
export async function listPinned(memberId: string): Promise<PinnedSite[]> {
  const sites = (await pool.query(
    `SELECT m.*,
            COUNT(DISTINCT all_saves.member_id)::int AS saved_count,
            COUNT(DISTINCT followers.follower_id)::int AS follower_count
       FROM pins p
       JOIN members m ON m.id = p.target_id
       LEFT JOIN saves all_saves ON all_saves.target_id = m.id
       LEFT JOIN edges followers ON followers.target_id = m.id
      WHERE p.member_id = $1
      GROUP BY m.id, p.created
      ORDER BY p.created ASC
      LIMIT $2`,
    [memberId, PIN_LIMIT]
  )).rows as SiteCard[];
  if (!sites.length) return [];
  // The pinner's own PUBLIC notes on those sites, attached as the bubble.
  const notes = (await pool.query(
    `SELECT id, target_id, body, created FROM comments
      WHERE author_id = $1 AND visibility = 'public' AND target_id = ANY($2)
      ORDER BY created ASC`,
    [memberId, sites.map((s) => s.id)]
  )).rows as Array<{ id: string; target_id: string; body: string; created: string }>;
  return sites.map((s) => ({
    ...s,
    notes: notes.filter((n) => n.target_id === s.id).map((n) => ({ id: n.id, body: n.body, created: n.created })),
  }));
}

// ---- stats ---------------------------------------------------------------
export async function stats(id: string, viewerId?: string): Promise<Stats> {
  const m = (await pool.query("SELECT views FROM members WHERE id = $1", [id])).rows[0];
  const followers = (await pool.query("SELECT COUNT(*)::int AS c FROM edges WHERE target_id = $1", [id])).rows[0].c;
  const following = (await pool.query("SELECT COUNT(*)::int AS c FROM edges WHERE follower_id = $1", [id])).rows[0].c;
  const saved = (await pool.query("SELECT COUNT(*)::int AS c FROM saves WHERE target_id = $1", [id])).rows[0].c;
  const pinned = (await pool.query("SELECT COUNT(*)::int AS c FROM pins WHERE target_id = $1", [id])).rows[0].c;
  return {
    views: m?.views ?? 0,
    followers,
    following,
    saved,
    pinned,
    viewerFollows: viewerId ? await hasEdge(viewerId, id) : false,
    viewerSaved: viewerId ? await hasSave(viewerId, id) : false,
    viewerPinned: viewerId ? await hasPin(viewerId, id) : false,
  };
}

// ---- views & analytics ---------------------------------------------------
// The time ranges the analytics toggle offers. "all" is the lifetime total; the
// rest are rolling windows. One enum drives both the API param and the SQL since.
export type Range = "day" | "week" | "month" | "all";
const RANGE_DAYS: Record<Exclude<Range, "all">, number> = { day: 1, week: 7, month: 30 };
// The ISO instant a range starts at, or null for all-time (no lower bound). ISO
// strings sort lexically, so a plain `started > $since` is a correct time filter.
const sinceOf = (range: Range): string | null =>
  range === "all" ? null : new Date(Date.now() - RANGE_DAYS[range] * 864e5).toISOString();

// Record one page view: append the event (who/where/referrer) AND bump the site's
// running counter, so every hot read stays a single-column lookup. `viewer` is set
// only when the visitor is a signed-in signmysite member — that's what makes the analytics
// relational. The caller drops self-views before calling. Returns the new total.
export async function recordView(v: {
  target: string; viewer?: string | null; session: string;
  path?: string | null; referrer?: string | null;
}): Promise<number> {
  await pool.query(
    `INSERT INTO page_views (id, target_id, viewer_id, session, path, referrer, started)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    ["pv_" + token(8), v.target, v.viewer ?? null, v.session, v.path ?? null, v.referrer ?? null, now()]
  );
  const r = await pool.query("UPDATE members SET views = views + 1 WHERE id = $1 RETURNING views", [v.target]);
  return r.rows[0]?.views ?? 0;
}

// Attach an engaged-time estimate to this session's most recent view of the site.
// Sent by the page-exit beacon, which can't carry the auth header — so it's keyed
// by the opaque session, not the viewer. Monotonic (only ever raises the figure,
// since the beacon may fire several times) and scoped to the last few hours so a
// recycled session id can't rewrite old history.
export async function recordDuration(target: string, session: string, ms: number): Promise<void> {
  const floor = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  await pool.query(
    `UPDATE page_views SET duration_ms = GREATEST(COALESCE(duration_ms, 0), $3)
      WHERE id = (
        SELECT id FROM page_views
         WHERE target_id = $1 AND session = $2 AND started > $4
         ORDER BY started DESC LIMIT 1
      )`,
    [target, session, Math.round(ms), floor]
  );
}

// Seed/import helper: insert a fully-specified view event with its own timestamp
// and known duration, WITHOUT bumping the counter (the seed sets that directly).
// Production views go through recordView instead.
export async function importView(v: {
  target: string; viewer?: string | null; session: string;
  path?: string | null; referrer?: string | null; durationMs?: number | null; at?: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO page_views (id, target_id, viewer_id, session, path, referrer, duration_ms, started)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    ["pv_" + token(8), v.target, v.viewer ?? null, v.session, v.path ?? null,
     v.referrer ?? null, v.durationMs ?? null, v.at ?? now()]
  );
}

// The owner's relational analytics for one site, scoped to a time range. Headline
// counts + average engaged time, plus the named signmysite members behind the view total
// — each joined to the edge table both ways so the UI can say "follows you / you
// don't follow back yet". This is the read that turns an anonymous counter into a
// discovery surface. `range` windows everything; "all" reports the lifetime total
// (members.views) for views and is unbounded for the rest.
export async function analytics(id: string, range: Range = "all"): Promise<Analytics> {
  const since = sinceOf(range);                                   // null ⇒ all-time
  const weekSince = new Date(Date.now() - 7 * 864e5).toISOString();
  const [totals, recent] = await Promise.all([
    pool.query(
      `SELECT
         (SELECT views FROM members WHERE id = $1)                                          AS all_views,
         COUNT(*) FILTER (WHERE $2::text IS NULL OR started > $2)::int                       AS win_views,
         COUNT(DISTINCT session) FILTER (WHERE $2::text IS NULL OR started > $2)::int         AS visitors,
         COUNT(DISTINCT session) FILTER (WHERE started > $3)::int                            AS visitors_week,
         COUNT(DISTINCT viewer_id)
           FILTER (WHERE ($2::text IS NULL OR started > $2) AND viewer_id IS NOT NULL AND viewer_id <> $1)::int AS known,
         AVG(duration_ms) FILTER (WHERE ($2::text IS NULL OR started > $2) AND duration_ms IS NOT NULL) AS avg_ms
       FROM page_views WHERE target_id = $1`,
      [id, since, weekSince]
    ),
    pool.query(
      `SELECT m.id, m.handle, m.name, m.avatar, m.url,
              COUNT(*)::int                  AS views,
              MAX(pv.started)                AS last_seen,
              (fo.follower_id IS NOT NULL)   AS "viewerFollows",
              (fi.follower_id IS NOT NULL)   AS "followsYou"
         FROM page_views pv
         JOIN members m ON m.id = pv.viewer_id
         LEFT JOIN edges fo ON fo.follower_id = $1 AND fo.target_id = m.id
         LEFT JOIN edges fi ON fi.follower_id = m.id AND fi.target_id = $1
        WHERE pv.target_id = $1 AND pv.viewer_id IS NOT NULL AND pv.viewer_id <> $1
          AND ($2::text IS NULL OR pv.started > $2)
        GROUP BY m.id, fo.follower_id, fi.follower_id
        ORDER BY MAX(pv.started) DESC
        LIMIT 24`,
      [id, since]
    ),
  ]);
  const t = totals.rows[0] || {};
  return {
    views: range === "all" ? Number(t.all_views || 0) : Number(t.win_views || 0),
    visitors: Number(t.visitors || 0),
    visitorsWeek: Number(t.visitors_week || 0),
    knownVisitors: Number(t.known || 0),
    avgDurationMs: t.avg_ms != null ? Math.round(Number(t.avg_ms)) : null,
    recent: recent.rows.map((r) => ({
      id: r.id, handle: r.handle, name: r.name, avatar: r.avatar, url: r.url,
      views: r.views, lastSeen: r.last_seen,
      viewerFollows: r.viewerFollows, followsYou: r.followsYou,
    })),
  };
}

// ---- the home feed -------------------------------------------------------
// One reverse-chron activity stream: what your network does to sites, what happens to
// yours, plus curated recommendations so a fresh feed is never empty. Kinds — saved /
// comment / update / recommendation — each carries a site's og:image. Sources are
// small bounded queries merged + sorted in JS (clearer than one giant UNION, and each
// stays independently tunable).
export type FeedKind = "saved" | "comment" | "update" | "recommendation";
export type FeedSite = Identity & { thumbnail: string | null };
export type FeedRow = {
  kind: FeedKind;
  at: string;                  // ISO; the sort + pagination key
  id?: string;                 // comment id (stable react key)
  actor: Identity | null;      // A — who acted (null = an anonymous reaction)
  target: FeedSite;            // B — the site acted on; carries the og:image
  body?: string;               // comment text (kind="comment")
  visibility?: Visibility;     // comment visibility
};

// Build an Identity from a prefixed result row (`a_id`/`a_name`…), or null when the
// id column is absent (an anonymous comment author).
const ident = (r: Record<string, unknown>, p = ""): Identity | null =>
  r[p + "id"]
    ? {
        id: r[p + "id"] as string, handle: (r[p + "handle"] as string) ?? null,
        name: (r[p + "name"] as string) ?? "", avatar: (r[p + "avatar"] as string) ?? null,
        url: (r[p + "url"] as string) ?? null,
      }
    : null;
// A target site — an Identity plus its preview image (the og:image the feed shows).
const identSite = (r: Record<string, unknown>, p = ""): FeedSite =>
  ({ ...(ident(r, p) as Identity), thumbnail: (r[p + "thumbnail"] as string) ?? null });

// Activity is either on YOUR site, or done by someone you follow to anyone else's —
// this fragment expresses that for whichever "actor" column a source has.
const NETWORK = (actorCol: string) =>
  `(t.id = $1 OR (t.id <> $1 AND ${actorCol} IN (SELECT target_id FROM edges WHERE follower_id = $1)))`;

export async function feed(
  viewerId: string, opts: { limit?: number; before?: string | null } = {}
): Promise<FeedRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 60);
  const before = opts.before || null;             // ISO cursor; null = newest page
  const p = [viewerId, before, limit];            // $1 viewer, $2 before, $3 limit
  const cols = (alias: string, pre: string) =>
    `${alias}.id AS ${pre}id, ${alias}.handle AS ${pre}handle, ${alias}.name AS ${pre}name, ${alias}.avatar AS ${pre}avatar, ${alias}.url AS ${pre}url`;

  const [comments, saves, updates, recommendations] = await Promise.all([
    // Notes + reactions on your site (incl. private), and the public ones people you
    // follow leave anywhere else.
    pool.query(
      `SELECT c.id, c.body, c.visibility, c.created AS at,
              ${cols("a", "a_")}, ${cols("t", "t_")}, t.thumbnail AS t_thumbnail
         FROM comments c
         LEFT JOIN members a ON a.id = c.author_id
         JOIN members t ON t.id = c.target_id
        WHERE (c.target_id = $1 OR (c.visibility = 'public' AND ${NETWORK("c.author_id")}))
          AND c.author_id IS DISTINCT FROM $1
          AND ($2::text IS NULL OR c.created < $2)
        ORDER BY c.created DESC LIMIT $3`, p),
    // Saves of your site, and the ones people you follow make anywhere else.
    pool.query(
      `SELECT sv.created AS at, ${cols("a", "a_")}, ${cols("t", "t_")}, t.thumbnail AS t_thumbnail
         FROM saves sv
         JOIN members a ON a.id = sv.member_id
         JOIN members t ON t.id = sv.target_id
        WHERE sv.member_id <> $1 AND ${NETWORK("sv.member_id")}
          AND ($2::text IS NULL OR sv.created < $2)
        ORDER BY sv.created DESC LIMIT $3`, p),
    // Sites you follow whose freshness clock advanced (actor = target = the site).
    pool.query(
      `SELECT m.last_edited AS at, ${cols("m", "a_")}, ${cols("m", "t_")}, m.thumbnail AS t_thumbnail
         FROM edges e JOIN members m ON m.id = e.target_id
        WHERE e.follower_id = $1 AND m.last_edited IS NOT NULL
          AND ($2::text IS NULL OR m.last_edited < $2)
        ORDER BY m.last_edited DESC LIMIT $3`, p),
    // Recommended sites — blanket (for_id NULL) + any personalized to you — that you
    // don't already follow and aren't your own. The starter set keeps a fresh feed alive.
    pool.query(
      `SELECT r.created AS at, r.reason, ${cols("m", "a_")}, ${cols("m", "t_")}, m.thumbnail AS t_thumbnail
         FROM recommendations r JOIN members m ON m.id = r.target_id
        WHERE (r.for_id IS NULL OR r.for_id = $1) AND m.id <> $1
          AND NOT EXISTS (SELECT 1 FROM edges e WHERE e.follower_id = $1 AND e.target_id = m.id)
          AND ($2::text IS NULL OR r.created < $2)
        ORDER BY r.created DESC LIMIT $3`, p),
  ]);

  const rows: FeedRow[] = [
    ...comments.rows.map((r): FeedRow => ({
      kind: "comment", at: r.at, id: r.id, actor: ident(r, "a_"), target: identSite(r, "t_"),
      body: r.body, visibility: r.visibility })),
    ...saves.rows.map((r): FeedRow => ({
      kind: "saved", at: r.at, actor: ident(r, "a_"), target: identSite(r, "t_") })),
    ...updates.rows.map((r): FeedRow => ({
      kind: "update", at: r.at, actor: ident(r, "a_"), target: identSite(r, "t_") })),
    ...recommendations.rows.map((r): FeedRow => ({
      kind: "recommendation", at: r.at, actor: ident(r, "a_"), target: identSite(r, "t_"), body: r.reason })),
  ];
  rows.sort((x, y) => (Date.parse(y.at) || 0) - (Date.parse(x.at) || 0));
  return rows.slice(0, limit);
}

// The "since you've been gone" digest above the feed: rolling counts of new views,
// notes, and followers on your own site over the last `days`.
export async function feedDigest(
  viewerId: string, days = 7
): Promise<{ days: number; newViews: number; newComments: number; newFollowers: number }> {
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const r = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM page_views WHERE target_id = $1 AND started > $2)::int AS views,
       (SELECT COUNT(*) FROM comments   WHERE target_id = $1 AND created > $2)::int  AS comments,
       (SELECT COUNT(*) FROM edges      WHERE target_id = $1 AND created > $2)::int  AS followers`,
    [viewerId, since]
  );
  const x = r.rows[0] || {};
  return { days, newViews: Number(x.views || 0), newComments: Number(x.comments || 0), newFollowers: Number(x.followers || 0) };
}

// Recommend a site in the feed. Blanket when forId is omitted (everyone); pass a
// member id to target one person — the seam a real recommendation engine writes to.
export async function addRecommendation(targetId: string, reason: string, forId?: string | null): Promise<void> {
  await pool.query(
    "INSERT INTO recommendations (id, target_id, for_id, reason, created) VALUES ($1, $2, $3, $4, $5)",
    ["rec_" + token(8), targetId, forId ?? null, reason, now()]
  );
}

// Upsert the curated starter set (see server/curated.ts): each recommended site as a
// verified member carrying its preview, plus one blanket recommendation per site. Both
// use stable ids + ON CONFLICT DO NOTHING, so this is safe to run on every boot and
// never duplicates. Called from the boot baseline (so prod has it) and the dev seed.
export async function seedCurated(): Promise<void> {
  const t = now();
  for (const c of CURATED) {
    // Who represents this site now? A verified real owner who has claimed it wins;
    // otherwise the curated placeholder (created here by its stable id on first boot).
    // This is what lets the recommendation survive a claim: once the real owner takes
    // over the site (see claimPlaceholderByUrl) the placeholder is gone, and we neither
    // resurrect it nor point the recommendation back at an empty shell.
    let owner = (await pool.query(
      `SELECT * FROM members WHERE ${URLKEY("url")} = ${URLKEY("$1")}
        ORDER BY ((email IS NOT NULL OR google_sub IS NOT NULL) AND verified) DESC, created ASC
        LIMIT 1`,
      [c.url]
    )).rows[0] as Member | undefined;
    if (!owner) {
      await pool.query(
        `INSERT INTO members (id, handle, name, url, avatar, thumbnail, views, onboarded, verified, last_edited, created)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, true, $8, $8)
         ON CONFLICT (id) DO NOTHING`,
        [c.id, c.handle, c.name, c.url, c.avatar, c.thumbnail, 1200, t]
      );
      owner = await getMember(c.id);
    }
    if (!owner) continue;
    // Ensure the blanket recommendation exists, pointing at the current owner. DO NOTHING
    // (not UPDATE) so a claim that already moved it onto the real account is never undone.
    await pool.query(
      `INSERT INTO recommendations (id, target_id, for_id, reason, created)
       VALUES ($1, $2, NULL, $3, $4) ON CONFLICT (id) DO NOTHING`,
      ["rec_blanket_" + c.handle, owner.id, c.reason, t]
    );
  }
}

// ---- freshness + snapshots -----------------------------------------------
// Mark a site as edited (monotonically — never moves freshness backwards). For
// owner-asserted edits with no observable content change: a ping, or me.json
// `updated`. Content changes we detect ourselves go through recordSiteContent.
export async function markEdited(id: string, when?: string): Promise<void> {
  await pool.query("UPDATE members SET last_edited = GREATEST(last_edited, $2) WHERE id = $1", [id, when || now()]);
}

export type SiteContent = { hash: string; thumbnail?: string | null; title?: string | null; excerpt?: string | null };
// Record the site's current content directly on the member: its preview image +
// content hash, bumping last_edited only when the hash actually changed (so a static
// page never looks "updated"). Returns the refreshed member + whether this was its
// first-ever capture (callers skip "your site changed" on initial index), or null
// when nothing changed. One row, no version history — the deliberate simplification.
export async function recordSiteContent(
  id: string, snap: SiteContent, when?: string
): Promise<{ site: Member; isFirst: boolean } | null> {
  const prev = (await pool.query("SELECT content_hash FROM members WHERE id = $1", [id])).rows[0];
  if (!prev) return null;
  const wasFirst = prev.content_hash == null;
  if (prev.content_hash === snap.hash) return null;   // unchanged → no-op
  const edited = when || now();
  await pool.query(
    `UPDATE members
        SET content_hash = $2, thumbnail = $3, last_edited = GREATEST(last_edited, $4)
      WHERE id = $1`,
    [id, snap.hash, snap.thumbnail ?? null, edited]
  );
  return { site: (await getMember(id))!, isFirst: wasFirst };
}

// All sites with a URL — for the crawler to walk.
export async function listCrawlable(): Promise<Member[]> {
  return (await pool.query("SELECT * FROM members WHERE url IS NOT NULL")).rows;
}

// ---- notifications: prefs + one-time bookkeeping -------------------------
// Overwrite a member's email prefs (the /notify page posts the full map).
export async function setNotify(id: string, prefs: Record<string, boolean>): Promise<void> {
  await pool.query("UPDATE members SET notify = $2::jsonb WHERE id = $1", [id, JSON.stringify(prefs)]);
}
// Turn OFF one notification kind — or every kind, if `kind` is omitted — by
// MERGING into the existing prefs (notify || patch), never clobbering the others.
// Backs the one-click email unsubscribe, so it must be idempotent.
export async function muteNotify(id: string, kind?: NotifyKind): Promise<void> {
  const off = kind ? { [kind]: false } : Object.fromEntries(ALL_NOTIFY_KINDS.map((k) => [k, false]));
  await pool.query("UPDATE members SET notify = notify || $2::jsonb WHERE id = $1", [id, JSON.stringify(off)]);
}
// Atomically record that a one-time email (a milestone, the activation nudge) was
// sent. Returns true only the FIRST time for a given key — so callers send exactly
// once even under concurrent triggers (e.g. two views landing on the 100th).
export async function markNotified(id: string, key: string): Promise<boolean> {
  const r = await pool.query(
    `UPDATE members SET notified = notified || jsonb_build_object($2, true)
      WHERE id = $1 AND NOT (notified ? $2) RETURNING id`,
    [id, key]
  );
  return r.rowCount === 1;
}
// Followers of a site that have an email — recipients for "a site you follow updated".
export async function listFollowersWithEmail(targetId: string): Promise<Member[]> {
  return (await pool.query(
    `SELECT m.* FROM edges e JOIN members m ON m.id = e.follower_id
      WHERE e.target_id = $1 AND m.email IS NOT NULL`,
    [targetId]
  )).rows;
}
// Members who signed up but never verified a site (no widget yet) and haven't been
// nudged — for the activation sweep. `before` gates on signup age so we don't nudge
// someone mid-onboarding.
export async function listUnactivated(before: string, limit = 200): Promise<Member[]> {
  return (await pool.query(
    `SELECT * FROM members
      WHERE onboarded = TRUE AND verified = FALSE AND email IS NOT NULL
        AND created < $1 AND NOT (notified ? 'activation')
      LIMIT $2`,
    [before, limit]
  )).rows;
}

// ---- avatars (uploaded profile pictures) ---------------------------------
// Stored as raw bytes, addressed by member id, served at /avatars/<id> (see
// server/app.ts). Kept out of the members row so SELECT * and every list/card
// payload stay lean — the widget only ever ships the short avatar URL.
export async function setAvatar(memberId: string, bytes: Buffer, mime: string): Promise<void> {
  await pool.query(
    `INSERT INTO avatars (member_id, bytes, mime, updated) VALUES ($1, $2, $3, $4)
     ON CONFLICT (member_id) DO UPDATE SET bytes = EXCLUDED.bytes, mime = EXCLUDED.mime, updated = EXCLUDED.updated`,
    [memberId, bytes, mime, now()]
  );
}
export async function getAvatar(memberId: string): Promise<{ bytes: Buffer; mime: string } | undefined> {
  return (await pool.query("SELECT bytes, mime FROM avatars WHERE member_id = $1", [memberId])).rows[0];
}

// ---- visits (per-viewer "new" badge) -------------------------------------
export async function recordVisit(viewerId: string, targetId: string): Promise<void> {
  await pool.query(
    `INSERT INTO visits (viewer_id, target_id, last_seen) VALUES ($1, $2, $3)
     ON CONFLICT (viewer_id, target_id) DO UPDATE SET last_seen = EXCLUDED.last_seen`,
    [viewerId, targetId, now()]
  );
}

// ---- comments / notes ----------------------------------------------------
export type Visibility = "public" | "private";
type db_CommentRow = {
  id: string; body: string; visibility: Visibility; created: string;
  author_id: string | null; author_name: string | null; author_handle: string | null;
  author_avatar: string | null; author_url: string | null;
};
type db_InboxRow = db_CommentRow & { target_handle: string | null; target_name: string };

export async function addComment(c: {
  id: string; target_id: string; author_id: string | null; body: string; visibility?: Visibility; created?: string;
}): Promise<void> {
  await pool.query(
    "INSERT INTO comments (id, target_id, author_id, body, visibility, created) VALUES ($1, $2, $3, $4, $5, $6)",
    [c.id, c.target_id, c.author_id, c.body, c.visibility === "private" ? "private" : "public", c.created ?? now()]
  );
}
// Comments joined with their author's public identity — so each comment can
// link back to the commenter's own blog (the traversal hook). Returns ALL rows
// incl. private; the API layer decides what to redact for the viewer.
export async function listComments(targetId: string, limit = 200): Promise<db_CommentRow[]> {
  const r = await pool.query(
    `SELECT c.id, c.body, c.visibility, c.created,
            m.id AS author_id, m.name AS author_name, m.handle AS author_handle,
            m.avatar AS author_avatar, m.url AS author_url
       FROM comments c LEFT JOIN members m ON m.id = c.author_id
      WHERE c.target_id = $1
      ORDER BY c.created ASC
      LIMIT $2`,
    [targetId, limit]
  );
  return r.rows;
}
// Every note left on the given member's site (public + private), for the owner's
// pigeon box. Includes which site each was left on (a member may own several).
export async function listInbox(ownerId: string, limit = 500): Promise<db_InboxRow[]> {
  const r = await pool.query(
    `SELECT c.id, c.body, c.visibility, c.created,
            m.id AS author_id, m.name AS author_name, m.handle AS author_handle,
            m.avatar AS author_avatar, m.url AS author_url,
            t.handle AS target_handle, t.name AS target_name
       FROM comments c
       LEFT JOIN members m ON m.id = c.author_id
       JOIN members t ON t.id = c.target_id
      WHERE c.target_id = $1
      ORDER BY c.created DESC
      LIMIT $2`,
    [ownerId, limit]
  );
  return r.rows;
}

// ---- following list ------------------------------------------------------
// The members someone follows, with public identity — powers "blogs you follow".
// `isNew` = the site was edited after this viewer last opened it (or never
// opened). Freshest-edited sites float to the top so the feed feels alive.
export type FollowedSite = Member & { isNew: boolean };
export async function listFollowing(memberId: string): Promise<FollowedSite[]> {
  const r = await pool.query(
    `SELECT m.*,
            (m.last_edited IS NOT NULL
             AND (v.last_seen IS NULL OR m.last_edited > v.last_seen)) AS "isNew"
       FROM edges e
       JOIN members m ON m.id = e.target_id
       LEFT JOIN visits v ON v.viewer_id = $1 AND v.target_id = m.id
      WHERE e.follower_id = $1
      ORDER BY (m.last_edited IS NOT NULL) DESC, m.last_edited DESC NULLS LAST, e.created DESC`,
    [memberId]
  );
  return r.rows;
}

// The members who follow YOU, each tagged with whether you follow them back and
// when they followed — the real source for the "Follow back" rail (people who
// followed you, not merely viewed you). Newest follow first.
export type FollowerRow = Identity & { followedAt: string; viewerFollows: boolean };
export async function followers(memberId: string, limit = 50): Promise<FollowerRow[]> {
  const r = await pool.query(
    `SELECT m.id, m.handle, m.name, m.avatar, m.url,
            e.created                    AS "followedAt",
            (back.follower_id IS NOT NULL) AS "viewerFollows"
       FROM edges e
       JOIN members m ON m.id = e.follower_id
       LEFT JOIN edges back ON back.follower_id = $1 AND back.target_id = m.id
      WHERE e.target_id = $1
      ORDER BY e.created DESC
      LIMIT $2`,
    [memberId, limit]
  );
  return r.rows;
}

export type SiteCard = Member & {
  isNew?: boolean;
  saved_count?: number;
  follower_count?: number;
  mutual_count?: number;
};

export async function listSaved(memberId: string): Promise<SiteCard[]> {
  const r = await pool.query(
    `SELECT m.*,
            COUNT(DISTINCT all_saves.member_id)::int AS saved_count,
            COUNT(DISTINCT followers.follower_id)::int AS follower_count
       FROM saves viewer_saves
       JOIN members m ON m.id = viewer_saves.target_id
       LEFT JOIN saves all_saves ON all_saves.target_id = m.id
       LEFT JOIN edges followers ON followers.target_id = m.id
      WHERE viewer_saves.member_id = $1
      GROUP BY m.id, viewer_saves.created
      ORDER BY viewer_saves.created DESC`,
    [memberId]
  );
  return r.rows;
}

export async function listMostSaved(limit = 12): Promise<SiteCard[]> {
  const r = await pool.query(
    `SELECT m.*,
            COUNT(DISTINCT s.member_id)::int AS saved_count,
            COUNT(DISTINCT e.follower_id)::int AS follower_count
       FROM members m
       LEFT JOIN saves s ON s.target_id = m.id
       LEFT JOIN edges e ON e.target_id = m.id
      GROUP BY m.id
      ORDER BY saved_count DESC, m.views DESC, follower_count DESC
      LIMIT $1`,
    [limit]
  );
  return r.rows;
}

export async function listRecommended(memberId: string, limit = 12): Promise<SiteCard[]> {
  const r = await pool.query(
    `WITH mine AS (
       SELECT target_id FROM edges WHERE follower_id = $1
     ),
     friends AS (
       SELECT target_id FROM edges WHERE follower_id = $1
     ),
     friend_follows AS (
       SELECT e.target_id, COUNT(DISTINCT e.follower_id)::int AS mutual_count
         FROM edges e
         JOIN friends f ON f.target_id = e.follower_id
        WHERE e.target_id <> $1
        GROUP BY e.target_id
     )
     SELECT m.*,
            COALESCE(ff.mutual_count, 0)::int AS mutual_count,
            COUNT(DISTINCT s.member_id)::int AS saved_count,
            COUNT(DISTINCT followers.follower_id)::int AS follower_count
       FROM members m
       LEFT JOIN friend_follows ff ON ff.target_id = m.id
       LEFT JOIN saves s ON s.target_id = m.id
       LEFT JOIN edges followers ON followers.target_id = m.id
       LEFT JOIN mine ON mine.target_id = m.id
      WHERE m.id <> $1 AND mine.target_id IS NULL
      GROUP BY m.id, ff.mutual_count
      ORDER BY mutual_count DESC, saved_count DESC, m.views DESC
      LIMIT $2`,
    [memberId, limit]
  );
  return r.rows;
}

export async function listOutgoing(authorId: string, limit = 500): Promise<Array<{
  id: string; body: string; visibility: Visibility; created: string;
  target_id: string; target_name: string; target_handle: string | null;
  target_avatar: string | null; target_url: string | null;
}>> {
  const r = await pool.query(
    `SELECT c.id, c.body, c.visibility, c.created,
            t.id AS target_id, t.name AS target_name, t.handle AS target_handle,
            t.avatar AS target_avatar, t.url AS target_url
       FROM comments c
       JOIN members t ON t.id = c.target_id
      WHERE c.author_id = $1
      ORDER BY c.created DESC
      LIMIT $2`,
    [authorId, limit]
  );
  return r.rows;
}

// ---- direct messages (DMs) -----------------------------------------------
export type Message = {
  id: string; sender_id: string; recipient_id: string;
  body: string; created: string; edited: string | null; deleted: boolean; read: boolean;
};
export type MsgReaction = { emoji: string; member_id: string };
export type ThreadMessage = Message & { reactions: MsgReaction[] };
// One inbox row: the other member + the last line exchanged + how many of theirs
// the viewer hasn't read.
export type Conversation = {
  peer_id: string; handle: string | null; name: string; avatar: string | null; url: string | null;
  last_body: string; last_at: string; last_sender: string; last_deleted: boolean; unread: number;
};

export async function getMessage(id: string): Promise<Message | undefined> {
  return (await pool.query("SELECT * FROM messages WHERE id = $1", [id])).rows[0];
}

export async function sendMessage(m: {
  id: string; sender_id: string; recipient_id: string; body: string;
}): Promise<Message> {
  await pool.query(
    "INSERT INTO messages (id, sender_id, recipient_id, body, created) VALUES ($1, $2, $3, $4, $5)",
    [m.id, m.sender_id, m.recipient_id, m.body, now()]
  );
  return (await getMessage(m.id))!;
}

// Edit a message's body (sender-only — enforced in the API). Stamps `edited`, which
// drives the "edited" hint; a no-op on an already-deleted row.
export async function editMessage(id: string, body: string): Promise<Message | undefined> {
  await pool.query("UPDATE messages SET body = $2, edited = $3 WHERE id = $1 AND deleted = FALSE", [id, body, now()]);
  return getMessage(id);
}

// Soft-delete: blank the body but keep the row (so the thread keeps its shape) and
// drop its reactions — a deleted message can't stay reacted-to.
export async function deleteMessage(id: string): Promise<Message | undefined> {
  await pool.query("UPDATE messages SET deleted = TRUE, body = '', edited = NULL WHERE id = $1", [id]);
  await pool.query("DELETE FROM message_reactions WHERE message_id = $1", [id]);
  return getMessage(id);
}

// Mark every message FROM `peer` TO `viewer` read — called when the viewer opens the
// thread. The inbox recomputes its unread counts from this.
export async function markThreadRead(viewerId: string, peerId: string): Promise<void> {
  await pool.query(
    "UPDATE messages SET read = TRUE WHERE recipient_id = $1 AND sender_id = $2 AND read = FALSE",
    [viewerId, peerId]
  );
}

// How many unread messages the recipient already has from this sender — so the API
// can email only on the FIRST unread (a burst of messages is one notification, not N).
export async function unreadFrom(recipientId: string, senderId: string): Promise<number> {
  return (await pool.query(
    "SELECT COUNT(*)::int AS c FROM messages WHERE recipient_id = $1 AND sender_id = $2 AND read = FALSE AND deleted = FALSE",
    [recipientId, senderId]
  )).rows[0].c;
}

export async function listReactions(messageId: string): Promise<MsgReaction[]> {
  return (await pool.query(
    "SELECT emoji, member_id FROM message_reactions WHERE message_id = $1 ORDER BY created ASC",
    [messageId]
  )).rows;
}

// Toggle one emoji by `memberId` on a message; returns the message's full reaction
// set afterward. A second tap of the same emoji removes it.
export async function toggleMessageReaction(messageId: string, memberId: string, emoji: string): Promise<MsgReaction[]> {
  const existing = await pool.query(
    "SELECT 1 FROM message_reactions WHERE message_id = $1 AND member_id = $2 AND emoji = $3",
    [messageId, memberId, emoji]
  );
  if (existing.rowCount) {
    await pool.query("DELETE FROM message_reactions WHERE message_id = $1 AND member_id = $2 AND emoji = $3", [messageId, memberId, emoji]);
  } else {
    await pool.query(
      "INSERT INTO message_reactions (message_id, member_id, emoji, created) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
      [messageId, memberId, emoji, now()]
    );
  }
  return listReactions(messageId);
}

// The full conversation between two members (either direction), oldest-first, each
// message carrying its reactions. Two queries (messages, then their reactions),
// stitched in memory — keeps the SQL simple and the payload exact.
export async function listThread(a: string, b: string, limit = 500): Promise<ThreadMessage[]> {
  const msgs = (await pool.query(
    `SELECT * FROM messages
      WHERE (sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1)
      ORDER BY created ASC
      LIMIT $3`,
    [a, b, limit]
  )).rows as Message[];
  if (!msgs.length) return [];
  const reacts = (await pool.query(
    "SELECT message_id, emoji, member_id FROM message_reactions WHERE message_id = ANY($1) ORDER BY created ASC",
    [msgs.map((m) => m.id)]
  )).rows as Array<MsgReaction & { message_id: string }>;
  return msgs.map((m) => ({
    ...m,
    reactions: reacts.filter((r) => r.message_id === m.id).map((r) => ({ emoji: r.emoji, member_id: r.member_id })),
  }));
}

// The viewer's inbox: one row per person they've messaged with, newest activity
// first — the other member's identity, the last line (or its deleted flag), who
// sent it, and how many of their messages the viewer hasn't read.
export async function listConversations(viewerId: string): Promise<Conversation[]> {
  return (await pool.query(
    `WITH convo AS (
       SELECT CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END AS peer_id,
              body, created, sender_id, deleted
         FROM messages
        WHERE sender_id = $1 OR recipient_id = $1
     ),
     latest AS (
       SELECT DISTINCT ON (peer_id) peer_id, body, created, sender_id, deleted
         FROM convo
        ORDER BY peer_id, created DESC
     ),
     unread AS (
       SELECT sender_id AS peer_id, COUNT(*)::int AS n
         FROM messages
        WHERE recipient_id = $1 AND read = FALSE AND deleted = FALSE
        GROUP BY sender_id
     )
     SELECT m.id AS peer_id, m.handle, m.name, m.avatar, m.url,
            l.body AS last_body, l.created AS last_at, l.sender_id AS last_sender,
            l.deleted AS last_deleted, COALESCE(u.n, 0)::int AS unread
       FROM latest l
       JOIN members m ON m.id = l.peer_id
       LEFT JOIN unread u ON u.peer_id = l.peer_id
      ORDER BY l.created DESC`,
    [viewerId]
  )).rows;
}

// ---- sessions ------------------------------------------------------------
export async function createSession(memberId: string, ttlSec = SESSION_TTL_SEC): Promise<string> {
  const t = token();
  const expires = new Date(Date.now() + ttlSec * 1000).toISOString();
  await pool.query("INSERT INTO sessions (token, member_id, created, expires) VALUES ($1, $2, $3, $4)",
    [t, memberId, now(), expires]);
  return t;
}
export async function getSessionMember(tok?: string): Promise<Member | undefined> {
  if (!tok) return undefined;
  const s = (await pool.query("SELECT member_id, expires FROM sessions WHERE token = $1", [tok])).rows[0];
  if (!s) return undefined;
  if (new Date(s.expires) < new Date()) {
    await pool.query("DELETE FROM sessions WHERE token = $1", [tok]);
    return undefined;
  }
  return getMember(s.member_id);
}
export async function deleteSession(tok: string): Promise<void> {
  await pool.query("DELETE FROM sessions WHERE token = $1", [tok]);
}

// ---- magic links ---------------------------------------------------------
export async function createMagicLink(email: string, ttlSec = 60 * 15): Promise<string> {
  const t = token();
  const expires = new Date(Date.now() + ttlSec * 1000).toISOString();
  await pool.query("INSERT INTO magic_links (token, email, created, expires) VALUES ($1, $2, $3, $4)",
    [t, email, now(), expires]);
  return t;
}
export async function consumeMagicLink(tok: string): Promise<string | undefined> {
  const m = (await pool.query("SELECT email, expires, consumed FROM magic_links WHERE token = $1", [tok])).rows[0];
  if (!m || m.consumed || new Date(m.expires) < new Date()) return undefined;
  await pool.query("UPDATE magic_links SET consumed = TRUE WHERE token = $1", [tok]);
  return m.email;
}

// ---- cohorts ("crews": closed groups) ------------------------------------
// A class-sized cap. Bounds the O(n) follow wiring per join (and the n² edges a
// full crew accrues), and keeps a crew intimate rather than a broadcast list.
export const COHORT_MAX = 60;
export const COHORT_NAME_MAX = 60;

export type Cohort = { id: string; name: string; code: string; owner_id: string; created: string };
export type CohortMember = Identity & { role: string; created: string };
export type CohortSummary = Cohort & { role: string; memberCount: number; faces: Identity[] };

export async function getCohort(id: string): Promise<Cohort | undefined> {
  return (await pool.query("SELECT * FROM cohorts WHERE id = $1", [id])).rows[0];
}
export async function getCohortByCode(code: string): Promise<Cohort | undefined> {
  return (await pool.query("SELECT * FROM cohorts WHERE code = $1", [code])).rows[0];
}
export async function isCohortMember(cohortId: string, memberId: string): Promise<boolean> {
  return (await pool.query(
    "SELECT 1 FROM cohort_members WHERE cohort_id = $1 AND member_id = $2", [cohortId, memberId]
  )).rowCount! > 0;
}
export async function countCohortMembers(cohortId: string): Promise<number> {
  return (await pool.query("SELECT COUNT(*)::int AS c FROM cohort_members WHERE cohort_id = $1", [cohortId])).rows[0].c;
}

// Create a crew and seat its creator as owner + first member, atomically.
export async function createCohort(o: { id: string; name: string; code: string; ownerId: string }): Promise<Cohort> {
  await pool.query("BEGIN");
  try {
    await pool.query(
      "INSERT INTO cohorts (id, name, code, owner_id, created) VALUES ($1, $2, $3, $4, $5)",
      [o.id, o.name, o.code, o.ownerId, now()]
    );
    await pool.query(
      "INSERT INTO cohort_members (cohort_id, member_id, role, created) VALUES ($1, $2, 'owner', $3)",
      [o.id, o.ownerId, now()]
    );
    await pool.query("COMMIT");
  } catch (e) {
    await pool.query("ROLLBACK");
    throw e;
  }
  return (await getCohort(o.id))!;
}

// Add a member (idempotent). Follow wiring is a separate step (wireCohortFollows),
// so re-adding an existing member never re-triggers it.
export async function addCohortMember(cohortId: string, memberId: string, role = "member"): Promise<void> {
  await pool.query(
    `INSERT INTO cohort_members (cohort_id, member_id, role, created) VALUES ($1, $2, $3, $4)
     ON CONFLICT (cohort_id, member_id) DO NOTHING`,
    [cohortId, memberId, role, now()]
  );
}

// The cohort contract: everyone in a crew follows everyone. On a real join we add
// the mutual follow edges between the newcomer and every existing member — so the
// newcomer's feed is alive at once, and every member gains them. One bulk upsert:
// idempotent (an existing edge is left intact),
// self excluded, and bounded by COHORT_MAX. Leaving a crew does NOT undo these — a
// follow, once made, is the member's to keep or drop.
export async function wireCohortFollows(cohortId: string, memberId: string): Promise<void> {
  const others = (await pool.query(
    "SELECT member_id FROM cohort_members WHERE cohort_id = $1 AND member_id <> $2 LIMIT $3",
    [cohortId, memberId, COHORT_MAX]
  )).rows.map((r: { member_id: string }) => r.member_id as string);
  if (!others.length) return;
  // Flat [follower, target, follower, target, …] for one parametrized multi-row
  // insert: both directions (me→other, other→me) for each existing member.
  const flat: string[] = [];
  for (const o of others) { flat.push(memberId, o, o, memberId); }
  const tupleCount = flat.length / 2;
  const tuples = Array.from({ length: tupleCount }, (_, i) =>
    `($${2 * i + 1}, $${2 * i + 2}, $${flat.length + 1})`).join(", ");
  await pool.query(
    `INSERT INTO edges (follower_id, target_id, created) VALUES ${tuples}
     ON CONFLICT (follower_id, target_id) DO NOTHING`,
    [...flat, now()]
  );
}

// A crew's members with public identity + role (owner first, then join order) —
// the roster the app + invite page render.
export async function listCohortMembers(cohortId: string): Promise<CohortMember[]> {
  return (await pool.query(
    `SELECT m.id, m.handle, m.name, m.avatar, m.url, cm.role, cm.created
       FROM cohort_members cm JOIN members m ON m.id = cm.member_id
      WHERE cm.cohort_id = $1
      ORDER BY (cm.role = 'owner') DESC, cm.created ASC`,
    [cohortId]
  )).rows;
}

// A small facepile for a crew (owner first, then join order) — for the dashboard
// summary and the invite preview.
async function cohortFaces(cohortId: string, limit: number): Promise<Identity[]> {
  return (await pool.query(
    `SELECT m.id, m.handle, m.name, m.avatar, m.url
       FROM cohort_members cm JOIN members m ON m.id = cm.member_id
      WHERE cm.cohort_id = $1
      ORDER BY (cm.role = 'owner') DESC, cm.created ASC
      LIMIT $2`,
    [cohortId, limit]
  )).rows;
}

// The crews a member is in — each with a facepile, total count, and the viewer's
// own role. Newest crew first.
export async function listCohortsForMember(memberId: string): Promise<CohortSummary[]> {
  const rows = (await pool.query(
    `SELECT c.id, c.name, c.code, c.owner_id, c.created, mine.role,
            (SELECT COUNT(*)::int FROM cohort_members cm WHERE cm.cohort_id = c.id) AS member_count
       FROM cohort_members mine JOIN cohorts c ON c.id = mine.cohort_id
      WHERE mine.member_id = $1
      ORDER BY c.created DESC`,
    [memberId]
  )).rows as Array<Cohort & { role: string; member_count: number }>;
  const out: CohortSummary[] = [];
  for (const c of rows) {
    out.push({
      id: c.id, name: c.name, code: c.code, owner_id: c.owner_id, created: c.created,
      role: c.role, memberCount: c.member_count, faces: await cohortFaces(c.id, 5),
    });
  }
  return out;
}

// Resolve an invite code to a public preview (name + count + a few faces) — what
// the /join page shows BEFORE the visitor signs in (the "your friends are here"
// incentive). No membership required.
export async function cohortPreview(
  code: string
): Promise<{ cohort: Cohort; memberCount: number; faces: Identity[] } | undefined> {
  const cohort = await getCohortByCode(code);
  if (!cohort) return undefined;
  return { cohort, memberCount: await countCohortMembers(cohort.id), faces: await cohortFaces(cohort.id, 6) };
}

// Leave a crew. Membership only — the follow edges the member made stay theirs. If
// the owner leaves, ownership passes to the earliest remaining member; an empty
// crew is deleted. Idempotent: leaving a crew you're not in is a no-op.
export async function leaveCohort(cohortId: string, memberId: string): Promise<void> {
  await pool.query("BEGIN");
  try {
    await pool.query("DELETE FROM cohort_members WHERE cohort_id = $1 AND member_id = $2", [cohortId, memberId]);
    const next = (await pool.query(
      "SELECT member_id FROM cohort_members WHERE cohort_id = $1 ORDER BY (role = 'owner') DESC, created ASC LIMIT 1",
      [cohortId]
    )).rows[0] as { member_id: string } | undefined;
    if (!next) {
      await pool.query("DELETE FROM cohorts WHERE id = $1", [cohortId]);
    } else {
      // Keep exactly one owner: promote the front-runner. A no-op when the owner
      // stayed and a plain member left (next is the same owner).
      await pool.query("UPDATE cohorts SET owner_id = $1 WHERE id = $2", [next.member_id, cohortId]);
      await pool.query(
        "UPDATE cohort_members SET role = 'owner' WHERE cohort_id = $1 AND member_id = $2",
        [cohortId, next.member_id]
      );
    }
    await pool.query("COMMIT");
  } catch (e) {
    await pool.query("ROLLBACK");
    throw e;
  }
}
