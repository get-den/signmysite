/*
 * Data layer — the ONE place that talks to Postgres.
 *
 * Everything else depends only on the exported async functions, so the storage
 * engine stays swappable. Raw SQL, no ORM: minimal and transparent.
 */
import pg from "pg";
import { now, token } from "./util.ts";

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
  -- Points at the live row in 'snapshots' (the newest version). NULL until the
  -- first capture; the member_cards view reads the live thumbnail through it.
  current_snapshot_id TEXT,
  -- has the member finished the signup wizard (username + optional site)?
  -- defaults TRUE so existing rows aren't sent back through onboarding; new
  -- members are inserted with FALSE (see createMember).
  onboarded   BOOLEAN NOT NULL DEFAULT TRUE,
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
-- migrate older installs in place (idempotent)
ALTER TABLE members ADD COLUMN IF NOT EXISTS google_sub TEXT UNIQUE;
ALTER TABLE members ADD COLUMN IF NOT EXISTS views INTEGER NOT NULL DEFAULT 0;
ALTER TABLE members ADD COLUMN IF NOT EXISTS last_edited TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS current_snapshot_id TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS onboarded BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE members ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE members ADD COLUMN IF NOT EXISTS notify JSONB NOT NULL DEFAULT '{}';
ALTER TABLE members ADD COLUMN IF NOT EXISTS notified JSONB NOT NULL DEFAULT '{}';
ALTER TABLE members ADD COLUMN IF NOT EXISTS links JSONB NOT NULL DEFAULT '[]';
-- Prominence: a manual fame tier used to rank a member among someone's followers
-- (the "Followed by …" facepile). An ORDERED enum, so ORDER BY sorts it directly;
-- it's an OVERRIDE layered on the page-view heuristic (we sort by prominence, then
-- views). Set by hand, e.g. UPDATE members SET prominence='famous' WHERE handle='pg'.
DO $$ BEGIN
  CREATE TYPE prominence AS ENUM ('normal', 'notable', 'famous');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE members ADD COLUMN IF NOT EXISTS prominence prominence NOT NULL DEFAULT 'normal';

-- Every captured version of a site's front page — append-only history. The newest
-- row per member is the "live" one (members.current_snapshot_id points at it); the
-- rest are the timeline. We append only when the (normalized) content hash actually
-- changes, so a static site never grows a no-op row. Each version keeps its OWN
-- thumbnail/title/excerpt, so history stays truthful even after the owner later
-- swaps the og:image the live thumbnail was sourced from.
CREATE TABLE IF NOT EXISTS snapshots (
  id           TEXT PRIMARY KEY,
  member_id    TEXT NOT NULL,
  content_hash TEXT NOT NULL,   -- normalized page hash; the dedupe key vs the previous version
  thumbnail    TEXT,            -- preview image for THIS version (og:image today, screenshot later)
  title        TEXT,            -- og:title / <title> at capture
  excerpt      TEXT,            -- og:description / meta description at capture
  captured     TEXT NOT NULL    -- when we first observed this version
);
CREATE INDEX IF NOT EXISTS snapshots_member ON snapshots (member_id, captured DESC);

-- One-time migration off the old in-place columns: fold each member's last-known
-- thumbnail + hash into a first snapshot, then drop the columns. Guarded so it only
-- runs on installs that still have them (fresh databases skip it entirely).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'members' AND column_name = 'thumbnail') THEN
    INSERT INTO snapshots (id, member_id, content_hash, thumbnail, title, excerpt, captured)
      SELECT 'snap_legacy_' || m.id, m.id, COALESCE(m.content_hash, ''), m.thumbnail, NULL, NULL,
             COALESCE(m.last_edited, m.created)
        FROM members m
       WHERE m.thumbnail IS NOT NULL OR m.content_hash IS NOT NULL
      ON CONFLICT (id) DO NOTHING;
    UPDATE members SET current_snapshot_id = 'snap_legacy_' || id
      WHERE current_snapshot_id IS NULL AND (thumbnail IS NOT NULL OR content_hash IS NOT NULL);
    ALTER TABLE members DROP COLUMN thumbnail;
    ALTER TABLE members DROP COLUMN content_hash;
  END IF;
END $$;

