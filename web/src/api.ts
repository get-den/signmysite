/*
 * Typed client for the Den API. Same-origin in production; in dev Vite proxies
 * /api to the Hono server. Always sends cookies (first-party session on den.com).
 */

export type Member = {
  id: string;
  handle: string | null;
  name: string;
  url: string | null;
  avatar: string | null;
  bio: string | null;
  views: number;
};

/** A followed/saved/discovered site card. */
export type Site = Member & {
  isNew?: boolean;
  thumbnail?: string | null;
  lastEdited?: string | null;
  savedCount?: number;
  followerCount?: number;
  mutualCount?: number;
  reason?: string;
  tags?: string[];
};

export type Stats = {
  views: number;
  followers: number;
  following: number;
  saved: number;
  viewerFollows: boolean;
  viewerSaved: boolean;
};

export type Discovery = {
  saved: Site[];
  mostSaved: Site[];
  recommended: Site[];
};

export type NoteAuthor = {
  id: string;
  name: string | null;
  handle: string | null;
  avatar: string | null;
  url: string | null;
};

/** A note left on YOUR site (incoming). */
export type InboxNote = {
  id: string;
  body: string;
  visibility: "public" | "private";
  created: string;
  author: NoteAuthor;
  site: { handle: string | null; name: string };
};

/** A note YOU left on someone else's site (outgoing). */
export type OutgoingNote = {
  id: string;
  body: string;
  visibility: "public" | "private";
  created: string;
  site: { id: string; name: string; handle: string | null; avatar: string | null; url: string | null };
};

export type ProfilePatch = {
  name: string;
  handle: string;
  url: string;
  avatar: string;
  bio: string;
};

export class ApiError extends Error {
  status: number;
  constructor(status: number) {
    super(String(status));
    this.status = status;
  }
}

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(path, { credentials: "include", ...opts });
  if (!r.ok) throw new ApiError(r.status);
  return (r.status === 204 ? null : await r.json()) as T;
}

function jsonBody(body: unknown): RequestInit {
  return { headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

/** Resolve to a fallback if the request fails (e.g. an endpoint not yet live). */
export const orEmpty = <T>(p: Promise<T[]>): Promise<T[]> => p.catch(() => []);

export const getViewer = () => req<Member | null>("/api/viewer");
export const getStats = (id: string) =>
  req<Stats>(`/api/profile/${encodeURIComponent(id)}/stats`);
export const getFollowing = () => req<Site[]>("/api/following");
export const getInbox = () => req<InboxNote[]>("/api/inbox");
export const updateProfile = (patch: ProfilePatch) =>
  req<Member>("/api/profile", { method: "PATCH", ...jsonBody(patch) });
export const logout = () => req<{ ok: true }>("/api/logout", { method: "POST" });

export const getSaved = () => req<Site[]>("/api/saved");
export const getDiscovery = () => req<Discovery>("/api/discovery");
export const getOutgoing = () => req<OutgoingNote[]>("/api/comments/outgoing");
