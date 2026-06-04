/*
 * The left rail (desktop) and the bottom tab bar (mobile) are two faces of one nav.
 * Both walk the same NAV_ITEMS list, so the destinations stay in sync. Home, Saved,
 * Chat and Settings are in-app routes; Profile points at your public /@handle, which
 * the server renders, so it's a plain link out of the SPA. The rail also carries the
 * account chip (avatar → log out) pinned to its foot.
 */
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import type { Member } from "../api";
import { AvatarMenu } from "./AvatarMenu";
import { useUnreadCount } from "./hooks";

type NavItem = { to: string; label: string; icon: ReactNode; external?: boolean; end?: boolean; badge?: number };

function navItems(viewer: Member, unread: number): NavItem[] {
  return [
    { to: "/", label: "Home", icon: <HomeIcon />, end: true },
    { to: "/saved", label: "Saved", icon: <BookmarkIcon /> },
    { to: "/messages", label: "Chat", icon: <ChatIcon />, badge: unread },
    { to: viewer.handle ? `/@${viewer.handle}` : "/edit", label: "Profile", icon: <UserIcon />, external: !!viewer.handle },
    { to: "/edit", label: "Settings", icon: <GearIcon /> },
  ];
}

function NavRow({ item, kind }: { item: NavItem; kind: "rail" | "tab" }) {
  const cls = kind === "rail" ? "rail-link" : "tab-link";
  const inner = (
    <>
      <span className="nav-ico">
        {item.icon}
        {item.badge ? <span className="nav-badge">{item.badge > 9 ? "9+" : item.badge}</span> : null}
      </span>
      <span className="nav-label">{item.label}</span>
    </>
  );
  return item.external ? (
    <a className={cls} href={item.to}>{inner}</a>
  ) : (
    <NavLink className={({ isActive }) => cls + (isActive ? " on" : "")} to={item.to} end={item.end}>
      {inner}
    </NavLink>
  );
}

/** The desktop left rail: nav at the top, the account chip pinned to the bottom. */
export function NavRail({ viewer }: { viewer: Member }) {
  const unread = useUnreadCount();
  const items = navItems(viewer, unread);
  return (
    <div className="rail">
      <nav className="rail-nav" aria-label="Primary">
        {items.map((it) => <NavRow key={it.label} item={it} kind="rail" />)}
      </nav>
      <div className="rail-foot">
        <AvatarMenu viewer={viewer} />
      </div>
    </div>
  );
}

/** The mobile bottom tab bar — the same destinations as icon tabs. */
export function MobileTabs({ viewer }: { viewer: Member }) {
  const unread = useUnreadCount();
  const items = navItems(viewer, unread);
  return (
    <nav className="tabbar" aria-label="Primary">
      {items.map((it) => <NavRow key={it.label} item={it} kind="tab" />)}
    </nav>
  );
}

/* Lucide icons (https://lucide.dev), inlined so the rail needs no icon runtime. */
function Ico({ children }: { children: ReactNode }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
const HomeIcon = () => <Ico><path d="M3 9.5 12 3l9 6.5" /><path d="M5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10" /></Ico>;
const BookmarkIcon = () => <Ico><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></Ico>;
const ChatIcon = () => <Ico><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z" /></Ico>;
const UserIcon = () => <Ico><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></Ico>;
const GearIcon = () => (
  <Ico>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </Ico>
);
