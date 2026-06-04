/*
 * The "pending engagement": the reaction or comment a visitor began in someone's
 * widget, stashed durably so it survives the whole sign-in + onboarding round trip
 * — including on mobile, where a tab can be reaped mid-flow or a magic link opens
 * in a different browser than the one they typed in. The draft also rides in the
 * URL (the fast path that auto-posts on return); this localStorage copy is the
 * belt-and-suspenders so the visitor's words are never lost. Cleared the moment
 * the action actually posts (see Reacted / Compose / the Home backstop).
 */

const KEY = "den:pending-engagement";

export type Pending = {
  kind: "note" | "react";
  /** Target member id (whose site they engaged). */
  to: string;
  /** The target's display name, for greetings before the card loads. */
  site: string;
  /** The exact page they came from, so we can slip them back to it after. */
  from?: string;
  /** kind=react */
  emoji?: string;
  /** kind=note */
  body?: string;
  visibility?: "public" | "private";
};

export function savePending(p: Pending): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage off — the URL still carries it */ }
}

export function loadPending(): Pending | null {
  try {
    const raw = localStorage.getItem(KEY);
    const p = raw ? (JSON.parse(raw) as Pending) : null;
    return p && p.to && (p.kind === "react" || p.kind === "note") ? p : null;
  } catch {
    return null;
  }
}

export function clearPending(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/**
 * The in-app route that finishes posting this engagement (and then clears it).
 * Everything needed rides in the query, so a redirect here recovers the action
 * with nothing held in memory: reactions post on /reacted, notes auto-send on
 * /compose (send=1).
 */
export function resumePath(p: Pending): string {
  const q = new URLSearchParams({ to: p.to });
  if (p.site) q.set("site", p.site);
  if (p.from) q.set("from", p.from);
  if (p.kind === "react") {
    q.set("kind", "react");
    if (p.emoji) q.set("emoji", p.emoji);
    return `/reacted?${q}`;
  }
  if (p.body) q.set("body", p.body);
  q.set("v", p.visibility === "private" ? "private" : "public");
  q.set("send", "1");
  return `/compose?${q}`;
}
