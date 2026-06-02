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

export type Stats = {
  views: number;
  followers: number;
  following: number;
  viewerFollows: boolean;
  viewerSaved: boolean;
};

export type NoteAuthor = {
  id: string;
  name: string | null;
  handle: string | null;
  avatar: string | null;
  url: string | null;
};

export type InboxNote = {
  id: string;
  body: string;
  visibility: "public" | "private";
  created: string;
  author: NoteAuthor;
  site: { handle: string | null; name: string };
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

export const getViewer = () => req<Member | null>("/api/viewer");
export const getStats = (id: string) =>
  req<Stats>(`/api/profile/${encodeURIComponent(id)}/stats`);
export const getFollowing = () => req<Member[]>("/api/following");
export const getInbox = () => req<InboxNote[]>("/api/inbox");
export const updateProfile = (patch: ProfilePatch) =>
  req<Member>("/api/profile", { method: "PATCH", ...jsonBody(patch) });
export const logout = () => req<{ ok: true }>("/api/logout", { method: "POST" });
