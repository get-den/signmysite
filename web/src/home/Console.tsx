/*
 * Console — "Your site." The home as the executive summary of your OWN site. The
 * top of the page adapts to where you are: no site linked yet → a clear box to add
 * one; linked but unverified → a prompt to verify. Once you're set up, four numbers
 * answer "how is my site doing?" at a glance — views, visitors this week, new
 * comments (which take you straight to them), and how many people saved you —
 * followed by the latest comments and the readers worth following back.
 */
import { Link } from "react-router-dom";
import type { InboxNote } from "../api";
import { compact, isReaction, relTime } from "../lib";
import { Avatar } from "../ui";
import type { HomeData } from "./data";
import { Hint, ReaderRow, SiteCTA, StatCard } from "./parts";

export function Console({ data }: { data: HomeData }) {
  const { viewer, stats, analytics, notes, unfollowedReaders, newComments, followBack } = data;
  const hasSite = !!viewer.url;
  const saves = stats?.saved ?? 0;

  return (
    <div className="console">
      <SiteCTA viewer={viewer} />

      {hasSite ? (
        <>
          <section className="kpi-row" aria-label="Your site at a glance">
            <StatCard value={compact(analytics?.views ?? stats?.views)} label="Views" sub="all time" />
            <StatCard value={compact(analytics?.visitorsWeek)} label="Visitors" sub="this week" />
            <StatCard
              value={compact(newComments)} label="New comments" sub="this week"
              to="/notes" accent={newComments > 0}
            />
            <StatCard
              value={compact(saves)} label="Saves"
              sub={saves === 1 ? "person saved your site" : "people saved your site"}
            />
          </section>

          {notes.length > 0 && (
            <section className="console-block">
              <div className="block-head">
                <h3>Latest comments</h3>
                <Link className="block-all" to="/notes">View all →</Link>
              </div>
              <ul className="cmt-preview">
                {notes.slice(0, 3).map((n) => <CommentRow key={n.id} note={n} />)}
              </ul>
            </section>
          )}

          {unfollowedReaders.length > 0 && (
            <section className="console-block">
              <div className="block-head"><h3>Who's reading you</h3></div>
              <ul className="reader-list">
                {unfollowedReaders.slice(0, 4).map((w) => <ReaderRow key={w.id} who={w} onFollow={followBack} />)}
              </ul>
            </section>
          )}
        </>
      ) : (
        <Hint>
          Once your site is linked, this becomes your dashboard: views, visitors this week,
          new comments, and who's saved you.
        </Hint>
      )}
    </div>
  );
}

// One incoming comment, linking to its full view. Emoji-only notes read as a
// reaction; everything else shows a one-line preview.
function CommentRow({ note }: { note: InboxNote }) {
  const a = note.author;
  const react = isReaction(note.body) ? note.body.trim() : "";
  return (
    <li>
      <Link className="cmt-row" to={`/note/${note.id}`}>
        <Avatar of={a} />
        <span className="cmt-row-body">
          <span className="cmt-row-line">
            <b>{a.name || "Someone"}</b>
            {react ? <> reacted <span className="signal-react">{react}</span></> : null}
            <time>{relTime(note.created)}</time>
          </span>
          {!react && (
            <span className="cmt-row-text">{note.visibility === "private" ? "Private note" : note.body}</span>
          )}
        </span>
      </Link>
    </li>
  );
}
