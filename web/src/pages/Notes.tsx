import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getInbox, getOutgoing, orEmpty, type InboxNote, type OutgoingNote } from "../api";
import { Avatar, Loading } from "../ui";
import { host, isReaction, profileHref, relTime } from "../lib";

type Tab = "in" | "out";

/** Notes: triage every note — incoming (left on your site) and outgoing (notes you
 *  left elsewhere). Each incoming note from a Den member carries a Message button —
 *  the bridge from "someone commented on my site" straight into a conversation. */
export function Notes() {
  const [tab, setTab] = useState<Tab>("in");
  const [incoming, setIncoming] = useState<InboxNote[] | null>(null);
  const [outgoing, setOutgoing] = useState<OutgoingNote[] | null>(null);

  useEffect(() => {
    let alive = true;
    orEmpty(getInbox()).then((n) => alive && setIncoming(n));
    orEmpty(getOutgoing()).then((n) => alive && setOutgoing(n));
    return () => {
      alive = false;
    };
  }, []);

  const loading = tab === "in" ? incoming === null : outgoing === null;

  return (
    <>
      <h2 className="section">Notes</h2>
      <div className="tabs" role="tablist">
        <button className={"tab" + (tab === "in" ? " on" : "")} onClick={() => setTab("in")}>
          Incoming
        </button>
        <button className={"tab" + (tab === "out" ? " on" : "")} onClick={() => setTab("out")}>
          Outgoing
        </button>
      </div>

      {loading ? (
        <Loading />
      ) : tab === "in" ? (
        incoming!.length ? (
          incoming!.map((n) => <IncomingRow key={n.id} note={n} />)
        ) : (
          <div className="empty">No notes yet. When someone comments on your site, it lands here.</div>
        )
      ) : outgoing!.length ? (
        outgoing!.map((n) => <OutgoingRow key={n.id} note={n} />)
      ) : (
        <div className="empty">You haven't left any notes yet. Visit a Den site and say hello.</div>
      )}
    </>
  );
}

/** A note left on your site — the commenter links to their Den profile, and (if
 *  they're a member) a Message button opens a DM with them. */
function IncomingRow({ note }: { note: InboxNote }) {
  const a = note.author;
  const reaction = isReaction(note.body) ? note.body.trim() : "";
  const ts = relTime(note.created);
  const href = a.handle ? `/@${a.handle}` : a.url || null;
  const name = href ? (
    <a className="who" href={href} target={a.handle ? undefined : "_blank"} rel="noopener">
      {a.name || "Someone"}
    </a>
  ) : (
    <span className="who">{a.name || "Someone"}</span>
  );
  return (
    <div className="cmt">
      <Avatar of={a} />
      <div className="meta">
        <div className="cmt-line">
          {name}
          {reaction ? (
            <span className="act"> reacted with <span className="react-emoji">{reaction}</span></span>
          ) : (
            a.url && <span className="where"> · {host(a.url)}</span>
          )}
          {!reaction && note.visibility === "private" && <span className="tag">private</span>}
          {ts && <time className="cmt-time">{ts}</time>}
        </div>
        {!reaction && <div className="body">{note.body}</div>}
      </div>
      {a.id && (
        <Link className="btn sm dm-msg-btn" to={`/messages/${a.id}`}>
          Message
        </Link>
      )}
    </div>
  );
}

/** A note you left elsewhere — links to that member's Den profile. */
function OutgoingRow({ note }: { note: OutgoingNote }) {
  const s = note.site;
  const href = profileHref(s);
  const reaction = isReaction(note.body) ? note.body.trim() : "";
  const ts = relTime(note.created);
  return (
    <a className="cmt" href={href} target={s.handle ? undefined : "_blank"} rel="noopener">
      <Avatar of={s} />
      <div className="meta">
        <div className="cmt-line">
          <span className="who">{s.name}</span>
          {reaction ? (
            <span className="act"> · you reacted <span className="react-emoji">{reaction}</span></span>
          ) : (
            s.url && <span className="where"> · {host(s.url)}</span>
          )}
          {!reaction && note.visibility === "private" && <span className="tag">private</span>}
          {ts && <time className="cmt-time">{ts}</time>}
        </div>
        {!reaction && <div className="body">{note.body}</div>}
      </div>
    </a>
  );
}
