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
  /** External / social profile links (Instagram, X, LinkedIn, …), in display order. */
  links?: string[];
  views: number;
  /** Present only on the signed-in viewer; gates the signup wizard. */
  onboarded?: boolean;
  /** Present only on the signed-in viewer; true once their site is proven theirs. */
  verified?: boolean;
  /** Present only on the signed-in viewer: the linked email + how they sign in. */
  email?: string | null;
  authMethod?: "google" | "email";
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

/** A Den member who has viewed your site, tagged with the relation to you. */
export type ViewerVisit = {
  id: string;
  handle: string | null;
  name: string;
  avatar: string | null;
  url: string | null;
  views: number;
  lastSeen: string;
  /** You already follow them. */
  viewerFollows: boolean;
  /** They follow you. */
  followsYou: boolean;
};

/** Relational analytics for your own site (owner-only). */
export type Analytics = {
  views: number;
  visitors: number;
  knownVisitors: number;
  avgDurationMs: number | null;
  recent: ViewerVisit[];
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

/** A single comment in context — the site it lives on + its author. Backs /note/:id. */
export type NoteDetail = {
  id: string;
  body: string | null;
  visibility: "public" | "private";
  created: string;
  redacted: boolean;
  author: NoteAuthor | null;
  site: { id: string; name: string; handle: string | null; avatar: string | null; url: string | null };
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
  links: string[];
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

/** Finish signup: claim a username + optionally attach social links. (The site
 * itself is already saved via scrapeSite by this point.) */
export const onboard = (handle: string, links?: string[]) =>
  req<Member>("/api/onboard", { method: "POST", ...jsonBody({ handle, links: links ?? [] }) });

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

/** Relational analytics for your own site: counts, avg engaged time, named visitors. */
export const getAnalytics = () => req<Analytics>("/api/analytics");

/** One comment in context (author + site). Backs the /note/:id view. */
export const getComment = (id: string) =>
  req<NoteDetail>(`/api/comments/${encodeURIComponent(id)}`);

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

/* ---- cohorts ("crews": closed groups) ----------------------------------- */

/** A member chip inside a crew (facepile / roster). */
export type CohortFace = {
  id: string;
  name: string;
  handle: string | null;
  avatar: string | null;
  url: string | null;
};
/** A crew as it appears in the dashboard list: facepile + count + your role + link. */
export type Cohort = {
  id: string;
  name: string;
  code: string;
  role: "owner" | "member";
  memberCount: number;
  /** The shareable invite link (absolute), e.g. https://den.com/join/abc1234. */
  joinUrl: string;
  faces: CohortFace[];
};
/** One crew's full roster. */
export type CohortDetail = {
  id: string;
  name: string;
  code: string;
  joinUrl: string;
  role: "owner" | "member";
  members: Array<CohortFace & { role: "owner" | "member" }>;
};

/** The crews you're in (facepile + count each). */
export const getCohorts = () => req<Cohort[]>("/api/cohorts");
/** Create a crew; you become its owner + first member. Returns it with the invite link. */
export const createCohort = (name: string) =>
  req<Cohort>("/api/cohorts", { method: "POST", ...jsonBody({ name }) });
/** One crew's roster (members only). */
export const getCohort = (id: string) =>
  req<CohortDetail>(`/api/cohorts/${encodeURIComponent(id)}`);
/** Join a crew by invite code; on a new join it mutually follows the whole crew. */
export const joinCohort = (code: string) =>
  req<CohortDetail & { joined: boolean }>("/api/cohorts/join", { method: "POST", ...jsonBody({ code }) });
/** Leave a crew (your follows stay). */
export const leaveCohort = (id: string) =>
  req<{ ok: true }>(`/api/cohorts/${encodeURIComponent(id)}/leave`, { method: "POST" });

/* ---- direct messages (DMs) ---------------------------------------------- */

/** The other person in a conversation — a compact identity. */
export type Peer = {
  id: string;
  handle: string | null;
  name: string;
  avatar: string | null;
  url: string | null;
};
/** One emoji reaction on a message: the emoji + the member id who left it. */
export type ChatReaction = { emoji: string; by: string };
/** A single message in a thread. `body` is null once deleted. */
export type ChatMessage = {
  id: string;
  from: string;
  to: string;
  body: string | null;
  created: string;
  edited: string | null;
  deleted: boolean;
  reactions: ChatReaction[];
};
/** An inbox row: the peer + a preview of the last line + how many of theirs are unread. */
export type Conversation = {
  peer: Peer;
  lastBody: string | null;
  lastAt: string;
  lastFromMe: boolean;
  lastDeleted: boolean;
  unread: number;
};
/** One open conversation: the peer + the full thread (oldest-first). */
export type Thread = { peer: Peer; messages: ChatMessage[] };

/** The inbox — every conversation, newest activity first. */
export const getThreads = () => req<Conversation[]>("/api/threads");
/** Open a conversation with a member (by id). Marks their messages read; empty when new. */
export const getThread = (id: string) => req<Thread>(`/api/threads/${encodeURIComponent(id)}`);
/** Send a message to a member. The first one creates the conversation. */
export const sendMessage = (id: string, body: string) =>
  req<ChatMessage>(`/api/threads/${encodeURIComponent(id)}`, { method: "POST", ...jsonBody({ body }) });
/** Edit your own message. */
export const editMessage = (id: string, body: string) =>
  req<ChatMessage>(`/api/messages/${encodeURIComponent(id)}`, { method: "PATCH", ...jsonBody({ body }) });
/** Delete your own message (soft — it stays in the thread as "deleted"). */
export const deleteMessage = (id: string) =>
  req<ChatMessage>(`/api/messages/${encodeURIComponent(id)}`, { method: "DELETE" });
/** Toggle an emoji reaction on a message; returns its full reaction set. */
export const reactToMessage = (id: string, emoji: string) =>
  req<ChatReaction[]>(`/api/messages/${encodeURIComponent(id)}/react`, { method: "POST", ...jsonBody({ emoji }) });