-- Read model: a member flattened together with its live snapshot's thumbnail, so
-- every read can keep selecting a single row and find 'thumbnail' where it always
-- was. Writes target the base tables (members + snapshots); reads come from here.
-- DROP+CREATE (not REPLACE) so it survives any future change to the members columns.
DROP VIEW IF EXISTS member_cards;
CREATE VIEW member_cards AS
  SELECT m.*, s.thumbnail
    FROM members m
    LEFT JOIN snapshots s ON s.id = m.current_snapshot_id;

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
-- widget impression: WHO (viewer_id, set only when the visitor is a signed-in Den
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

CREATE TABLE IF NOT EXISTS edges (
  follower_id TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  rel         TEXT NOT NULL DEFAULT 'follow',
  created     TEXT NOT NULL,
  PRIMARY KEY (follower_id, target_id)
);
CREATE INDEX IF NOT EXISTS edges_target ON edges (target_id);
CREATE TABLE IF NOT EXISTS saves (
  member_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  created   TEXT NOT NULL,
  PRIMARY KEY (member_id, target_id)
);
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
CREATE TABLE IF NOT EXISTS comments (
  id         TEXT PRIMARY KEY,
  target_id  TEXT NOT NULL,
  author_id  TEXT NOT NULL,
  body       TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'public',  -- 'public' | 'private'
  created    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_target ON comments (target_id, created);
ALTER TABLE comments ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public';
-- Reactions (emoji taps) can be left anonymously, with no account behind them.
ALTER TABLE comments ALTER COLUMN author_id DROP NOT NULL;
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
const connectionString = process.env.DATABASE_URL || "postgres:///den";
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
await pool.query(SCHEMA);

export const SESSION_TTL_SEC = 60 * 60 * 24 * 400;

// Wipe all data — for local dev / tests / seeding a clean slate.
export async function reset(): Promise<void> {
  await pool.query("TRUNCATE members, snapshots, edges, saves, pins, comments, sessions, magic_links, visits, page_views, avatars, cohorts, cohort_members");
}

// Manual fame tier (the prominence enum). Ordered: famous > notable > normal.
export type Prominence = "normal" | "notable" | "famous";
// A compact identity for facepiles ("Followed by …", mutuals) — just what a small
// avatar+name chip needs.
export type Identity = { id: string; handle: string | null; name: string; avatar: string | null; url: string | null };
export type Member = {
  id: string; handle: string | null; name: string; email: string | null;
  google_sub: string | null; url: string | null; avatar: string | null;
  views: number; last_edited: string | null; prominence: Prominence;
  current_snapshot_id: string | null;
  thumbnail: string | null;   // from the member_cards view (the live snapshot's image)
  onboarded: boolean; verified: boolean;
  notify: Record<string, boolean>;    // email prefs: per-kind override ({} = all on)
  notified: Record<string, boolean>;  // one-time emails already sent (milestones, activation)
  links: string[];                    // external/social profile URLs (presentation derived per-URL)
  created: string;
};
// The email kinds a member can mute (the /notify page renders one toggle each).
export type NotifyKind =
  | "follow" | "save" | "comment" | "reaction"
  | "followedUpdate" | "siteUpdated" | "milestone";
// Does this member want `kind` emails? Default on — only an explicit false mutes.
export const wantsNotify = (m: { notify?: Record<string, boolean> }, kind: NotifyKind): boolean =>
  m.notify?.[kind] !== false;
// One captured version of a site's front page (see the snapshots table).
export type Snapshot = {
  id: string; member_id: string; content_hash: string;
  thumbnail: string | null; title: string | null; excerpt: string | null; captured: string;
};
export type Stats = {
  views: number; followers: number; following: number; saved: number; pinned: number;
  viewerFollows: boolean; viewerSaved: boolean; viewerPinned: boolean;
};
// A Den member who has viewed your site, with the relation that makes analytics
// relational: whether you already follow them (and they you). `views` is how many
// times they've opened your site in the window; `lastSeen` is the most recent.
export type ViewerVisit = {
  id: string; handle: string | null; name: string; avatar: string | null; url: string | null;
  views: number; lastSeen: string; viewerFollows: boolean; followsYou: boolean;
};
// The owner's analytics: headline counts, the real average engaged time (finally
// not a placeholder), and the named Den members behind the anonymous view total.
export type Analytics = {
  views: number;          // all-time running total (members.views)
  visitors: number;       // distinct sessions in the window
  knownVisitors: number;  // distinct signed-in Den members in the window
  avgDurationMs: number | null;
  recent: ViewerVisit[];
};
export type Comment = {
  id: string; target_id: string; author_id: string; body: string; created: string;
};

// ---- members -------------------------------------------------------------
// Reads go through member_cards (members + the live snapshot's thumbnail); writes
// target the base members table.
export async function getMember(id: string): Promise<Member | undefined> {
  return (await pool.query("SELECT * FROM member_cards WHERE id = $1", [id])).rows[0];
}
export async function getMemberByEmail(email: string): Promise<Member | undefined> {
  return (await pool.query("SELECT * FROM member_cards WHERE email = $1", [email])).rows[0];
}
export async function getMemberByHandle(handle: string): Promise<Member | undefined> {
  return (await pool.query("SELECT * FROM member_cards WHERE handle = $1", [handle])).rows[0];
}
export async function getMemberByUrl(url: string): Promise<Member | undefined> {
  return (await pool.query(
    `SELECT * FROM member_cards WHERE url = $1
     ORDER BY (email IS NOT NULL OR google_sub IS NOT NULL) DESC, created DESC
     LIMIT 1`,
    [url]
  )).rows[0];
}
export async function getMemberByGoogleSub(sub: string): Promise<Member | undefined> {
  return (await pool.query("SELECT * FROM member_cards WHERE google_sub = $1", [sub])).rows[0];
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
// Columns a patch may write. Excludes id/created and the view-only `thumbnail`
// (which lives on snapshots) — so a Partial<Member> can't accidentally generate
// SQL against a column that no longer exists on the base table.
const MUTABLE_MEMBER_COLS = new Set([
  "handle", "name", "email", "google_sub", "url", "avatar", "links",
  "views", "last_edited", "current_snapshot_id", "onboarded", "verified", "prominence",
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

export async function claimUnclaimedMember(targetId: string, sourceId: string): Promise<Member | undefined> {
  if (targetId === sourceId) return getMember(targetId);
  const target = await getMember(targetId);
  const source = await getMember(sourceId);
  if (!target || !source || target.email || target.google_sub) return undefined;

  await pool.query("BEGIN");
  try {
    await pool.query("UPDATE members SET email = NULL, google_sub = NULL WHERE id = $1", [sourceId]);
    await pool.query(
      `UPDATE members
          SET email = $2,
              google_sub = $3,
              avatar = COALESCE(avatar, $4)
        WHERE id = $1`,
      [targetId, source.email, source.google_sub, source.avatar]
    );
    await pool.query("UPDATE sessions SET member_id = $1 WHERE member_id = $2", [targetId, sourceId]);
    await pool.query("UPDATE comments SET author_id = $1 WHERE author_id = $2", [targetId, sourceId]);
    await pool.query("UPDATE comments SET target_id = $1 WHERE target_id = $2", [targetId, sourceId]);
    await moveEdges(sourceId, targetId);
    await movePairs("saves", "member_id", "target_id", sourceId, targetId);
    await movePairs("pins", "member_id", "target_id", sourceId, targetId);
    await moveVisits(sourceId, targetId);
    // Reparent any history the source accrued so deleting it orphans nothing; the
    // target keeps its own current_snapshot_id as the live version.
    await pool.query("UPDATE snapshots SET member_id = $1 WHERE member_id = $2", [targetId, sourceId]);
    // Cohort memberships + ownership follow the surviving id. (An unclaimed member
    // is never in a crew in practice — joining needs a session — but remap anyway
    // so a merge can't orphan a membership or leave a dangling owner.) The NOT
    // EXISTS guard avoids a PK clash when the target is already in that cohort.
    await pool.query(
      `UPDATE cohort_members SET member_id = $1
        WHERE member_id = $2
          AND NOT EXISTS (SELECT 1 FROM cohort_members x WHERE x.cohort_id = cohort_members.cohort_id AND x.member_id = $1)`,
      [targetId, sourceId]
    );
    await pool.query("DELETE FROM cohort_members WHERE member_id = $1", [sourceId]);
    await pool.query("UPDATE cohorts SET owner_id = $1 WHERE owner_id = $2", [targetId, sourceId]);
    await pool.query("DELETE FROM members WHERE id = $1", [sourceId]);
    await pool.query("COMMIT");
    return getMember(targetId);
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }
}

async function movePairs(table: string, left: string, right: string, sourceId: string, targetId: string): Promise<void> {
  await pool.query(
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
  await pool.query(`DELETE FROM ${table} WHERE ${left} = $1 OR ${right} = $1`, [sourceId]);
}

async function moveEdges(sourceId: string, targetId: string): Promise<void> {
  await pool.query(
    `INSERT INTO edges (follower_id, target_id, rel, created)
     SELECT CASE WHEN follower_id = $1 THEN $2 ELSE follower_id END,
            CASE WHEN target_id = $1 THEN $2 ELSE target_id END,
            rel,
            created
       FROM edges
      WHERE (follower_id = $1 OR target_id = $1)
        AND NOT (follower_id = $1 AND target_id = $2)
        AND NOT (follower_id = $2 AND target_id = $1)
     ON CONFLICT DO NOTHING`,
    [sourceId, targetId]
  );
  await pool.query("DELETE FROM edges WHERE follower_id = $1 OR target_id = $1", [sourceId]);
}

async function moveVisits(sourceId: string, targetId: string): Promise<void> {
  await pool.query(
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
  await pool.query("DELETE FROM visits WHERE viewer_id = $1 OR target_id = $1", [sourceId]);
}

// ---- edges (follow) ------------------------------------------------------
export async function setEdge(follower: string, target: string, rel = "follow"): Promise<void> {
  await pool.query(
    `INSERT INTO edges (follower_id, target_id, rel, created) VALUES ($1, $2, $3, $4)
     ON CONFLICT (follower_id, target_id) DO UPDATE SET rel = EXCLUDED.rel`,
    [follower, target, rel, now()]
  );
}
export async function removeEdge(follower: string, target: string): Promise<void> {
  await pool.query("DELETE FROM edges WHERE follower_id = $1 AND target_id = $2", [follower, target]);
}
export async function hasEdge(follower: string, target: string): Promise<boolean> {
  return (await pool.query("SELECT 1 FROM edges WHERE follower_id = $1 AND target_id = $2", [follower, target])).rowCount! > 0;
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
export async function setSave(member: string, target: string): Promise<void> {
  await pool.query(
    `INSERT INTO saves (member_id, target_id, created) VALUES ($1, $2, $3)
     ON CONFLICT (member_id, target_id) DO NOTHING`,
    [member, target, now()]
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
    `SELECT m.*, snap.thumbnail,
            COUNT(DISTINCT all_saves.member_id)::int AS saved_count,
            COUNT(DISTINCT followers.follower_id)::int AS follower_count
       FROM pins p
       JOIN members m ON m.id = p.target_id
       LEFT JOIN snapshots snap ON snap.id = m.current_snapshot_id
       LEFT JOIN saves all_saves ON all_saves.target_id = m.id
       LEFT JOIN edges followers ON followers.target_id = m.id
      WHERE p.member_id = $1
      GROUP BY m.id, snap.thumbnail, p.created
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
// How far back the named-visitor view looks. Counts/averages are windowed too so
// "who's reading me lately" stays current rather than all-time noise.
const ANALYTICS_WINDOW_DAYS = 30;
const windowStart = () => new Date(Date.now() - ANALYTICS_WINDOW_DAYS * 864e5).toISOString();

// Record one page view: append the event (who/where/referrer) AND bump the site's
// running counter, so every hot read stays a single-column lookup. `viewer` is set
// only when the visitor is a signed-in Den member — that's what makes the analytics
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

// The owner's relational analytics for one site. Headline counts + average engaged
// time, plus the named Den members behind the view total — each joined to the edge
// table both ways so the UI can say "follows you / you don't follow back yet". This
// is the read that turns an anonymous counter into a discovery surface.
export async function analytics(id: string): Promise<Analytics> {
  const since = windowStart();
  const [totals, recent] = await Promise.all([
    pool.query(
      `SELECT
         (SELECT views FROM members WHERE id = $1)                                          AS views,
         COUNT(DISTINCT session) FILTER (WHERE started > $2)::int                            AS visitors,
         COUNT(DISTINCT viewer_id)
           FILTER (WHERE started > $2 AND viewer_id IS NOT NULL AND viewer_id <> $1)::int    AS known,
         AVG(duration_ms) FILTER (WHERE started > $2 AND duration_ms IS NOT NULL)            AS avg_ms
       FROM page_views WHERE target_id = $1`,
      [id, since]
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
          AND pv.started > $2
        GROUP BY m.id, fo.follower_id, fi.follower_id
        ORDER BY MAX(pv.started) DESC
        LIMIT 24`,
      [id, since]
    ),
  ]);
  const t = totals.rows[0] || {};
  return {
    views: Number(t.views || 0),
    visitors: Number(t.visitors || 0),
    knownVisitors: Number(t.known || 0),
    avgDurationMs: t.avg_ms != null ? Math.round(Number(t.avg_ms)) : null,
    recent: recent.rows.map((r) => ({
      id: r.id, handle: r.handle, name: r.name, avatar: r.avatar, url: r.url,
      views: r.views, lastSeen: r.last_seen,
      viewerFollows: r.viewerFollows, followsYou: r.followsYou,
    })),
  };
}

// ---- freshness + snapshots -----------------------------------------------
// Mark a site as edited (monotonically — never moves freshness backwards). For
// owner-asserted edits with no observable content change: a ping, or me.json
// `updated`. Content changes we detect ourselves go through recordSnapshot.
export async function markEdited(id: string, when?: string): Promise<void> {
  await pool.query("UPDATE members SET last_edited = GREATEST(last_edited, $2) WHERE id = $1", [id, when || now()]);
}

export type SnapshotInput = { hash: string; thumbnail?: string | null; title?: string | null; excerpt?: string | null };
// Append a new version IFF the page content actually changed since the last one.
// On a real change it inserts a snapshot, repoints members.current_snapshot_id at
// it, and bumps last_edited. Returns the new snapshot plus whether it was the
// member's first ever (so callers can skip "your site changed" on initial index).
// Returns null when the content is unchanged — the dedupe that keeps history clean.
export async function recordSnapshot(
  id: string, snap: SnapshotInput, when?: string
): Promise<{ snapshot: Snapshot; isFirst: boolean } | null> {
  const prev = (await pool.query(
    "SELECT content_hash FROM snapshots WHERE member_id = $1 ORDER BY captured DESC LIMIT 1", [id]
  )).rows[0];
  if (prev && prev.content_hash === snap.hash) return null;
  const captured = when || now();
  const row: Snapshot = {
    id: "snap_" + token(8), member_id: id, content_hash: snap.hash,
    thumbnail: snap.thumbnail ?? null, title: snap.title ?? null, excerpt: snap.excerpt ?? null, captured,
  };
  await pool.query("BEGIN");
  try {
    await pool.query(
      `INSERT INTO snapshots (id, member_id, content_hash, thumbnail, title, excerpt, captured)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [row.id, row.member_id, row.content_hash, row.thumbnail, row.title, row.excerpt, row.captured]
    );
    await pool.query(
      "UPDATE members SET current_snapshot_id = $2, last_edited = GREATEST(last_edited, $3) WHERE id = $1",
      [id, row.id, captured]
    );
    await pool.query("COMMIT");
  } catch (e) {
    await pool.query("ROLLBACK");
    throw e;
  }
  return { snapshot: row, isFirst: !prev };
}

// A site's version history, newest first — the timeline behind the live thumbnail.
export async function listSnapshots(id: string, limit = 50): Promise<Snapshot[]> {
  return (await pool.query(
    "SELECT * FROM snapshots WHERE member_id = $1 ORDER BY captured DESC LIMIT $2", [id, limit]
  )).rows;
}

// All sites with a URL — for the crawler to walk. (Reads the view so each row
// still carries its live thumbnail, keeping the Member shape intact.)
export async function listCrawlable(): Promise<Member[]> {
  return (await pool.query("SELECT * FROM member_cards WHERE url IS NOT NULL")).rows;
}

// ---- notifications: prefs + one-time bookkeeping -------------------------
// Overwrite a member's email prefs (the /notify page posts the full map).
export async function setNotify(id: string, prefs: Record<string, boolean>): Promise<void> {
  await pool.query("UPDATE members SET notify = $2::jsonb WHERE id = $1", [id, JSON.stringify(prefs)]);
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
    `SELECT m.* FROM edges e JOIN member_cards m ON m.id = e.follower_id
      WHERE e.target_id = $1 AND m.email IS NOT NULL`,
    [targetId]
  )).rows;
}
// Members who signed up but never verified a site (no widget yet) and haven't been
// nudged — for the activation sweep. `before` gates on signup age so we don't nudge
// someone mid-onboarding.
export async function listUnactivated(before: string, limit = 200): Promise<Member[]> {
  return (await pool.query(
    `SELECT * FROM member_cards
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
// A single comment joined with BOTH its author and the site (target) it lives on
// — powers the standalone /note/:id view the widget links each comment to.
export type db_NoteRow = db_CommentRow & {
  target_id: string;
  target_name: string; target_handle: string | null; target_avatar: string | null; target_url: string | null;
};
export async function getComment(id: string): Promise<db_NoteRow | undefined> {
  const r = await pool.query(
    `SELECT c.id, c.body, c.visibility, c.created, c.target_id, c.author_id,
            m.name AS author_name, m.handle AS author_handle, m.avatar AS author_avatar, m.url AS author_url,
            t.name AS target_name, t.handle AS target_handle, t.avatar AS target_avatar, t.url AS target_url
       FROM comments c
       LEFT JOIN members m ON m.id = c.author_id
       JOIN members t ON t.id = c.target_id
      WHERE c.id = $1`,
    [id]
  );
  return r.rows[0];
}

export async function addComment(c: {
  id: string; target_id: string; author_id: string | null; body: string; visibility?: Visibility;
}): Promise<void> {
  await pool.query(
    "INSERT INTO comments (id, target_id, author_id, body, visibility, created) VALUES ($1, $2, $3, $4, $5, $6)",
    [c.id, c.target_id, c.author_id, c.body, c.visibility === "private" ? "private" : "public", now()]
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
       JOIN member_cards m ON m.id = e.target_id
       LEFT JOIN visits v ON v.viewer_id = $1 AND v.target_id = m.id
      WHERE e.follower_id = $1
      ORDER BY (m.last_edited IS NOT NULL) DESC, m.last_edited DESC NULLS LAST, e.created DESC`,
    [memberId]
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
    `SELECT m.*, snap.thumbnail,
            COUNT(DISTINCT all_saves.member_id)::int AS saved_count,
            COUNT(DISTINCT followers.follower_id)::int AS follower_count
       FROM saves viewer_saves
       JOIN members m ON m.id = viewer_saves.target_id
       LEFT JOIN snapshots snap ON snap.id = m.current_snapshot_id
       LEFT JOIN saves all_saves ON all_saves.target_id = m.id
       LEFT JOIN edges followers ON followers.target_id = m.id
      WHERE viewer_saves.member_id = $1
      GROUP BY m.id, snap.thumbnail, viewer_saves.created
      ORDER BY viewer_saves.created DESC`,
    [memberId]
  );
  return r.rows;
}

export async function listMostSaved(limit = 12): Promise<SiteCard[]> {
  const r = await pool.query(
    `SELECT m.*, snap.thumbnail,
            COUNT(DISTINCT s.member_id)::int AS saved_count,
            COUNT(DISTINCT e.follower_id)::int AS follower_count
       FROM members m
       LEFT JOIN snapshots snap ON snap.id = m.current_snapshot_id
       LEFT JOIN saves s ON s.target_id = m.id
       LEFT JOIN edges e ON e.target_id = m.id
      GROUP BY m.id, snap.thumbnail
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
     SELECT m.*, snap.thumbnail,
            COALESCE(ff.mutual_count, 0)::int AS mutual_count,
            COUNT(DISTINCT s.member_id)::int AS saved_count,
            COUNT(DISTINCT followers.follower_id)::int AS follower_count
       FROM members m
       LEFT JOIN snapshots snap ON snap.id = m.current_snapshot_id
       LEFT JOIN friend_follows ff ON ff.target_id = m.id
       LEFT JOIN saves s ON s.target_id = m.id
       LEFT JOIN edges followers ON followers.target_id = m.id
       LEFT JOIN mine ON mine.target_id = m.id
      WHERE m.id <> $1 AND mine.target_id IS NULL
      GROUP BY m.id, snap.thumbnail, ff.mutual_count
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
       JOIN member_cards m ON m.id = l.peer_id
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
// idempotent (an existing edge, including a richer 'friend' rel, is left intact),
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
    `($${2 * i + 1}, $${2 * i + 2}, 'follow', $${flat.length + 1})`).join(", ");
  await pool.query(
    `INSERT INTO edges (follower_id, target_id, rel, created) VALUES ${tuples}
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
