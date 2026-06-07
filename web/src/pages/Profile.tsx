/*
 * The profile page, in-app — for ANYONE, inside the feed shell (nav rail + center + right
 * rail). Your own (/profile, or /u/<your-handle>) is the owner view: Edit profile, the
 * add/verify-site CTA + your pinned showcase in the rail, and the notes left on your site.
 * Someone else's (/u/<handle>) is the visitor view: Follow + Message, their site preview,
 * their public notes, and their pinned showcase. Both share the same presentational
 * pieces below. The public, server-rendered /@<handle> page stays for logged-out
 * visitors + crawlers.
 */
import { useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import {
  ApiError, follow as apiFollow, getInbox, getPinned, getPublicProfile, getStats, orEmpty,
  save as apiSave, togglePin,
  type Member, type NoteAuthor, type PinnedSite, type PublicProfile, type Stats,
} from "../api";
import { useToast, useViewer } from "../providers";
import { host, isReaction, profilePath, relTime, socialLabel } from "../lib";
import { Avatar, EmptyState, IdentityLink, PageHead, SiteThumbnail, Spinner } from "../ui";
import { FeedLayout } from "../home/FeedLayout";
import { FollowButton, SiteCTA } from "../home/parts";

export function Profile() {
  const { handle } = useParams();
  const { viewer } = useViewer();
  if (!viewer) return null; // both /profile and /u/:handle are Protected; this is just a type guard
  const own = !handle || handle.toLowerCase() === (viewer.handle || "").toLowerCase();
  return own ? <OwnerProfile viewer={viewer} /> : <MemberProfile handle={handle!} viewer={viewer} />;
}

/* ---- your own profile ---------------------------------------------------- */

function OwnerProfile({ viewer }: { viewer: Member }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [notes, setNotes] = useState<NoteLike[]>([]);
  const [pinned, setPinned] = useState<PinnedSite[]>([]);

  useEffect(() => {
    let alive = true;
    getStats(viewer.id).then((s) => alive && setStats(s)).catch(() => {});
    orEmpty(getInbox()).then((n) => alive && setNotes(n));
    orEmpty(getPinned()).then((p) => alive && setPinned(p));
    return () => { alive = false; };
  }, [viewer.id]);

  const publicNotes = notes.filter((n) => n.visibility === "public");
  return (
    <FeedLayout viewer={viewer} rail={<OwnerRail viewer={viewer} pinned={pinned} />}>
      <div className="profile-page">
        <PageHead title="Profile" />
        <ProfileHero member={viewer} unverified={!!viewer.url && !viewer.verified}>
          <Link className="btn primary pfollow" to="/edit">Edit profile</Link>
        </ProfileHero>
        {stats && <Counts following={stats.following} followers={stats.followers} />}
        <SitePreviewImg member={viewer} label="View your site" />
        <NotesSection
          heading="Comments on your site"
          notes={publicNotes}
          empty="No comments yet. When someone writes on your site, it shows up here."
        />
      </div>
    </FeedLayout>
  );
}

/* ---- someone else's profile ---------------------------------------------- */

function MemberProfile({ handle, viewer }: { handle: string; viewer: Member | null }) {
  const location = useLocation();
  const toast = useToast();
  const [data, setData] = useState<PublicProfile | null>(null);
  const [missing, setMissing] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null); setStats(null); setMissing(false);
    getPublicProfile(handle)
      .then((d) => { if (!alive) return; setData(d); setStats(d.stats); })
      .catch(() => alive && setMissing(true));
    return () => { alive = false; };
  }, [handle]);

  if (missing) {
    return (
      <FeedLayout viewer={viewer}>
        <div className="profile-page"><PageHead title="Profile" />
          <EmptyState>We couldn't find @{handle}.</EmptyState>
        </div>
      </FeedLayout>
    );
  }
  if (!data) {
    return (
      <FeedLayout viewer={viewer}>
        <div className="feed-loading"><Spinner size={22} /></div>
      </FeedLayout>
    );
  }

  const m = data.member;
  const profileStats = stats ?? data.stats;
  const isSelf = m.id === viewer?.id;
  const publicNotes = data.comments.filter((n) => !n.redacted);
  const firstName = (m.name || "they").split(/\s+/)[0];
  const authRoute = `/auth?return=${encodeURIComponent(location.pathname + location.search + location.hash)}`;

  const toggleFollow = () => {
    if (busy) return;
    setBusy(true);
    const prev = profileStats;
    const willFollow = !profileStats.viewerFollows;
    setStats({
      ...profileStats,
      viewerFollows: willFollow,
      followers: Math.max(0, profileStats.followers + (willFollow ? 1 : -1)),
    });
    apiFollow(m.id)
      .then(setStats)
      .catch(() => { setStats(prev); toast("Couldn't update follow. Try again."); })
      .finally(() => setBusy(false));
  };

  return (
    <FeedLayout viewer={viewer} rail={<MemberRail member={m} pinned={data.pinned} />}>
      <div className="profile-page">
        <PageHead title={m.name || `@${m.handle}`} />
        <ProfileHero member={m}>
          {!isSelf && (
            <>
              {viewer ? (
                <>
                  <FollowButton following={profileStats.viewerFollows} onToggle={toggleFollow} sm={false} />
                  <ProfileMoreMenu member={m} stats={profileStats} onStats={setStats} />
                </>
              ) : (
                <>
                  <Link className="btn primary pfollow" to={authRoute}>Follow</Link>
                  <Link className="btn" to={authRoute}>Message</Link>
                </>
              )}
            </>
          )}
        </ProfileHero>
        <Counts following={profileStats.following} followers={profileStats.followers} />
        <SitePreviewImg member={m} label={`View ${m.name}'s site`} />
        <NotesSection heading={`Comments on ${firstName}'s site`} notes={publicNotes} empty="No comments here yet." />
      </div>
    </FeedLayout>
  );
}

