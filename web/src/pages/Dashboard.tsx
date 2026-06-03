import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  getFollowing,
  getInbox,
  getSaved,
  getStats,
  orEmpty,
  type InboxNote,
  type Member,
  type Site,
  type Stats,
} from "../api";
import { Avatar, BlogRow } from "../ui";
import { compact } from "../lib";

/** Home: your site at a glance — views, recent comments, saved, following. */
export function Dashboard({ viewer }: { viewer: Member }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<InboxNote[]>([]);
  const [saved, setSaved] = useState<Site[]>([]);
  const [following, setFollowing] = useState<Site[]>([]);

  useEffect(() => {
    let alive = true;
    const set = <T,>(fn: (v: T) => void) => (v: T) => alive && fn(v);
    getStats(viewer.id).then(set(setStats)).catch(() => {});
    orEmpty(getInbox()).then(set(setRecent));
    orEmpty(getSaved()).then(set(setSaved));
    orEmpty(getFollowing()).then(set(setFollowing));
    return () => {
      alive = false;
    };
  }, [viewer.id]);

  return (
    <>
      <div className="dash-views">
        <span className="big">{compact(stats?.views)}</span>
        <span className="lbl">views</span>
      </div>
      <div className="dash-sub">
        {compact(stats?.followers)} followers · {compact(stats?.following)} following
      </div>

      <Section title="Recent comments" more={recent.length > 3 ? "/messages" : undefined}>
        {recent.length ? (
          recent.slice(0, 3).map((n) => <CommentLine key={n.id} note={n} />)
        ) : (
          <div className="empty">No comments yet.</div>
        )}
      </Section>

      <Section title="Saved">
        {saved.length ? (
          saved.map((b) => <BlogRow key={b.id} blog={b} />)
        ) : (
          <div className="empty">Nothing saved yet. Tap Save on any Den site.</div>
        )}
      </Section>

      <Section title="Following">
        {following.length ? (
          following.map((b) => <BlogRow key={b.id} blog={b} />)
        ) : (
          <div className="empty">You're not following anyone yet.</div>
        )}
      </Section>
    </>
  );
}

function Section({ title, more, children }: { title: string; more?: string; children: React.ReactNode }) {
  return (
    <div className="section">
      <div className="section-head">
        <h2>{title}</h2>
        {more && (
          <Link className="more" to={more}>
            View all →
          </Link>
        )}
      </div>
      {children}
    </div>
  );
}

/** A single incoming comment, compact — links into Messages. */
function CommentLine({ note }: { note: InboxNote }) {
  return (
    <Link className="cmt" to="/messages">
      <Avatar of={note.author} />
      <div className="meta">
        <div>
          <span className="who">{note.author.name || "Someone"}</span>
          {note.visibility === "private" && <span className="tag">private</span>}
        </div>
        <div className="body">{note.body}</div>
      </div>
    </Link>
  );
}
