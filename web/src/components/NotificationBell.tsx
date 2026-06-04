import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { getThreads, type Conversation } from "../api";
import { Avatar } from "../ui";
import { relTime } from "../lib";

/**
 * The header notification bell — a global "someone messaged you" indicator. It shows
 * a badge with your unread direct-message count and, on click, a dropdown of the
 * conversations with unread messages. (New comments on your site live on your own
 * profile, not here.) Backed entirely by the existing /api/threads, so there's no
 * new store: it refreshes on mount, when the route changes (you may have just read a
 * thread), and on a gentle interval.
 */
export function NotificationBell() {
  const [convos, setConvos] = useState<Conversation[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();

  const load = useCallback(() => {
    getThreads().then(setConvos, () => {});
  }, []);

  useEffect(() => {
    load();
  }, [load, pathname]);

  useEffect(() => {
    const timer = setInterval(() => document.visibilityState === "visible" && load(), 30000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const unread = convos.filter((c) => c.unread > 0);
  const count = unread.reduce((n, c) => n + c.unread, 0);

  return (
    <div className="bell-wrap" ref={ref}>
      <button
        className={"bell" + (open ? " on" : "")}
        aria-label={count ? `${count} unread messages` : "Notifications"}
        onClick={() => setOpen((v) => !v)}
      >
        <BellIcon />
        {count > 0 && <span className="bell-badge">{count > 9 ? "9+" : count}</span>}
      </button>

      {open && (
        <div className="bell-menu">
          <div className="bell-head">Notifications</div>
          {unread.length === 0 ? (
            <div className="bell-empty">You're all caught up. New comments show on your profile.</div>
          ) : (
            <div className="bell-list">
              {unread.map((c) => (
                <Link
                  key={c.peer.id}
                  className="bell-item"
                  to={`/messages/${c.peer.id}`}
                  onClick={() => setOpen(false)}
                >
                  <Avatar of={c.peer} />
                  <div className="bell-item-body">
                    <div className="bell-item-top">
                      <span className="who">{c.peer.name || "Someone"}</span>
                      {c.lastAt && <time>{relTime(c.lastAt)}</time>}
                    </div>
                    <div className="bell-item-msg">{c.lastDeleted ? "Message deleted" : c.lastBody}</div>
                  </div>
                  <span className="bell-item-n">{c.unread}</span>
                </Link>
              ))}
            </div>
          )}
          <Link className="bell-foot" to="/messages" onClick={() => setOpen(false)}>
            Open messages
          </Link>
        </div>
      )}
    </div>
  );
}

/** Lucide "bell" (https://lucide.dev), inlined so the header needs no icon runtime. */
function BellIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10.268 21a2 2 0 0 0 3.464 0" />
      <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" />
    </svg>
  );
}
