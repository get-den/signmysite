/*
 * Queue — "One thing at a time." The home as a focus mode: instead of a page full
 * of lists, you get a single card for the next thing that wants you — a reader to
 * follow back, a comment to answer, your site to verify. Act on it or skip, and it
 * advances. When the stack is empty you're done. Inbox-zero for your den: calm,
 * deliberate, one decision per screen.
 */
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { InboxNote, ViewerVisit } from "../api";
import { compact, host, isReaction, relTime } from "../lib";
import { Avatar, Button } from "../ui";
import type { HomeData } from "./data";

type Card =
  | { id: string; kind: "verify"; url: string }
  | { id: string; kind: "follow"; reader: ViewerVisit }
  | { id: string; kind: "comment"; note: InboxNote };

export function Queue({ data }: { data: HomeData }) {
  const { viewer, unfollowedReaders, notes, followBack } = data;
  const navigate = useNavigate();
  const [done, setDone] = useState<Set<string>>(new Set());

  // The stack, ordered by what matters: finish setup, then meet the people reading
  // you, then answer your notes.
  const stack = useMemo<Card[]>(() => {
    const out: Card[] = [];
    if (viewer.url && !viewer.verified) out.push({ id: "verify", kind: "verify", url: viewer.url });
    for (const r of unfollowedReaders) out.push({ id: "follow-" + r.id, kind: "follow", reader: r });
    for (const n of notes) out.push({ id: "comment-" + n.id, kind: "comment", note: n });
    return out;
  }, [viewer.url, viewer.verified, unfollowedReaders, notes]);

  const remaining = stack.filter((c) => !done.has(c.id));
  const current = remaining[0];
  const advance = (id: string) => setDone((d) => new Set(d).add(id));

  if (!current) {
    return (
      <div className="queue">
        <div className="q-clear">
          <div className="q-check" aria-hidden="true">✓</div>
          <h2>{stack.length ? "All clear" : "Nothing needs you"}</h2>
          <p>{stack.length
            ? "You've worked through everything that needed you. Come back when there's more."
            : "No readers to follow back, no notes to answer. Your site's out there doing its thing."}</p>
        </div>
      </div>
    );
  }

  const position = stack.length - remaining.length + 1;

  return (
    <div className="queue">
      <div className="q-progress">
        <span>{position} of {stack.length}</span>
        <div className="q-dots" aria-hidden="true">
          {stack.slice(0, 12).map((c) => <span key={c.id} className={"q-dot" + (done.has(c.id) ? " on" : "")} />)}
        </div>
      </div>

      <div className="q-card" key={current.id}>
        {current.kind === "verify" && (
          <>
            <div className="q-kicker">Finish setup</div>
            <h2 className="q-title">Verify your site</h2>
            <p className="q-text"><b>{host(current.url)}</b> is linked but not confirmed as yours yet. Add the one-line widget and you'll unlock your analytics.</p>
            <div className="q-actions">
              <Link className="btn primary lg" to="/verify">Verify site</Link>
              <button className="btn lg q-skip" onClick={() => advance(current.id)}>Later</button>
            </div>
          </>
        )}

        {current.kind === "follow" && (
          <>
            <div className="q-kicker">Reads you · {relTime(current.reader.lastSeen)}</div>
            <a className="q-who" href={current.reader.handle ? `/@${current.reader.handle}` : current.reader.url || "#"}>
              <Avatar of={current.reader} />
              <span className="q-who-meta">
                <b>{current.reader.name || `@${current.reader.handle ?? "someone"}`}</b>
                <span>
                  {current.reader.views === 1 ? "read your site" : `read your site ${compact(current.reader.views)} times`}
                  {current.reader.followsYou ? " · follows you" : ""}
                </span>
              </span>
            </a>
            <p className="q-text">They have a Den site you don't follow yet. Follow back to keep the thread going.</p>
            <div className="q-actions">
              <Button className="primary lg" onClick={() => { followBack(current.reader); advance(current.id); }}>Follow back</Button>
              <button className="btn lg q-skip" onClick={() => advance(current.id)}>Skip</button>
            </div>
          </>
        )}

        {current.kind === "comment" && <CommentCard note={current.note} navigate={navigate} onDone={() => advance(current.id)} />}
      </div>
    </div>
  );
}

function CommentCard({ note, navigate, onDone }: { note: InboxNote; navigate: ReturnType<typeof useNavigate>; onDone: () => void }) {
  const a = note.author;
  const react = isReaction(note.body) ? note.body.trim() : "";
  return (
    <>
      <div className="q-kicker">New note · {relTime(note.created)}</div>
      <a className="q-who" href={a.handle ? `/@${a.handle}` : a.url || "#"}>
        <Avatar of={a} />
        <span className="q-who-meta">
          <b>{a.name || "Someone"}</b>
          <span>{a.handle ? `@${a.handle}` : a.url ? host(a.url) : "left a note"}</span>
        </span>
      </a>
      {react
        ? <div className="q-reaction">{react}</div>
        : <p className="q-quote">{note.visibility === "private" ? "Private note" : note.body}</p>}
      <div className="q-actions">
        {a.id
          ? <Button className="primary lg" onClick={() => navigate(`/messages/${a.id}`)}>Reply</Button>
          : <Link className="btn primary lg" to="/notes">Open in Notes</Link>}
        <button className="btn lg q-skip" onClick={onDone}>Mark seen</button>
      </div>
    </>
  );
}
