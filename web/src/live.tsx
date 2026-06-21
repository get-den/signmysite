/*
 * Live activity — "Sofia B. from Canada just signed up", as it happens.
 *
 * One EventSource per signed-in tab (GET /api/live, SSE; see server/live.ts)
 * feeds one shared store (LiveProvider). On top of that store sit FIVE
 * interchangeable presentations, switchable at runtime from the floating
 * "Live" chip (bottom-right), which can also run a scripted demo burst:
 *
 *   toast   — dark cards sliding in bottom-left (the screenshot look)
 *   rail    — a "Happening now" block atop the home's right rail
 *   ticker  — a one-line rotating pill pinned bottom-center
 *   bell    — a header bell with an unseen badge + dropdown
 *   inline  — live rows pulsing into the top of the home feed
 *
 * The choice persists in localStorage; "off" closes the stream entirely.
 */
import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { isReaction, relTime } from "./lib";
import { Avatar, CloseIcon, IdentityLink } from "./ui";
import { useToast, useViewer } from "./providers";
import "./live.css";

export type LiveEvent = {
  id: number;
  kind: "signup" | "widget" | "view" | "follow" | "save" | "comment" | "reaction";
  at: string;
  actor: { id: string | null; name: string; handle: string | null; avatar: string | null; country: string | null };
  body?: string;
};

export type LiveVariant = "toast" | "rail" | "ticker" | "bell" | "inline" | "off";
export const LIVE_VARIANTS: Array<[LiveVariant, string]> = [
  ["toast", "Toast"],
  ["rail", "Sidebar"],
  ["ticker", "Ticker"],
  ["bell", "Bell"],
  ["inline", "In feed"],
  ["off", "Off"],
];

const VARIANT_KEY = "signmysite:live-ui";
// The shipped look. All five stay in code — the dev-only LiveSwitcher flips
// between them — but production renders this one unless a dev has overridden it.
const DEFAULT_VARIANT: LiveVariant = "rail";
const loadVariant = (): LiveVariant => {
  try {
    const v = localStorage.getItem(VARIANT_KEY);
    return LIVE_VARIANTS.some(([k]) => k === v) ? (v as LiveVariant) : DEFAULT_VARIANT;
  } catch { return DEFAULT_VARIANT; }
};

type LiveCtx = {
  events: LiveEvent[]; // newest first
  variant: LiveVariant;
  setVariant: (v: LiveVariant) => void;
  /** Events newer than the last time the bell dropdown was opened. */
  unseen: number;
  markSeen: () => void;
  runDemo: () => void;
};

const LiveContext = createContext<LiveCtx | null>(null);

export function useLive(): LiveCtx {
  const ctx = useContext(LiveContext);
  if (!ctx) throw new Error("useLive must be used within LiveProvider");
  return ctx;
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const { viewer } = useViewer();
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [variant, setVariantState] = useState<LiveVariant>(loadVariant);
  const [seenUpTo, setSeenUpTo] = useState(0);
  const enabled = !!viewer && variant !== "off";

  useEffect(() => {
    if (!enabled) return;
    // EventSource reconnects on its own; the client dedupes by event id, so a
    // re-sent backlog after a blip never doubles up.
    const es = new EventSource("/api/live");
    es.addEventListener("activity", (msg) => {
      try {
        const e = JSON.parse((msg as MessageEvent).data) as LiveEvent;
        setEvents((cur) => (cur.some((x) => x.id === e.id) ? cur : [e, ...cur].slice(0, 40)));
      } catch { /* a malformed frame is dropped, the stream lives on */ }
    });
    return () => es.close();
  }, [enabled, viewer?.id]);

  const setVariant = (v: LiveVariant) => {
    setVariantState(v);
    try { localStorage.setItem(VARIANT_KEY, v); } catch { /* ignore */ }
  };

  const unseen = events.filter((e) => e.id > seenUpTo).length;
  const markSeen = () => setSeenUpTo(events[0]?.id ?? seenUpTo);
  const runDemo = () => { fetch("/api/live/demo", { method: "POST", credentials: "include" }).catch(() => {}); };

  return (
    <LiveContext.Provider value={{ events, variant, setVariant, unseen, markSeen, runDemo }}>
      {children}
    </LiveContext.Provider>
  );
}

/* ---- the shared sentence -------------------------------------------------- */
// Every variant says the same thing; only the frame changes.

