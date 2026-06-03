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
  bio         TEXT,
  views       INTEGER NOT NULL DEFAULT 0,
  thumbnail   TEXT,            -- preview image (og:image today, screenshot later)
  last_edited TEXT,            -- when the site last changed (ping / crawl / me.json)
  content_hash TEXT,           -- last seen page hash, so the crawler only bumps on real change
  created     TEXT NOT NULL
);
-- migrate older installs in place (idempotent)
ALTER TABLE members ADD COLUMN IF NOT EXISTS google_sub TEXT UNIQUE;
ALTER TABLE members ADD COLUMN IF NOT EXISTS views INTEGER NOT NULL DEFAULT 0;
ALTER TABLE members ADD COLUMN IF NOT EXISTS thumbnail TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS last_edited TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS content_hash TEXT;

-- Per-viewer "last seen this site" — powers the "new"/"updated" badge.
CREATE TABLE IF NOT EXISTS visits (
  viewer_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  PRIMARY KEY (viewer_id, target_id)
);

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
`;

// Default to a local unix-socket connection (peer auth) so it "just works"
// on a Homebrew Postgres. Override with DATABASE_URL in production.
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || "postgres:///den" });
await pool.query(SCHEMA);

export const SESSION_TTL_SEC = 60 * 60 * 24 * 400;

// Wipe all data — for local dev / tests / seeding a clean slate.
export async function reset(): Promise<void> {
  await pool.query("TRUNCATE members, edges, saves, pins, comments, sessions, magic_links, visits");
}

export type Member = {
  id: string; handle: string | null; name: string; email: string | null;
  google_sub: string | null; url: string | null; avatar: string | null;
  bio: string | null; views: number; thumbnail: string | null;
  last_edited: string | null; content_hash: string | null; created: string;
};
export type Stats = {
  views: number; followers: number; following: number; saved: number; pinned: number;
  viewerFollows: boolean; viewerSaved: boolean; viewerPinned: boolean;
};
export type Comment = {
  id: string; target_id: string; author_id: string; body: string; created: string;
};

// ---- members -------------------------------------------------------------
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
export async function createMember(m: {
  id: string; name: string; handle?: string | null; email?: string | null;
  google_sub?: string | null; url?: string | null; avatar?: string | null; bio?: string | null;
}): Promise<Member> {
  const r = await pool.query(
    `INSERT INTO members (id, handle, name, email, google_sub, url, avatar, bio, created)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [m.id, m.handle ?? null, m.name, m.email ?? null, m.google_sub ?? null,
     m.url ?? null, m.avatar ?? null, m.bio ?? null, now()]
  );
  return r.rows[0];
}
export async function updateMember(id: string, patch: Partial<Member>): Promise<Member | undefined> {
  const keys = Object.keys(patch).filter((k) => k !== "id");
  if (!keys.length) return getMember(id);
  const set = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
  const vals = keys.map((k) => (patch as Record<string, unknown>)[k] ?? null);
  const r = await pool.query(`UPDATE members SET ${set} WHERE id = $${keys.length + 1} RETURNING *`, [...vals, id]);
  return r.rows[0];
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
              avatar = COALESCE(avatar, $4),
              bio = COALESCE(bio, $5)
        WHERE id = $1`,
      [targetId, source.email, source.google_sub, source.avatar, source.bio]
    );
    await pool.query("UPDATE sessions SET member_id = $1 WHERE member_id = $2", [targetId, sourceId]);
    await pool.query("UPDATE comments SET author_id = $1 WHERE author_id = $2", [targetId, sourceId]);
    await pool.query("UPDATE comments SET target_id = $1 WHERE target_id = $2", [targetId, sourceId]);
    await moveEdges(sourceId, targetId);
    await movePairs("saves", "member_id", "target_id", sourceId, targetId);
    await movePairs("pins", "member_id", "target_id", sourceId, targetId);
    await moveVisits(sourceId, targetId);
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

// ---- views ---------------------------------------------------------------
export async function addView(id: string): Promise<number> {
  const r = await pool.query("UPDATE members SET views = views + 1 WHERE id = $1 RETURNING views", [id]);
  return r.rows[0]?.views ?? 0;
}

// ---- freshness (last_edited) + thumbnail ---------------------------------
// Mark a site as edited "now" (or at an explicit time, e.g. me.json `updated`).
export async function markEdited(id: string, when?: string): Promise<void> {
  await pool.query("UPDATE members SET last_edited = $2 WHERE id = $1", [id, when || now()]);
}
export async function setThumbnail(id: string, url: string | null): Promise<void> {
  await pool.query("UPDATE members SET thumbnail = $2 WHERE id = $1", [id, url]);
}
// Returns true if the page content changed since last crawl (and stores the new
// hash + bumps last_edited). Lets the crawler bump freshness only on real change.
export async function noteContentHash(id: string, hash: string): Promise<boolean> {
  const prev = (await pool.query("SELECT content_hash FROM members WHERE id = $1", [id])).rows[0];
  if (prev && prev.content_hash === hash) return false;
  await pool.query("UPDATE members SET content_hash = $2, last_edited = $3 WHERE id = $1", [id, hash, now()]);
  return true;
}
// All sites with a URL — for the crawler to walk.
export async function listCrawlable(): Promise<Member[]> {
  return (await pool.query("SELECT * FROM members WHERE url IS NOT NULL")).rows;
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
       JOIN members m ON m.id = e.target_id
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
