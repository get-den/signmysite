/*
 * The profile page — for ANYONE, signed in or not, inside the feed shell (nav rail +
 * center + right rail). This is the ONE profile layout: /@<handle> (the shareable URL)
 * and /profile both land here. Your own (/profile, or /@<your-handle>) is the owner
 * view: Edit profile, the add/verify-site CTA + your pinned showcase in the rail, and
 * the notes left on your site. Someone else's (/@<handle>) is the visitor view: Follow +
 * Message, their site preview, their public notes, and their pinned showcase. Both
 * share the same presentational pieces below.
 */
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router-dom";
import {
  ApiError, follow as apiFollow, getAnalytics, getInbox, getPinned, getPublicProfile, getStats, orEmpty,
  postComment, save as apiSave, togglePin,
  type Analytics, type Member, type NoteAuthor, type PinnedSite, type ProfileComment, type PublicProfile, type Stats,
} from "../api";
import { useToast, useViewer } from "../providers";
import { host, isReaction, profilePath, relTime, socialLabel } from "../lib";
import { Avatar, Button, CheckIcon, CommentBody, EmptyState, IdentityLink, Loading, PageHead, PinIcon, SiteThumbnail, Spinner } from "../ui";
import { FeedLayout } from "../home/FeedLayout";
import { FollowButton } from "../home/parts";
import { SiteStats } from "../home/SiteStats";

/** `handle` comes from the /@<handle> route (AtRoute in App.tsx); /profile passes none. */
export function Profile({ handle }: { handle?: string }) {
  const { viewer, loading } = useViewer();
  if (loading) return <Loading />;
  const own = viewer && (!handle || handle.toLowerCase() === (viewer.handle || "").toLowerCase());
  if (own) return <OwnerProfile viewer={viewer} />;
  if (!handle) return null; // /profile is Protected; signed-out never reaches here
  return <MemberProfile handle={handle} viewer={viewer ?? null} />;
}

/* ---- your own profile ---------------------------------------------------- */

function OwnerProfile({ viewer }: { viewer: Member }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [notes, setNotes] = useState<NoteLike[]>([]);
  const [pinned, setPinned] = useState<PinnedSite[]>([]);
  // The full last-30-days breakdown — only your own verified site has anything to show.
  const [analytics, setAnalytics] = useState<Analytics | null>(null);

  useEffect(() => {
    let alive = true;
    getStats(viewer.id).then((s) => alive && setStats(s)).catch(() => {});
    orEmpty(getInbox()).then((n) => alive && setNotes(n));
    orEmpty(getPinned()).then((p) => alive && setPinned(p));
    if (viewer.verified) getAnalytics("month").then((a) => alive && setAnalytics(a)).catch(() => {});
    return () => { alive = false; };
  }, [viewer.id, viewer.verified]);

  const publicNotes = notes.filter((n) => n.visibility === "public");
  return (
    <FeedLayout viewer={viewer} rail={<OwnerRail viewer={viewer} pinned={pinned} analytics={analytics} />} railBelow>
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
          empty="No comments yet. They'll show up here."
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
          <EmptyState>No @{handle} here.</EmptyState>
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
      .catch(() => { setStats(prev); toast("Couldn't follow. Try again."); })
      .finally(() => setBusy(false));
  };

  return (
    <FeedLayout viewer={viewer} rail={<MemberRail member={m} pinned={data.pinned} />} railBelow>
      <div className="profile-page">
        <PageHead title={m.name || `@${m.handle}`} />
        <ProfileHero member={m}>
          {!isSelf && (
            viewer ? (
              <>
                <FollowButton following={profileStats.viewerFollows} onToggle={toggleFollow} sm={false} />
                <ViewerSiteActions member={m} stats={profileStats} onStats={setStats} />
              </>
            ) : (
              <Link className="btn primary pfollow" to={authRoute}>Follow</Link>
            )
          )}
        </ProfileHero>
        {m.claimed === false && (
          <div className="profile-claim" role="note">
            <span>
              This site was added by a reader and hasn’t been claimed yet.{" "}
              <b>Is it yours?</b> Add the widget and verify to claim it — you’ll inherit
              every save, follow, and note it’s collected.
            </span>
            <Link className="btn sm pink" to={viewer ? `/verify?site=${encodeURIComponent(host(m.url || ""))}` : authRoute}>Claim this site</Link>
          </div>
        )}
        <Counts following={profileStats.following} followers={profileStats.followers} />
        <SitePreviewImg member={m} label={`View ${m.name}'s site`} />
        <NotesSection
          heading={`Comments on ${firstName}'s site`}
          notes={publicNotes}
          empty="No comments here yet."
          composer={
            isSelf ? null : (
              <CommentComposer
                targetId={m.id}
                viewer={viewer}
                authRoute={authRoute}
                onPosted={(comments) => setData((d) => (d ? { ...d, comments } : d))}
              />
            )
          }
        />
      </div>
    </FeedLayout>
  );
}