function ProfileMoreMenu({
  member,
  stats,
  onStats,
}: {
  member: Member;
  stats: Stats;
  onStats: (stats: Stats) => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"save" | "pin" | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function saveSite() {
    if (busy) return;
    setBusy("save");
    try {
      const next = await apiSave(member.id);
      onStats(next);
      toast(next.viewerSaved ? "Saved." : "Removed from saved.");
      setOpen(false);
    } catch {
      toast("Couldn't update saved. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function pinSite() {
    if (busy) return;
    setBusy("pin");
    try {
      const next = await togglePin(member.id);
      onStats(next);
      toast(next.viewerPinned ? "Pinned to your profile." : "Removed from pinned.");
      setOpen(false);
    } catch (e) {
      toast(e instanceof ApiError && e.status === 409
        ? "You can pin up to 3 sites. Unpin one first."
        : "Couldn't update pinned. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="pmore" ref={ref}>
      <button
        type="button"
        className={"pmore-trigger" + (open ? " on" : "")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More profile actions"
        onClick={() => setOpen((v) => !v)}
      >
        <DotsIcon />
      </button>
      {open && (
        <div className="pmore-pop" role="menu">
          <Link className="pmore-item" to={`/messages/${member.id}`} role="menuitem">Message</Link>
          <button className="pmore-item" type="button" role="menuitem" disabled={busy === "save"} onClick={saveSite}>
            {stats.viewerSaved ? "Saved" : "Save"}
          </button>
          <button className="pmore-item" type="button" role="menuitem" disabled={busy === "pin"} onClick={pinSite}>
            {stats.viewerPinned ? "Pinned" : "Pin"}
          </button>
        </div>
      )}
    </div>
  );
}

function DotsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="6" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="18" cy="12" r="1.8" />
    </svg>
  );
}

/* ---- shared presentational pieces ---------------------------------------- */

function ProfileHero({ member, unverified, children }: { member: Member; unverified?: boolean; children?: ReactNode }) {
  return (
    <div className="phero">
      <div className="pid">
        <Avatar of={member} />
        <div>
          <div className="pname">{member.name || (member.handle ? `@${member.handle}` : "Someone")}</div>
          {member.url ? (
            <div className="purl">
              <a href={member.url} target="_blank" rel="noopener">{host(member.url)}</a>
              {unverified && <span className="unverified"> (unverified)</span>}
            </div>
          ) : (
            <div className="phandle">@{member.handle}</div>
          )}
          {member.links && member.links.length > 0 && (
            <div className="plinks">
              {member.links.map((u) => (
                <a key={u} className="plink" href={u} target="_blank" rel="me noopener">{socialLabel(u)}</a>
              ))}
            </div>
          )}
        </div>
      </div>
      {children && <div className="phero-actions">{children}</div>}
    </div>
  );
}

function Counts({ following, followers }: { following: number; followers: number }) {
  return (
    <div className="pcounts-row">
      <span className="pcount"><b>{following.toLocaleString()}</b> Following</span>
      <span className="pcount"><b>{followers.toLocaleString()}</b> Followers</span>
    </div>
  );
}

function SitePreviewImg({ member, label }: { member: Member; label: string }) {
  if (!member.url) return null;
  return (
    <div className="psite-block">
      <a className="psite-wrap" href={member.url} target="_blank" rel="noopener" aria-label={label}>
        <SiteThumbnail site={member} className="psite-img" />
        <span className="psite-open" aria-hidden="true"><ExternalLinkIcon /></span>
      </a>
      <div className="psite-actions">
        <a className="btn psite-view" href={member.url} target="_blank" rel="noopener">
          View site <ExternalLinkIcon />
        </a>
        <span className="psite-host">{host(member.url)}</span>
      </div>
    </div>
  );
}

function ExternalLinkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 17 17 7" />
      <path d="M9 7h8v8" />
    </svg>
  );
}

// Slack-style "jump to": when the URL hash points at an element on this page
// (...#comment-<id>), scroll it into view and flash a highlight that fades out,
// then pull the class back off so a later jump can replay it. React app only.
function useHighlightOnNavigate(ready: boolean) {
  const { hash } = useLocation();
  useEffect(() => {
    if (!ready || !hash) return;
    const el = document.getElementById(hash.slice(1));
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("highlight-element-on-navigate");
    const t = setTimeout(() => el.classList.remove("highlight-element-on-navigate"), 4200);
    return () => clearTimeout(t);
  }, [hash, ready]);
}

function NotesSection({ heading, notes, empty }: { heading: string; notes: NoteLike[]; empty: string }) {
  useHighlightOnNavigate(notes.length > 0);
  return (
    <section className="pcomments">
      <h2 className="pside-head">{heading}</h2>
      {notes.length ? (
        <div className="cmt-list">{notes.map((n) => <CommentRow key={n.id} note={n} />)}</div>
      ) : (
        <div className="empty">{empty}</div>
      )}
    </section>
  );
}

// One note left on a site. Shared by both views: an incoming inbox note (yours) and a
// public note on someone else's profile have the same shape here. The author chip opens
// their in-app profile.
type NoteLike = { id: string; body: string | null; visibility: "public" | "private"; created: string; author: NoteAuthor | null };
function CommentRow({ note }: { note: NoteLike }) {
  const a = note.author;
  const name = a?.name || "Someone";
  const react = note.body && isReaction(note.body) ? note.body.trim() : "";
  const inner = (
    <>
      <Avatar of={a ?? { name: "?" }} />
      <div className="meta">
        {react ? (
          <div className="cmt-line">
            <span className="who">{name}</span>
            <span className="act"> reacted with </span>
            <span className="react-emoji">{react}</span>
            <time className="cmt-time">{relTime(note.created)}</time>
          </div>
        ) : (
          <>
            <div className="cmt-line"><span className="who">{name}</span><time className="cmt-time">{relTime(note.created)}</time></div>
            <CommentBody text={note.body ?? ""} />
          </>
        )}
      </div>
    </>
  );
  const anchor = `comment-${note.id}`;
  return a
    ? <IdentityLink of={a} id={anchor} className="cmt">{inner}</IdentityLink>
    : <div id={anchor} className="cmt">{inner}</div>;
}

// A comment body that clamps to a few lines with a YouTube-style "Read more"
// toggle. Inline (not a click-through) since the row already links to the author;
// the toggle stops that navigation. A span, not a <button>, to stay valid inside
// the row's anchor.
function CommentBody({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || expanded) return; // measure only while clamped
    const measure = () => setOverflowing(el.scrollHeight - el.clientHeight > 1);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [text, expanded]);

  const toggle = (e: SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setExpanded((v) => !v);
  };

  return (
    <>
      <div ref={ref} className={expanded ? "cmt-body is-expanded" : "cmt-body"}>{text}</div>
      {(overflowing || expanded) && (
        <span
          className="cmt-more"
          role="button"
          tabIndex={0}
          onClick={toggle}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") toggle(e); }}
        >
          {expanded ? "Show less" : "Read more"}
        </span>
      )}
    </>
  );
}

/* ---- right rails --------------------------------------------------------- */

// Your rail: add/verify-your-site CTA, then your pinned showcase.
function OwnerRail({ viewer, pinned }: { viewer: Member; pinned: PinnedSite[] }) {
  return (
    <div className="rail-r">
      <SiteCTA viewer={viewer} />
      <PinnedBlock pinned={pinned} empty="Pin a site from anyone's page to feature it here, up to three." />
    </div>
  );
}

// Someone else's rail: just their pinned showcase.
function MemberRail({ member, pinned }: { member: Member; pinned: PinnedSite[] }) {
  const firstName = (member.name || "They").split(/\s+/)[0];
  return (
    <div className="rail-r">
      <PinnedBlock pinned={pinned} empty={`${firstName} hasn't pinned any sites yet.`} />
    </div>
  );
}

function PinnedBlock({ pinned, empty }: { pinned: PinnedSite[]; empty: string }) {
  return (
    <section className="rail-block">
      <div className="rail-block-head"><h2>Pinned</h2></div>
      {pinned.length ? (
        <div className="pins pins-col">
          {pinned.map((p) => {
            // A pin points at the real site (open it) when it has a URL; otherwise the
            // pinned member's in-app profile.
            const inApp = p.url ? null : profilePath(p);
            const body = (
              <>
                <Avatar of={p} />
                <div className="meta">
                  <div className="bn">{p.name || "Untitled"}</div>
                  <div className="bh">{p.url ? host(p.url) : "@" + (p.handle || "")}</div>
                </div>
                {p.notes.length > 0 && (
                  <div className="pin-notes">
                    {p.notes.map((n) => <span key={n.id} className="pin-bubble">{n.body}</span>)}
                  </div>
                )}
              </>
            );
            return inApp ? (
              <Link key={p.id} className="pin" to={inApp}>{body}</Link>
            ) : (
              <a key={p.id} className="pin" href={p.url || "#"} target="_blank" rel="noopener">{body}</a>
            );
          })}
        </div>
      ) : (
        <p className="rail-empty">{empty}</p>
      )}
    </section>
  );
}
