import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ApiError,
  deleteMessage,
  editMessage,
  getThread,
  getThreads,
  reactToMessage,
  sendMessage,
  type ChatMessage,
  type ChatReaction,
  type Conversation,
  type Thread,
} from "../api";
import { useViewer } from "../providers";
import { Avatar, Loading } from "../ui";
import { profileHref, relTime, REACTIONS } from "../lib";

/**
 * Direct messages — a basic, clean 1:1 chat. Two panes: the inbox of conversations
 * on the left, the open thread in the middle. A thread is addressed by the other
 * member's id (so /messages/:id deep-links straight into a chat, e.g. from a profile
 * or a note someone left you). Every message reuses the app's comment row (.cmt);
 * the chat-only bits — your-vs-theirs alignment, edit/delete, emoji reactions — layer
 * on top. Light polling keeps an open thread + the inbox feeling live without sockets.
 */
export function Messages() {
  const { id: peerId } = useParams();
  const [convos, setConvos] = useState<Conversation[] | null>(null);

  const loadConvos = useCallback(() => {
    getThreads()
      .then(setConvos)
      .catch(() => setConvos([]));
  }, []);

  useEffect(() => {
    loadConvos();
  }, [loadConvos]);

  // Refresh the inbox when the tab regains focus (you may have read elsewhere) and
  // on a gentle interval, so a new conversation/preview/unread count shows up.
  useEffect(() => {
    const tick = () => document.visibilityState === "visible" && loadConvos();
    const timer = setInterval(tick, 8000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [loadConvos]);

  return (
    <div className="dm">
      <aside className="dm-list">
        <h2 className="section dm-list-title">Messages</h2>
        {convos === null ? (
          <Loading />
        ) : convos.length === 0 ? (
          <div className="empty">
            No messages yet. Open someone's profile and hit Message, or reply from a note
            they left you.
          </div>
        ) : (
          <div className="dm-convos">
            {convos.map((c) => (
              <ConversationRow key={c.peer.id} convo={c} active={c.peer.id === peerId} />
            ))}
          </div>
        )}
      </aside>

      <section className="dm-main">
        {peerId ? (
          <Chat key={peerId} peerId={peerId} onActivity={loadConvos} />
        ) : (
          <div className="dm-blank">
            <p>Select a conversation, or start one from someone's profile.</p>
          </div>
        )}
      </section>
    </div>
  );
}

/** One inbox row: avatar, name, a one-line preview of the last message, and time —
 *  the comment row (.cmt) with an unread dot. */
function ConversationRow({ convo, active }: { convo: Conversation; active: boolean }) {
  const { peer, lastBody, lastAt, lastFromMe, lastDeleted, unread } = convo;
  const preview = lastDeleted
    ? "Message deleted"
    : (lastFromMe ? "You: " : "") + (lastBody || "");
  return (
    <Link
      className={"cmt dm-convo" + (active ? " on" : "") + (unread ? " unread" : "")}
      to={`/messages/${peer.id}`}
    >
      <Avatar of={peer} />
      <div className="meta">
        <div className="cmt-line">
          <span className="who">{peer.name || "Someone"}</span>
          {lastAt && <time className="cmt-time">{relTime(lastAt)}</time>}
        </div>
        <div className="body dm-preview">{preview}</div>
      </div>
      {unread > 0 && <span className="dm-unread">{unread}</span>}
    </Link>
  );
}

/** The middle pane: the live thread with one peer, plus the composer. */
function Chat({ peerId, onActivity }: { peerId: string; onActivity: () => void }) {
  const { viewer } = useViewer();
  const navigate = useNavigate();
  const [thread, setThread] = useState<Thread | null>(null);
  const [missing, setMissing] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load (and poll) the thread. Polling replaces the message list wholesale; the
  // composer draft + any in-progress edit live in their own state, so a refresh
  // never clobbers what you're typing.
  const loadThread = useCallback(() => {
    getThread(peerId)
      .then((t) => {
        setThread(t);
        setMissing(false);
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 404) setMissing(true);
      });
  }, [peerId]);

  useEffect(() => {
    setThread(null);
    loadThread();
  }, [loadThread]);

  useEffect(() => {
    const tick = () => document.visibilityState === "visible" && loadThread();
    const timer = setInterval(tick, 5000);
    return () => clearInterval(timer);
  }, [loadThread]);

  // Replace one message in place (after edit / delete / react) without a refetch.
  const patchMessage = useCallback((m: ChatMessage) => {
    setThread((t) => (t ? { ...t, messages: t.messages.map((x) => (x.id === m.id ? m : x)) } : t));
  }, []);

  // Keep the newest message in view as the thread grows or you send.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [thread?.messages.length, peerId]);

  if (missing) {
    return (
      <div className="dm-blank">
        <p>That person isn't on Den.</p>
        <button className="btn sm" onClick={() => navigate("/messages")}>
          Back to messages
        </button>
      </div>
    );
  }
  if (!thread || !viewer) return <Loading />;

  const peer = thread.peer;

  async function onSend(text: string) {
    // Optimistic: drop the message in immediately, reconcile with the server row.
    const temp: ChatMessage = {
      id: "tmp_" + Math.random().toString(36).slice(2),
      from: viewer!.id,
      to: peer.id,
      body: text,
      created: new Date().toISOString(),
      edited: null,
      deleted: false,
      reactions: [],
    };
    setThread((t) => (t ? { ...t, messages: [...t.messages, temp] } : t));
    try {
      const saved = await sendMessage(peer.id, text);
      setThread((t) =>
        t ? { ...t, messages: t.messages.map((m) => (m.id === temp.id ? saved : m)) } : t,
      );
      onActivity();
    } catch {
      // Roll the optimistic bubble back out on failure.
      setThread((t) => (t ? { ...t, messages: t.messages.filter((m) => m.id !== temp.id) } : t));
    }
  }

  return (
    <div className="dm-chat">
      <header className="dm-head">
        <Avatar of={peer} />
        <div className="dm-head-id">
          <a className="who" href={profileHref(peer)} target={peer.handle ? undefined : "_blank"} rel="noopener">
            {peer.name || "Someone"}
          </a>
          {peer.handle && <span className="dm-head-sub">@{peer.handle}</span>}
        </div>
      </header>

      <div className="dm-scroll">
        {thread.messages.length === 0 ? (
          <div className="empty dm-empty">Say hello to {peer.name || "them"}.</div>
        ) : (
          thread.messages.map((m) => (
            <MessageRow
              key={m.id}
              message={m}
              mine={m.from === viewer.id}
              author={m.from === viewer.id ? viewer : peer}
              viewerId={viewer.id}
              onChange={patchMessage}
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <Composer onSend={onSend} peerName={peer.name || "them"} />
    </div>
  );
}

/** One message — the comment row (.cmt) plus chat affordances: reactions beneath,
 *  and on hover an emoji tray + (for your own messages) edit / delete. */
function MessageRow({
  message,
  mine,
  author,
  viewerId,
  onChange,
}: {
  message: ChatMessage;
  mine: boolean;
  author: { name: string; handle: string | null; avatar: string | null };
  viewerId: string;
  onChange: (m: ChatMessage) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.body || "");
  const [trayOpen, setTrayOpen] = useState(false);
  const pending = message.id.startsWith("tmp_");

  async function saveEdit() {
    const text = draft.trim();
    if (!text || text === message.body) return setEditing(false);
    try {
      onChange(await editMessage(message.id, text));
    } finally {
      setEditing(false);
    }
  }

  async function onDelete() {
    if (!confirm("Delete this message?")) return;
    onChange(await deleteMessage(message.id));
  }

  async function onReact(emoji: string) {
    setTrayOpen(false);
    const reactions = await reactToMessage(message.id, emoji);
    onChange({ ...message, reactions });
  }

  const grouped = groupReactions(message.reactions, viewerId);

  return (
    <div className={"cmt dm-msg" + (mine ? " mine" : "")}>
      <Avatar of={author} />
      <div className="meta">
        <div className="cmt-line">
          <span className="who">{mine ? "You" : author.name || "Someone"}</span>
          {!message.deleted && <time className="cmt-time">{relTime(message.created)}</time>}
          {message.edited && !message.deleted && <span className="dm-edited">edited</span>}
        </div>

        {message.deleted ? (
          <div className="body dm-deleted">Message deleted</div>
        ) : editing ? (
          <div className="dm-edit">
            <textarea
              className="dm-edit-input"
              value={draft}
              autoFocus
              rows={2}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  saveEdit();
                }
                if (e.key === "Escape") setEditing(false);
              }}
            />
            <div className="dm-edit-actions">
              <button className="btn sm primary" onClick={saveEdit}>Save</button>
              <button className="btn sm naked" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className="body dm-text">{message.body}</div>
        )}

        {grouped.length > 0 && (
          <div className="dm-reacts">
            {grouped.map((g) => (
              <button
                key={g.emoji}
                className={"dm-chip" + (g.mine ? " on" : "")}
                onClick={() => onReact(g.emoji)}
                title="Toggle reaction"
              >
                <span className="react-emoji">{g.emoji}</span>
                {g.count > 1 && <span className="dm-chip-n">{g.count}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {!message.deleted && !editing && !pending && (
        <div className="dm-actions">
          <div className="dm-react-wrap">
            <button className="dm-act" aria-label="React" onClick={() => setTrayOpen((v) => !v)}>
              ☺
            </button>
            {trayOpen && (
              <EmojiTray
                onPick={onReact}
                onClose={() => setTrayOpen(false)}
                mine={new Set(message.reactions.filter((r) => r.by === viewerId).map((r) => r.emoji))}
              />
            )}
          </div>
          {mine && (
            <>
              <button className="dm-act" aria-label="Edit" onClick={() => { setDraft(message.body || ""); setEditing(true); }}>
                Edit
              </button>
              <button className="dm-act" aria-label="Delete" onClick={onDelete}>
                Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** The emoji picker popover — the canonical reaction set, closing on outside click. */
function EmojiTray({
  onPick,
  onClose,
  mine,
}: {
  onPick: (emoji: string) => void;
  onClose: () => void;
  mine: Set<string>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onClose]);
  return (
    <div className="dm-tray" ref={ref}>
      {REACTIONS.map((e) => (
        <button
          key={e}
          className={"dm-tray-emoji" + (mine.has(e) ? " on" : "")}
          onClick={() => onPick(e)}
        >
          {e}
        </button>
      ))}
    </div>
  );
}

/** The bottom composer: a growing textarea; Enter sends, Shift+Enter newlines. */
function Composer({ onSend, peerName }: { onSend: (text: string) => void; peerName: string }) {
  const [text, setText] = useState("");
  function send() {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
  }
  return (
    <div className="dm-compose">
      <textarea
        className="dm-compose-input"
        value={text}
        placeholder={`Message ${peerName}…`}
        rows={1}
        maxLength={4000}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
      />
      <button className="btn primary dm-send" disabled={!text.trim()} onClick={send}>
        Send
      </button>
    </div>
  );
}

/** Fold a flat (emoji, by) list into chips: one per emoji with a count + whether the
 *  viewer is among the reactors. */
function groupReactions(
  reactions: ChatReaction[],
  viewerId: string,
): Array<{ emoji: string; count: number; mine: boolean }> {
  const order: string[] = [];
  const map = new Map<string, { count: number; mine: boolean }>();
  for (const r of reactions) {
    if (!map.has(r.emoji)) {
      map.set(r.emoji, { count: 0, mine: false });
      order.push(r.emoji);
    }
    const g = map.get(r.emoji)!;
    g.count++;
    if (r.by === viewerId) g.mine = true;
  }
  return order.map((emoji) => ({ emoji, ...map.get(emoji)! }));
}
