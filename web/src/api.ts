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
  views: number;
  /** Present only on the signed-in viewer; gates the signup wizard. */
  onboarded?: boolean;
  /** Present only on the signed-in viewer; true once their site is proven theirs. */
  verified?: boolean;
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
  pinned: number;
  viewerFollows: boolean;
  viewerSaved: boolean;
  viewerPinned: boolean;
};

/** A pinned site plus the public notes the pinner left on it (the bubble). */
export type PinnedSite = Site & {
  notes: Array<{ id: string; body: string; created: string }>;
};

export type Discovery = {
  saved: Site[];
  mostSaved: Site[];
  recommended: Site[];
};

export type NoteAuthor = {
  id: string | null;
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

/** Email a magic sign-in link. In dev (no mailer) the link comes back as dev_link. */
export const requestMagicLink = (email: string, returnTo?: string) =>
  req<{ ok?: true; dev_link?: string }>("/api/auth/magic-link", {
    method: "POST",
    ...jsonBody({ email, return: returnTo }),
  });

export const getViewer = () => req<Member | null>("/api/viewer");

/** Live username availability for the signup picker. */
export const checkHandle = (handle: string) =>
  req<{ handle: string; available: boolean; reason: string | null }>(
    `/api/handle/check?h=${encodeURIComponent(handle)}`,
  );

/** Reserve a username mid-wizard (durable progress) without finishing signup. */
export const claimHandle = (handle: string) =>
  req<Member>("/api/profile", { method: "PATCH", ...jsonBody({ handle }) });

/** Finish signup: claim a username + optionally link a site. */
export const onboard = (handle: string, url?: string) =>
  req<Member>("/api/onboard", { method: "POST", ...jsonBody({ handle, url: url || "" }) });

/** Link a site and optimistically scrape its thumbnail + inferred profile picture. */
export const scrapeSite = (url: string) =>
  req<{ host: string; reachable: boolean; thumbnail: string | null; avatar: string | null }>(
    "/api/site/scrape",
    { method: "POST", ...jsonBody({ url }) },
  );

/** Prove ownership of the linked site by detecting your widget on it. */
export const verifySite = () =>
  req<{ verified: boolean; reason: string | null }>("/api/verify", { method: "POST" });
export const getProfile = (id: string) =>
  req<Member>(`/api/profile/${encodeURIComponent(id)}`);
export const getStats = (id: string) =>
  req<Stats>(`/api/profile/${encodeURIComponent(id)}/stats`);

/** Leave a written note (postcard) on someone's site. Members only. */
export const postComment = (id: string, body: string, visibility: "public" | "private") =>
  req<unknown>(`/api/profile/${encodeURIComponent(id)}/comments`, {
    method: "POST",
    ...jsonBody({ body, visibility }),
  });

/** Follow / save toggles — both return the target's refreshed stats. */
export const follow = (id: string) =>
  req<Stats>("/api/follow", { method: "POST", ...jsonBody({ id }) });
export const save = (id: string) =>
  req<Stats>("/api/save", { method: "POST", ...jsonBody({ id }) });
export const getFollowing = () => req<Site[]>("/api/following");
export const getInbox = () => req<InboxNote[]>("/api/inbox");
export const updateProfile = (patch: ProfilePatch) =>
  req<Member>("/api/profile", { method: "PATCH", ...jsonBody(patch) });
/** Upload a new profile picture (already cropped + resized client-side). */
export const uploadAvatar = (image: Blob) =>
  req<Member>("/api/avatar", { method: "POST", headers: { "content-type": image.type }, body: image });
export const logout = () => req<{ ok: true }>("/api/logout", { method: "POST" });

export const getSaved = () => req<Site[]>("/api/saved");
export const getDiscovery = () => req<Discovery>("/api/discovery");
export const getOutgoing = () => req<OutgoingNote[]>("/api/comments/outgoing");

/** A member's public pin showcase (max 3); defaults to the signed-in viewer. */
export const getPinned = (id?: string) =>
  req<PinnedSite[]>(`/api/pinned${id ? `?id=${encodeURIComponent(id)}` : ""}`);
/** Toggle a pin on/off. Throws ApiError(409) when the 3-pin limit is reached. */
export const togglePin = (id: string) =>
  req<Stats>("/api/pin", { method: "POST", ...jsonBody({ id }) });