// Save + Pin, surfaced directly in the hero (no overflow menu). Both write through
// to the viewer's account and refresh the target's stats so the labels flip in place.
function ViewerSiteActions({
  member,
  stats,
  onStats,
}: {
  member: Member;
  stats: Stats;
  onStats: (stats: Stats) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<"save" | "pin" | null>(null);

  async function saveSite() {
    if (busy) return;
    setBusy("save");
    try {
      const next = await apiSave(member.id);
      onStats(next);
      toast(next.viewerSaved ? "Saved." : "Removed from saved.");
    } catch {
      toast("Couldn't save. Try again.");
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
    } catch (e) {
      toast(e instanceof ApiError && e.status === 409
        ? "You can pin 3 sites. Unpin one first."
        : "Couldn't pin. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Button
        className={"psecondary" + (stats.viewerSaved ? " on" : "")}
        loading={busy === "save"}
        aria-pressed={stats.viewerSaved}
        onClick={saveSite}
      >
        {stats.viewerSaved ? "Saved" : "Save"}
      </Button>
      <Button
        className={"psecondary" + (stats.viewerPinned ? " on" : "")}
        loading={busy === "pin"}
        aria-pressed={stats.viewerPinned}
        onClick={pinSite}
      >
        <PinIcon filled={stats.viewerPinned} />
        {stats.viewerPinned ? "Pinned" : "Pin"}
      </Button>
    </>
  );
}

/**
 * Leave a public comment on someone's site, inline at the foot of the comment
 * section — the one way a visitor reaches out. Signed-in only (the server is the
 * gate); a signed-out visitor sees a single sign-in link instead. On success the
 * server hands back the refreshed list, so the new comment appears instantly with
 * no refetch. Empty/whitespace is disabled, double-submit is guarded, and ⌘/Ctrl+↵
 * sends.
 */
function CommentComposer({
  targetId,
  viewer,
  authRoute,
  onPosted,
}: {
  targetId: string;
  viewer: Member | null;
  authRoute: string;
  onPosted: (comments: ProfileComment[]) => void;
}) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  if (!viewer) {
    return (
      <div className="cmt-composer cmt-composer-out">
        <Link className="btn" to={authRoute}>Sign in to comment</Link>
      </div>
    );
  }

  const ready = text.trim().length > 0 && !busy;
  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      const comments = await postComment(targetId, text.trim(), "public");
      setText("");
      onPosted(comments);
    } catch (e) {
      toast(e instanceof ApiError && e.status === 429
        ? "You've commented here a lot today. Try again tomorrow."
        : "Couldn't post comment. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cmt-composer">
      <Avatar of={viewer} />
      <div className="cmt-composer-main">
        <textarea
          className="cmt-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); submit(); }
          }}
          placeholder="Leave a comment…"
          rows={2}
          maxLength={1000}
          aria-label="Leave a comment"
        />
        <div className="cmt-composer-actions">
          <Button className="primary sm" loading={busy} disabled={!ready} onClick={submit}>Comment</Button>
        </div>
      </div>
    </div>
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
      {/* The preview itself opens the site; the hero already shows the host under the name. */}
      <a className="psite-wrap" href={member.url} target="_blank" rel="noopener" aria-label={label}>
        <SiteThumbnail site={member} className="psite-img" />
        <span className="psite-open" aria-hidden="true"><ExternalLinkIcon /></span>
      </a>
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

function NotesSection({ heading, notes, empty, composer }: { heading: string; notes: NoteLike[]; empty: string; composer?: ReactNode }) {
  useHighlightOnNavigate(notes.length > 0);
  return (
    <section className="pcomments">
      <h2 className="pside-head">{heading}</h2>
      {notes.length ? (
        <div className="cmt-list">{notes.map((n) => <CommentRow key={n.id} note={n} />)}</div>
      ) : (
        // With a composer present, its placeholder is invitation enough — skip the
        // empty line so the section never reads as both "no comments" and a prompt.
        composer ? null : <div className="empty">{empty}</div>
      )}
      {composer}
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

/* ---- right rails --------------------------------------------------------- */

// Your rail: the widget box (your door to /verify), then the full analytics (the home
// feed's "See more" lands here), then your pinned showcase.
function OwnerRail({ viewer, pinned, analytics }: { viewer: Member; pinned: PinnedSite[]; analytics: Analytics | null }) {
  return (
    <div className="rail-r">
      <WidgetBox viewer={viewer} />
      {viewer.verified && <SiteStats analytics={analytics} />}
      <PinnedBlock pinned={pinned} empty="Pin up to 3 sites to feature them here." />
    </div>
  );
}

/**
 * The widget box at the top of your own rail — one always-present door to the /verify
 * setup page. The copy reads right in every state but the destination never changes:
 * the single place to add, re-check, or change your widget. Pink while there's setup
 * left to do; calm white once your widget is live.
 */
function WidgetBox({ viewer }: { viewer: Member }) {
  const todo = !viewer.verified; // no site linked yet, or linked but unverified
  const title = viewer.verified
    ? "Your widget is live"
    : viewer.url ? "Finish your setup" : "Add signmysite to your site";
  const sub = viewer.verified
    ? "See it, re-check it, or change how it's installed."
    : viewer.url
      ? `Add the one-line widget to ${host(viewer.url)} to verify and unlock analytics.`
      : "Paste a one-line widget on your site to go live.";
  return (
    <Link className={"rail-block widget-box" + (todo ? " is-todo" : "")} to="/verify">
      <div className="cta-head">
        <h2>
          {viewer.verified && <span className="widget-tick" aria-hidden="true"><CheckIcon size={16} /></span>}
          {title}
        </h2>
        <p>{sub}</p>
      </div>
      <span className="widget-box-go" aria-hidden="true"><ChevronRightIcon /></span>
    </Link>
  );
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
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
  // Hovering a pin fades in that site's og:image beside it. The preview is portaled
  // to <body> with fixed positioning so the rail's own overflow never clips it, and
  // clamped to the viewport so it always lands on-screen, on the right.
  const [preview, setPreview] = useState<{ site: PinnedSite; top: number; left: number } | null>(null);
  const open = (site: PinnedSite, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const W = 240, H = 126, gap = 14, m = 12;
    // Sit just to the right of the pin; if the viewport edge is too close, slide back
    // in so it never clips. Vertically centered on the pin row so it reads as "this one".
    const left = Math.min(r.right + gap, window.innerWidth - W - m);
    const top = Math.min(Math.max(m, r.top + r.height / 2 - H / 2), window.innerHeight - H - m);
    setPreview({ site, left, top });
  };
  const close = () => setPreview(null);

  return (
    <section className="rail-block pins-block">
      <div className="rail-block-head"><h2>Pinned</h2></div>
      {pinned.length ? (
        <div className="pins pins-col">
          {pinned.map((p) => {
            // A pin points at the real site (open it) when it has a URL; otherwise the
            // pinned member's in-app profile.
            const inApp = p.url ? null : profilePath(p);
            // Only sites with a real og:image get the hover preview.
            const onEnter = p.thumbnail ? (e: { currentTarget: HTMLElement }) => open(p, e.currentTarget) : undefined;
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
              <Link key={p.id} className="pin" to={inApp} onMouseEnter={onEnter} onMouseLeave={close}>{body}</Link>
            ) : (
              <a key={p.id} className="pin" href={p.url || "#"} target="_blank" rel="noopener" onMouseEnter={onEnter} onMouseLeave={close}>{body}</a>
            );
          })}
        </div>
      ) : (
        <div className="pins-empty">
          <span className="pins-empty-icon"><PinIcon /></span>
          <p className="pins-empty-text">{empty}</p>
        </div>
      )}
      {preview && createPortal(
        <div className="pin-preview" style={{ top: preview.top, left: preview.left }} aria-hidden="true">
          <SiteThumbnail site={preview.site} />
        </div>,
        document.body,
      )}
    </section>
  );
}
