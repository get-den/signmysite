import { useEffect, useState } from "react";
import { getInbox, type InboxNote } from "../api";
import { Avatar, Loading } from "../ui";
import { host } from "../lib";

/** Pigeon box — every note left on your site(s), public + private. */
export function Inbox() {
  const [notes, setNotes] = useState<InboxNote[] | null>(null);

  useEffect(() => {
    let alive = true;
    getInbox()
      .then((n) => alive && setNotes(n))
      .catch(() => alive && setNotes([]));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <>
      <h2 className="section">Pigeon box</h2>
      <p className="muted-p">Notes people left on your site. Private notes are only visible to you.</p>
      {notes === null ? (
        <Loading />
      ) : notes.length ? (
        notes.map((n) => <NoteRow key={n.id} note={n} />)
      ) : (
        <div className="empty">No notes yet. When someone leaves a note on your site, it lands here.</div>
      )}
    </>
  );
}

function NoteRow({ note }: { note: InboxNote }) {
  const a = note.author;
  return (
    <div className="blog note">
      <Avatar of={a} />
      <div className="meta">
        <div className="bn">
          {a.name || "Someone"}
          {a.url && (
            <a className="bh" href={a.url} target="_blank" rel="noopener">
              {" "}
              ({host(a.url)})
            </a>
          )}
          {note.visibility === "private" && <span className="tag">private</span>}
        </div>
        <div>{note.body}</div>
      </div>
    </div>
  );
}
