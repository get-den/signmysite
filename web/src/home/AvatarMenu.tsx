/*
 * The identity chip + its menu — your avatar, name and handle, anchored bottom-left
 * of the nav rail (and, on small screens, top-right of the header). Click it to open
 * a small popover: your public profile, settings, and the sign-out the screenshot
 * asks for. Closes on outside click, Escape, or a route change.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { logout, type Member } from "../api";
import { ownProfilePath } from "../lib";
import { useViewer } from "../providers";
import { Avatar } from "../ui";

export function AvatarMenu({ viewer, compact = false }: { viewer: Member; compact?: boolean }) {
  const { setViewer } = useViewer();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);
  // Close when navigation happens.
  useEffect(() => setOpen(false), [pathname]);

  async function signOut() {
    try { await logout(); } finally { setViewer(null); navigate("/"); }
  }

  return (
    <div className={"who-menu" + (compact ? " who-menu-compact" : "")} ref={ref}>
      <button
        type="button"
        className={"who-trigger" + (open ? " on" : "")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Your account"
        onClick={() => setOpen((v) => !v)}
      >
        <Avatar of={viewer} />
        {!compact && (
          <span className="who-id">
            <span className="who-name">{viewer.name || "You"}</span>
            <span className="who-sub">{viewer.handle ? `@${viewer.handle}` : "Set up your profile"}</span>
          </span>
        )}
        {!compact && <ChevronIcon />}
      </button>

      {open && (
        <div className="who-pop" role="menu">
          <Link className="who-pop-id" to={ownProfilePath(viewer)}>
            <Avatar of={viewer} />
            <span className="who-id">
              <span className="who-name">{viewer.name || "You"}</span>
              <span className="who-sub">{viewer.handle ? `@${viewer.handle}` : "Finish setup"}</span>
            </span>
          </Link>
          <div className="who-pop-sep" />
          <Link className="who-pop-item" to={ownProfilePath(viewer)} role="menuitem">View profile</Link>
          <Link className="who-pop-item" to="/edit" role="menuitem">Settings</Link>
          <div className="who-pop-sep" />
          <button className="who-pop-item danger" type="button" role="menuitem" onClick={signOut}>
            Sign out{viewer.handle ? ` @${viewer.handle}` : ""}
          </button>
        </div>
      )}
    </div>
  );
}

function ChevronIcon() {
  return (
    <svg className="who-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
