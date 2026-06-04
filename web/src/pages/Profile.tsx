/*
 * Your profile, in-app — the owner's view of /@you, living inside the feed shell
 * (nav rail + main + right rail). The main column mirrors the public, server-rendered
 * profile (identity, site preview, counts, the notes left on your site); the right
 * rail carries the owner-only bits: the add/verify-your-site CTA and your pinned
 * showcase. The public page at /@handle stays server-rendered for visitors + crawlers.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  getInbox, getPinned, getStats, orEmpty,
  type InboxNote, type Member, type PinnedSite, type Stats,
} from "../api";
import { useViewer } from "../providers";
import { host, isReaction, profileHref, relTime, socialLabel } from "../lib";
import { Avatar, PageHead, SiteThumbnail } from "../ui";
import { FeedLayout } from "../home/FeedLayout";
import { SiteCTA } from "../home/parts";

export function Profile() {
  const { viewer } = useViewer();
  const [stats, setStats] = useState<Stats | null>(null);
  const [notes, setNotes] = useState<InboxNote[]>([]);
  const [pinned, setPinned] = useState<PinnedSite[]>([]);

  useEffect(() => {
    if (!viewer) return;
    let alive = true;
    getStats(viewer.id).then((s) => alive && setStats(s)).catch(() => {});
    orEmpty(getInbox()).then((n) => alive && setNotes(n));
    orEmpty(getPinned()).then((p) => alive && setPinned(p));
    return () => { alive = false; };
  }, [viewer?.id]);

  if (!viewer) return null;
  const publicNotes = notes.filter((n) => n.visibility === "public");

  return (
    <FeedLayout viewer={viewer} rail={<ProfileRail viewer={viewer} pinned={pinned} />}>
      <div className="profile-page">
        <PageHead title="Profile" />

        <div className="phero">
          <div className="pid">
            <Avatar of={viewer} />
            <div>
              <div className="pname">{viewer.name || "You"}</div>
              {viewer.url ? (
                <div className="purl">
                  <a href={viewer.url} target="_blank" rel="noopener">{host(viewer.url)}</a>
                  {!viewer.verified && <span className="unverified"> (unverified)</span>}
                </div>
              ) : (
                <div className="phandle">@{viewer.handle}</div>
              )}
              {viewer.links && viewer.links.length > 0 && (
                <div className="plinks">
                  {viewer.links.map((u) => (
                    <a key={u} className="plink" href={u} target="_blank" rel="me noopener">{socialLabel(u)}</a>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="phero-actions">
            <Link className="btn primary pfollow" to="/edit">Edit profile</Link>
          </div>
        </div>

        {stats && (
          <div className="pcounts-row">
            <span className="pcount"><b>{stats.following.toLocaleString()}</b> Following</span>
            <span className="pcount"><b>{stats.followers.toLocaleString()}</b> Followers</span>
          </div>
        )}

        {viewer.url && (
          <a className="psite-wrap" href={viewer.url} target="_blank" rel="noopener" aria-label="View your site">
            <SiteThumbnail site={viewer} className="psite-img" />
          </a>
        )}

        <section className="pcomments">
          <h2 className="pside-head">Notes on your site</h2>
          {publicNotes.length ? (
            <div className="cmt-list">
              {publicNotes.map((n) => <CommentRow key={n.id} note={n} />)}
            </div>
          ) : (
            <div className="empty">No notes yet. When someone writes on your site, it shows up here.</div>
          )}
        </section>
      </div>
    </FeedLayout>
  );
}

// One note left on your site, mirroring the public profile's comment row (.cmt).
function CommentRow({ note }: { note: InboxNote }) {
  const a = note.author;
  const name = a.name || "Someone";
  const react = isReaction(note.body) ? note.body.trim() : "";
  const href = a.handle ? `/@${a.handle}` : a.url || "";
  const inner = (
    <>
      <Avatar of={a} />
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
            <div className="body">{note.body}</div>
          </>
        )}
      </div>
    </>
  );
  return href ? (
    <a className="cmt" href={href} target={a.handle ? undefined : "_blank"} rel="noopener">{inner}</a>
  ) : (
    <div className="cmt">{inner}</div>
  );
}

// The owner-only right rail: add/verify-your-site, then the pinned showcase.
function ProfileRail({ viewer, pinned }: { viewer: Member; pinned: PinnedSite[] }) {
  return (
    <div className="rail-r">
      <SiteCTA viewer={viewer} />
      <section className="rail-block">
        <div className="rail-block-head"><h2>Pinned</h2></div>
        {pinned.length ? (
          <div className="pins pins-col">
            {pinned.map((p) => (
              <a
                key={p.id} className="pin"
                href={p.url || profileHref(p)}
                target={p.url ? "_blank" : undefined} rel="noopener"
              >
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
              </a>
            ))}
          </div>
        ) : (
          <p className="rail-empty">Pin a site from anyone's page to feature it here, up to three.</p>
        )}
      </section>
    </div>
  );
}
