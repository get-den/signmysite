import { useEffect, useState } from "react";
import { getInbox, getOutgoing, orEmpty, type InboxNote, type OutgoingNote } from "../api";
import { Avatar, Loading } from "../ui";
import { host } from "../lib";

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

/** A note left on your site — links back to the commenter's blog. */
function IncomingRow({ note }: { note: InboxNote }) {
  const a = note.author;
  const inner = (
    <div className="meta">
      <div>
        <span className="who">{a.name || "Someone"}</span>
        {a.url && <span className="where"> · {host(a.url)}</span>}
        {note.visibility === "private" && <span className="tag">private</span>}
      </div>
      <div className="body">{note.body}</div>
    </div>
  );
  return a.url ? (
    <a className="cmt" href={a.url} target="_blank" rel="noopener">
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

/** A note you left elsewhere — links to the site you left it on. */
function OutgoingRow({ note }: { note: OutgoingNote }) {
  const s = note.site;
  const href = s.url || (s.handle ? `/@${s.handle}` : "#");
  return (
    <a className="cmt" href={href} target={s.url ? "_blank" : undefined} rel="noopener">
      <Avatar of={s} />
      <div className="meta">
        <div>
          <span className="who">{s.name}</span>
          {s.url && <span className="where"> · {host(s.url)}</span>}
          {note.visibility === "private" && <span className="tag">private</span>}
        </div>
        <div className="body">{note.body}</div>
      </div>
    </a>
  );
}
