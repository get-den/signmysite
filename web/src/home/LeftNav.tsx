/*
 * The left rail (desktop) and the bottom tab bar (mobile) are two faces of one nav.
 * Both walk the same nav-item list, so the destinations stay in sync. Home, Saved,
 * Chat, Profile and Settings are all in-app routes. The rail also carries the account
 * chip (avatar → log out) pinned to its foot.
 *
 * Each icon has an outline form (inactive) and a solid form (active); the active tab
 * fills its icon and goes ink-black — no accent — matching iOS/Twitter-style nav.
 */
import type { ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import type { Member } from "../api";
import { useViewer } from "../providers";
import { ownProfilePath } from "../lib";
import { AvatarMenu } from "./AvatarMenu";
import { useUnreadCount } from "./hooks";

type IconFn = (filled: boolean) => ReactNode;
type NavItem = { to: string; label: string; icon: IconFn; end?: boolean; badge?: number };

// `profileTo` is the viewer's own profile — their shareable /@<handle> when they have
// one — so clicking Profile lands on (and shows in the URL bar) a link they can copy.
function navItems(unread: number, profileTo: string): NavItem[] {
  return [
    { to: "/", label: "Home", icon: (f) => <HomeIcon filled={f} />, end: true },
    { to: "/saved", label: "Saved", icon: (f) => <BookmarkIcon filled={f} /> },
    { to: "/messages", label: "Chat", icon: (f) => <ChatIcon filled={f} />, badge: unread },
    { to: profileTo, label: "Profile", icon: (f) => <UserIcon filled={f} /> },
    { to: "/edit", label: "Settings", icon: (f) => <GearIcon filled={f} /> },
  ];
}

function NavRow({ item, kind }: { item: NavItem; kind: "rail" | "tab" }) {
  const cls = kind === "rail" ? "rail-link" : "tab-link";
  const inner = (active: boolean) => (
    <>
      <span className="nav-ico">
        {item.icon(active)}
        {item.badge ? <span className="nav-badge">{item.badge > 9 ? "9+" : item.badge}</span> : null}
      </span>
      <span className="nav-label">{item.label}</span>
    </>
  );
  return (
    <NavLink className={({ isActive }) => cls + (isActive ? " on" : "")} to={item.to} end={item.end}>
      {({ isActive }) => inner(isActive)}
    </NavLink>
  );
}

/** The desktop left rail: nav at the top, the account chip pinned to the bottom. */
export function NavRail({ viewer }: { viewer: Member | null }) {
  const unread = useUnreadCount(!!viewer);
  const items = navItems(unread, ownProfilePath(viewer));
  return (
    <div className="rail">
      <nav className="rail-nav" aria-label="Primary">
        {items.map((it) => <NavRow key={it.label} item={it} kind="rail" />)}
      </nav>
      <div className="rail-foot">
        {viewer ? <AvatarMenu viewer={viewer} /> : <LoggedOutChip />}
      </div>
    </div>
  );
}

/** The mobile bottom tab bar — the same destinations as icon tabs. */
export function MobileTabs() {
  const { viewer } = useViewer();
  const unread = useUnreadCount(!!viewer);
  const items = navItems(unread, ownProfilePath(viewer));
  return (
    <nav className="tabbar" aria-label="Primary">
      {items.map((it) => <NavRow key={it.label} item={it} kind="tab" />)}
    </nav>
  );
}

function LoggedOutChip() {
  const location = useLocation();
  const here = location.pathname + location.search + location.hash;
  return (
    <Link className="loggedout-chip" to={`/auth?return=${encodeURIComponent(here)}`}>
      <span className="loggedout-avatar" aria-hidden="true">?</span>
      <span className="who-id">
        <span className="who-name">Logged out</span>
        <span className="who-sub">Sign up or sign in</span>
      </span>
      <span className="who-chev" aria-hidden="true">›</span>
    </Link>
  );
}

/* Icons — outline (inactive) + solid (active). Inlined so the rail needs no runtime. */
function Line({ children }: { children: ReactNode }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
function Solid({ children }: { children: ReactNode }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">{children}</svg>;
}

const HomeIcon = ({ filled }: { filled?: boolean }) =>
  filled
    ? <Solid><path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z" /></Solid>
    : <Line><path d="M3 9.5 12 3l9 6.5" /><path d="M5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10" /></Line>;

const BookmarkIcon = ({ filled }: { filled?: boolean }) => {
  const d = "m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z";
  return filled ? <Solid><path d={d} /></Solid> : <Line><path d={d} /></Line>;
};

const ChatIcon = ({ filled }: { filled?: boolean }) => {
  const d = "M7.9 20A9 9 0 1 0 4 16.1L2 22z";
  return filled ? <Solid><path d={d} /></Solid> : <Line><path d={d} /></Line>;
};

const UserIcon = ({ filled }: { filled?: boolean }) =>
  filled
    ? <Solid><path d="M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM4 21a8 8 0 0 1 16 0z" /></Solid>
    : <Line><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></Line>;

const GEAR = "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z";
const GearIcon = ({ filled }: { filled?: boolean }) =>
  filled
    ? <Solid><path fillRule="evenodd" clipRule="evenodd" d={`${GEAR}M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z`} /></Solid>
    : <Line><path d={GEAR} /><circle cx="12" cy="12" r="3" /></Line>;
