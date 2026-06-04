import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getComment, type NoteDetail } from "../api";
import { isReaction, profileHref, relTime } from "../lib";
import { Avatar, IconButton, Loading } from "../ui";

/**
 * A single comment, in context — opened from the widget when you hover/click a
 * note. Shows who left it, on which site, and links both back to their profiles.
 * `undefined` = loading, `null` = not found.
 */
export function Note() {
  const { id = "" } = useParams();
  const [note, setNote] = useState<NoteDetail | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    getComment(id).then((n) => alive && setNote(n)).catch(() => alive && setNote(null));
    return () => { alive = false; };
  }, [id]);

  return (
    <div className="sheet">
      <div className="sheet-bar">
        <IconButton icon="close" to="/" />
      </div>

      <div className="note-view">
        {note === undefined ? (
          <Loading />
        ) : note === null ? (
          <p className="note-view-msg">This note couldn't be found.</p>
        ) : note.redacted ? (
          <p className="note-view-msg">🔒 This note is private.</p>
        ) : (
          <NoteCard note={note} />
        )}
      </div>
    </div>
  );
}

function NoteCard({ note }: { note: NoteDetail }) {
  const a = note.author;
  const named = a && (a.name || a.handle) ? a : null;
  const authorName = named ? named.name || `@${named.handle}` : "Someone";
  const reaction = isReaction(note.body);

  return (
    <article className="note-card">
      <header className="note-card-head">
        {named ? (
          <a className="note-card-who" href={profileHref(named)}>
            <Avatar of={named} />
            <span className="who">{authorName}</span>
          </a>
        ) : (
          <div className="note-card-who">
            <Avatar of={{ name: "?" }} />
            <span className="who">{authorName}</span>
          </div>
        )}
        <time className="note-card-when">{relTime(note.created)}</time>
      </header>

      {reaction ? (
        <div className="note-card-reaction">{note.body}</div>
      ) : (
        <p className="note-card-body">{note.body}</p>
      )}

      <footer className="note-card-foot">
        {note.visibility === "private" && <span className="tag">private</span>}
        <span className="note-card-on">
          on <a href={profileHref(note.site)}>{note.site.name}</a>
        </span>
      </footer>
    </article>
  );
}