function phrase(e: LiveEvent): string {
  switch (e.kind) {
    case "signup": return "Just signed up";
    case "widget": return "Added the widget to their site";
    case "view": return "Viewed your site";
    case "follow": return "Followed you";
    case "save": return "Saved your site";
    case "reaction": return `Reacted ${(e.body || "❤️").trim()} to your site`;
    case "comment": return "Commented on your site";
  }
}
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

// "CA" → "Canada", via Intl; null (or an engine without it) just drops the clause.
function placeName(cc: string | null): string | null {
  if (!cc) return null;
  try { return new Intl.DisplayNames(undefined, { type: "region" }).of(cc) || null; } catch { return null; }
}
const From = ({ e }: { e: LiveEvent }) => {
  const p = placeName(e.actor.country);
  return p ? <span className="live-from"> from {p}</span> : null;
};
const ago = (at: string) => { const t = relTime(at); return t === "now" ? "just now" : `${t} ago`; };

/* ---- 1 · toast (the screenshot) ------------------------------------------- */
// Dark cards bottom-left, newest at the bottom, max three, gone after ~6s.
// Backlog older than 90s is news, not "now" — it never replays as a toast.

export function LiveToasts() {
  const { variant, events } = useLive();
  const [stack, setStack] = useState<LiveEvent[]>([]);
  const shown = useRef(new Set<number>());
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const latest = events[0];

  useEffect(() => {
    if (variant !== "toast" || !latest || shown.current.has(latest.id)) return;
    shown.current.add(latest.id);
    if (Date.now() - Date.parse(latest.at) > 90_000) return;
    setStack((cur) => [...cur, latest].slice(-3));
    timers.current.set(latest.id, setTimeout(() => {
      setStack((cur) => cur.filter((e) => e.id !== latest.id));
      timers.current.delete(latest.id);
    }, 6000));
  }, [variant, latest]);
  useEffect(() => () => { for (const t of timers.current.values()) clearTimeout(t); }, []);

  if (variant !== "toast" || !stack.length) return null;
  const dismiss = (id: number) => setStack((cur) => cur.filter((e) => e.id !== id));
  return (
    <div className="live-toasts" aria-live="polite">
      {stack.map((e) => (
        <div className="live-toast" key={e.id}>
          <Avatar of={e.actor} />
          <div className="live-toast-meta">
            <div className="live-toast-title"><b>{e.actor.name}</b><From e={e} /></div>
            <div className="live-toast-sub">{phrase(e)} · {ago(e.at)}</div>
          </div>
          <button type="button" className="live-toast-x" aria-label="Dismiss" onClick={() => dismiss(e.id)}>
            <CloseIcon size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ---- 2 · rail ("Happening now" in the right rail) -------------------------- */

export function LiveRail() {
  const { variant, events } = useLive();
  if (variant !== "rail" || !events.length) return null;
  return (
    <section className="rail-block live-rail" aria-label="Happening now">
      <div className="rail-block-head">
        <h2>Happening now</h2>
        <span className="live-dot" aria-hidden="true" />
      </div>
      <ul className="live-rail-list">
        {events.slice(0, 6).map((e) => (
          <li className="live-rail-row" key={e.id}>
            <IdentityLink of={e.actor}><Avatar of={e.actor} /></IdentityLink>
            <span className="live-rail-meta">
              <span className="live-rail-line"><b>{e.actor.name}</b><From e={e} /> {lower(phrase(e))}</span>
              <span className="live-rail-time">{ago(e.at)}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---- 3 · ticker (one rotating line, pinned bottom-center) ------------------ */

export function LiveTicker() {
  const { variant, events } = useLive();
  const [i, setI] = useState(0);
  const pool = events.slice(0, 8);
  useEffect(() => {
    if (variant !== "ticker" || pool.length < 2) return;
    const t = setInterval(() => setI((x) => x + 1), 4500);
    return () => clearInterval(t);
  }, [variant, pool.length]);
  if (variant !== "ticker" || !pool.length) return null;
  const e = pool[i % pool.length];
  return (
    <div className="live-ticker" aria-live="polite">
      <span className="live-dot" aria-hidden="true" />
      <span className="live-ticker-msg" key={e.id}>
        <b>{e.actor.name}</b><From e={e} /> {lower(phrase(e))} · {ago(e.at)}
      </span>
    </div>
  );
}

/* ---- 4 · bell (header icon + unseen badge + dropdown) ----------------------- */

export function LiveBell() {
  const { viewer } = useViewer();
  const { variant, events, unseen, markSeen } = useLive();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  if (variant !== "bell" || !viewer) return null;
  const toggle = () => { setOpen((o) => !o); if (!open) markSeen(); };
  return (
    <div className="live-bell-wrap" ref={wrap}>
      <button
        type="button" className={open ? "live-bell on" : "live-bell"}
        aria-label={unseen ? `Activity (${unseen} new)` : "Activity"} onClick={toggle}
      >
        <BellIcon />
        {unseen > 0 && <span className="live-bell-badge">{unseen > 9 ? "9+" : unseen}</span>}
      </button>
      {open && (
        <div className="live-pop" role="menu" aria-label="Recent activity">
          <div className="live-pop-head">Happening now</div>
          {events.length ? (
            events.slice(0, 12).map((e) => (
              <div className="live-pop-row" key={e.id}>
                <Avatar of={e.actor} />
                <span className="live-pop-meta">
                  <span className="live-pop-line"><b>{e.actor.name}</b><From e={e} /> {lower(phrase(e))}</span>
                  <span className="live-pop-time">{ago(e.at)}</span>
                </span>
              </div>
            ))
          ) : (
            <div className="live-pop-empty">Quiet for now. Activity shows up live.</div>
          )}
        </div>
      )}
    </div>
  );
}

function BellIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

/* ---- 5 · inline (live rows atop the home feed) ------------------------------ */
// Rendered as the feed list's first rows, in the feed's own grid, with a soft
// arrival flash + a LIVE pill instead of a follow button.

export function LiveFeedRows() {
  const { variant, events } = useLive();
  if (variant !== "inline" || !events.length) return null;
  return (
    <>
      {events.slice(0, 4).map((e) => (
        <li key={`live${e.id}`}>
          <article className="feed-item live-inline">
            <IdentityLink of={e.actor} className="feed-av" ariaLabel={e.actor.name}>
              <Avatar of={e.actor} />
            </IdentityLink>
            <div className="feed-body">
              <div className="feed-head">
                <p className="feed-line">
                  <b>{e.actor.name}</b><From e={e} /> {lower(phrase(e))}
                </p>
                <div className="feed-aside">
                  <span className="live-pill"><span className="live-dot" aria-hidden="true" />LIVE</span>
                  <time className="feed-time">{relTime(e.at)}</time>
                </div>
              </div>
              {e.body && !isReaction(e.body) && <div className="feed-quote">{e.body}</div>}
            </div>
          </article>
        </li>
      ))}
    </>
  );
}

/* ---- the experiment switcher ------------------------------------------------ */
// A quiet floating chip (bottom-right): pick one of the five looks, or run the
// scripted demo burst to see the current one with lifelike traffic.

export function LiveSwitcher() {
  const { viewer } = useViewer();
  const { variant, setVariant, runDemo } = useLive();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // The variant picker + demo trigger is a dev affordance, not a production one:
  // shipped builds render the chosen default (DEFAULT_VARIANT) with no chrome.
  if (!viewer || !import.meta.env.DEV) return null;
  const label = LIVE_VARIANTS.find(([k]) => k === variant)?.[1] ?? "Toast";
  return (
    <div className="live-switcher" ref={wrap}>
      {open && (
        <div className="live-switcher-pop" role="menu" aria-label="Live activity style">
          <div className="live-pop-head">Live activity</div>
          {LIVE_VARIANTS.map(([k, name]) => (
            <button
              type="button" key={k} role="menuitemradio" aria-checked={variant === k}
              className={variant === k ? "live-opt on" : "live-opt"}
              onClick={() => { setVariant(k); setOpen(false); }}
            >
              {name}{variant === k && <span aria-hidden="true">✓</span>}
            </button>
          ))}
          <div className="live-switcher-sep" />
          <button
            type="button" className="live-opt"
            onClick={() => {
              if (variant === "off") setVariant("toast");
              runDemo(); setOpen(false); toast("Demo activity incoming");
            }}
          >
            Preview with demo activity
          </button>
        </div>
      )}
      <button type="button" className="live-switcher-chip" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="live-dot" aria-hidden="true" />
        Live · {label}
      </button>
    </div>
  );
}
