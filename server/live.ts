/*
 * Realtime activity — the tiny in-memory pub/sub behind GET /api/live (SSE).
 *
 * Routes call emit() as a side effect of the thing itself (a signup, a view, a
 * follow…); every open stream whose member should see the event gets it pushed.
 * Nothing persists: the feed + analytics remain the durable history, this is the
 * "happening now" layer. A short ring buffer backfills a freshly opened stream so
 * the UI never starts empty, and it all evaporates on restart by design.
 *
 * Scoping is one field: `to` is "all" for broadcasts (someone joined, someone
 * added the widget) or a member id for events about that member's own site
 * (views, follows, saves, notes). You never receive your own actions back.
 */

export type LiveKind = "signup" | "widget" | "view" | "follow" | "save" | "comment" | "reaction";

export type LiveEvent = {
  id: number;
  kind: LiveKind;
  at: string; // ISO timestamp
  /** Who may see it: "all" broadcasts; a member id targets that site's owner. */
  to: string;
  /** Who did it. id null = an anonymous visitor (views only). */
  actor: { id: string | null; name: string; handle: string | null; avatar: string | null; country: string | null };
  /** A comment's text / a reaction's emoji. */
  body?: string;
};

type Listener = (e: LiveEvent) => void;
const streams = new Map<string, Set<Listener>>(); // subscriber member id → their open streams
const recent: LiveEvent[] = []; // ring buffer for backfill
const RECENT_MAX = 100;
const RECENT_TTL_MS = 60 * 60 * 1000; // backfill shows the last hour at most
let seq = 1;

/** Your own actions never come back at you; everything else follows `to`. */
const visibleTo = (e: LiveEvent, memberId: string): boolean =>
  e.actor.id !== memberId && (e.to === "all" || e.to === memberId);

export function emit(e: Omit<LiveEvent, "id" | "at">): void {
  const ev: LiveEvent = { id: seq++, at: new Date().toISOString(), ...e };
  recent.push(ev);
  while (recent.length > RECENT_MAX) recent.shift();
  for (const [memberId, listeners] of streams) {
    if (!visibleTo(ev, memberId)) continue;
    for (const fn of listeners) {
      try { fn(ev); } catch { /* one dead stream never blocks the rest */ }
    }
  }
}

export function subscribe(memberId: string, fn: Listener): () => void {
  let set = streams.get(memberId);
  if (!set) streams.set(memberId, (set = new Set()));
  set.add(fn);
  return () => {
    set.delete(fn);
    if (!set.size) streams.delete(memberId);
  };
}

/** What a freshly opened stream sees first: this member's recent slice of the buffer. */
export function backlog(memberId: string, limit = 20): LiveEvent[] {
  const since = Date.now() - RECENT_TTL_MS;
  return recent.filter((e) => visibleTo(e, memberId) && Date.parse(e.at) >= since).slice(-limit);
}

/** "Sofia Bellini" → "Sofia B." — broadcasts name people the way a passerby would. */
export function shortName(name: string | null | undefined): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "Someone";
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[1][0].toUpperCase()}.`;
}

/** A cf-ipcountry / x-vercel-ip-country header value → ISO country, or null
 *  (mirrors viewDimensions in app.ts: the XX/T1 sentinels count as absent). */
export function country(header: string | null | undefined): string | null {
  const v = (header || "").toUpperCase();
  return /^[A-Z]{2}$/.test(v) && v !== "XX" && v !== "T1" ? v : null;
}

/* ---- demo ------------------------------------------------------------------
 * A scripted minute of activity scoped to ONE member (`to` is always them, the
 * actors are fictional), so anyone can preview the live UI without waiting for
 * real traffic — and without spamming anyone else's stream. */

const cast = (name: string, country: string | null = null, handle: string | null = null) =>
  ({ id: "demo", name, handle, avatar: null, country });

const DEMO: Array<{ kind: LiveKind; actor: LiveEvent["actor"]; body?: string }> = [
  { kind: "signup", actor: cast("Sofia B.", "CA") },
  { kind: "view", actor: cast("Someone", "DE") },
  { kind: "follow", actor: cast("Maya Chen", null, "maya") },
  { kind: "save", actor: cast("Lee Robinson", null, "lee") },
  { kind: "comment", actor: cast("Maggie Appleton", null, "maggie"), body: "Love the new homepage, the type is gorgeous." },
  { kind: "signup", actor: cast("Marcus T.", "GB") },
  { kind: "reaction", actor: cast("Josh Comeau", null, "josh"), body: "🔥" },
  { kind: "view", actor: cast("Someone", "JP") },
  { kind: "widget", actor: cast("Priya N.", "IN") },
  { kind: "view", actor: cast("Anna Ruiz", "ES", "anna") },
];

export function demo(to: string): void {
  DEMO.forEach((d, i) => setTimeout(() => emit({ to, ...d }), 800 + i * 2600));
}
