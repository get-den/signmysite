/*
 * The landing experiment. A plain signed-out visitor is randomly, stickily
 * assigned one of the ARMS; we record the exposure, the cumulative visible time
 * (re-beaconed on every tab-hide; the server aggregates MAX per pageview), and
 * CTA clicks. Anonymous by construction: a random per-browser id in localStorage,
 * no cookies, nothing personal. Forced ?v= browsing (the switcher) records
 * nothing. Results land on /admin.
 */

/** The variants in the running test — variant ids (see VARIANTS in index.tsx). */
export const ARMS = [2, 7];

const VID_KEY = "signmysite:landing-vid";
const ARM_KEY = "signmysite:landing-arm";

const uid = (): string =>
  crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);

/** This browser's sticky assignment, drawn once and kept. */
export function assignedArm(): number {
  try {
    const saved = Number(localStorage.getItem(ARM_KEY));
    if (ARMS.includes(saved)) return saved;
    const arm = ARMS[Math.floor(Math.random() * ARMS.length)];
    localStorage.setItem(ARM_KEY, String(arm));
    return arm;
  } catch {
    return ARMS[0];
  }
}

// sendBeacon first (it survives unload, which is when dwell flushes), keepalive
// fetch as the fallback. Analytics must never break the page: swallow everything.
function send(body: Record<string, unknown>) {
  const json = JSON.stringify(body);
  try {
    if (!navigator.sendBeacon?.("/api/landing-event", json))
      fetch("/api/landing-event", { method: "POST", body: json, keepalive: true }).catch(() => {});
  } catch { /* ignore */ }
}

// The active pageview — module state, so the CTA components can report clicks
// without threading ids through props. Null while browsing variants via ?v=.
let current: { vid: string; view: string; variant: number } | null = null;

/** Start recording a pageview of `variant`. Returns the unmount cleanup. */
export function beginView(variant: number): () => void {
  let vid: string;
  try {
    vid = localStorage.getItem(VID_KEY) || uid();
    localStorage.setItem(VID_KEY, vid);
  } catch {
    vid = "anon";
  }
  current = { vid, view: uid(), variant };
  send({ ...current, event: "view" });

  // Visible time: count while the tab is shown, flush the running total whenever
  // it hides (or the page unloads / the route changes). Unload fires BOTH
  // visibilitychange and pagehide, so only beacon when the total actually grew.
  let shownAt: number | null = Date.now();
  let total = 0;
  let sent = 0;
  const flush = () => {
    if (shownAt !== null) { total += Date.now() - shownAt; shownAt = null; }
    if (current && total > sent) { sent = total; send({ ...current, event: "dwell", ms: total }); }
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden") flush();
    else if (shownAt === null) shownAt = Date.now();
  };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", flush);
  return () => {
    flush();
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", flush);
    current = null;
  };
}

/** A CTA click on the active pageview; a no-op while browsing via ?v=. */
export function trackClick(event: "copy" | "signin") {
  if (current) send({ ...current, event });
}
