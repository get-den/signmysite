import { useEffect, useState } from "react";
import { getInbox, getOutgoing, orEmpty, type InboxNote, type OutgoingNote } from "../api";
import { Avatar, Loading } from "../ui";
import { host, isReaction, profileHref, relTime } from "../lib";

type Tab = "in" | "out";

/** Messages: triage every comment — incoming (on your site) and outgoing
 *  (notes you left elsewhere) — in one place. */
export function Messages() {
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
      <h2 className="section">Messages</h2>
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

/** A note left on your site — the commenter links to their Den profile. */
function IncomingRow({ note }: { note: InboxNote }) {
  const a = note.author;
  const reaction = isReaction(note.body) ? note.body.trim() : "";
  const ts = relTime(note.created);
  const inner = (
    <div className="meta">
      <div className="cmt-line">
        <span className="who">{a.name || "Someone"}</span>
        {reaction ? (
          <span className="act"> reacted with {reaction}</span>
        ) : (
          a.url && <span className="where"> · {host(a.url)}</span>
        )}
        {!reaction && note.visibility === "private" && <span className="tag">private</span>}
        {ts && <time className="cmt-time">{ts}</time>}
      </div>
      {!reaction && <div className="body">{note.body}</div>}
    </div>
  );
  const href = a.handle ? `/@${a.handle}` : a.url || null;
  return href ? (
    <a className="cmt" href={href} target={a.handle ? undefined : "_blank"} rel="noopener">
      <Avatar of={a} />
      {inner}
    </a>
  ) : (
    <div className="cmt">
      <Avatar of={a} />
      {inner}
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
            <span className="act"> · you reacted {reaction}</span>
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
