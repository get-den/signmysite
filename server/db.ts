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
  id      TEXT PRIMARY KEY,
  handle  TEXT UNIQUE,
  name    TEXT NOT NULL,
  email   TEXT UNIQUE,
  url     TEXT,
  avatar  TEXT,
  bio     TEXT,
  created TEXT NOT NULL
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

export type Member = {
  id: string; handle: string | null; name: string; email: string | null;
  url: string | null; avatar: string | null; bio: string | null; created: string;
};
export type Stats = { followers: number; following: number; viewerFollows: boolean; viewerSaved: boolean };

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
export async function createMember(m: {
  id: string; name: string; handle?: string | null; email?: string | null;
  url?: string | null; avatar?: string | null; bio?: string | null;
}): Promise<Member> {
  const r = await pool.query(
    `INSERT INTO members (id, handle, name, email, url, avatar, bio, created)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [m.id, m.handle ?? null, m.name, m.email ?? null, m.url ?? null, m.avatar ?? null, m.bio ?? null, now()]
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

// ---- stats ---------------------------------------------------------------
export async function stats(id: string, viewerId?: string): Promise<Stats> {
  const followers = (await pool.query("SELECT COUNT(*)::int AS c FROM edges WHERE target_id = $1", [id])).rows[0].c;
  const following = (await pool.query("SELECT COUNT(*)::int AS c FROM edges WHERE follower_id = $1", [id])).rows[0].c;
  return {
    followers,
    following,
    viewerFollows: viewerId ? await hasEdge(viewerId, id) : false,
    viewerSaved: viewerId ? await hasSave(viewerId, id) : false,
  };
}

// ---- sessions ------------------------------------------------------------
export async function createSession(memberId: string, ttlSec = 60 * 60 * 24 * 30): Promise<string> {
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
