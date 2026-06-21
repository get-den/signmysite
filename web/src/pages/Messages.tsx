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
import { useToast, useViewer } from "../providers";
import { Avatar, EmptyState, IdentityLink, Loading, PageHead, Spinner } from "../ui";
import { relTime, REACTIONS } from "../lib";
import { FeedLayout } from "../home/FeedLayout";

/**
 * Direct messages — a clean 1:1 chat. Two panes: the inbox of conversations on the
 * left, the open thread in the middle. A thread is addressed by the other member's
 * id, so /messages/:id deep-links straight into a chat (from a profile, or a note
 * someone left you). Every row reuses the comment row (.cmt); the chat-only bits —
 * edit, delete, emoji reactions — layer on top.
 */
export function Messages() {
  const { id: peerId } = useParams();
  const { viewer } = useViewer();
  const [convos, setConvos] = useState<Conversation[] | null>(null);

  const loadConvos = useCallback(() => {
    getThreads().then(setConvos, () => setConvos([]));
  }, []);
  usePoll(loadConvos, 8000);

  if (!viewer) return null; // Protected route guarantees a viewer; this narrows the type

  return (
    <FeedLayout viewer={viewer}>
    <div className="messages-page">
      <PageHead title="Messages" />
      <div className="dm">
      <aside className="dm-list">
        {convos === null ? (
          <Loading />
        ) : convos.length === 0 ? (
          <EmptyState>No messages yet.</EmptyState>
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
          <EmptyState>Select a conversation.</EmptyState>
        )}
      </section>
      </div>
    </div>
    </FeedLayout>
  );
}

/** Run `fn` once on mount, again whenever the tab regains focus, and on an interval
 *  while it's visible — the liveness behind the inbox and an open thread, no sockets. */
function usePoll(fn: () => void, ms: number) {
  useEffect(() => {
    fn();
    const tick = () => document.visibilityState === "visible" && fn();
    const timer = setInterval(tick, ms);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [fn, ms]);
}

/** One inbox row: avatar, name, a one-line preview of the last message, and time —
 *  the comment row (.cmt) with an unread count. */
function ConversationRow({ convo, active }: { convo: Conversation; active: boolean }) {
  const { peer, lastBody, lastAt, lastFromMe, lastDeleted, unread } = convo;
  const preview = lastDeleted ? "Message deleted" : (lastFromMe ? "You: " : "") + (lastBody || "");
  return (
    <Link className={"cmt dm-convo" + (active ? " on" : "") + (unread ? " unread" : "")} to={`/messages/${peer.id}`}>
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

/** The middle pane: the live thread with one peer, plus the composer. Keyed by peer
 *  id in the parent, so switching conversations remounts it with fresh state. */
function Chat({ peerId, onActivity }: { peerId: string; onActivity: () => void }) {
  const { viewer } = useViewer();
  const navigate = useNavigate();
  const [thread, setThread] = useState<Thread | null>(null);
  const [missing, setMissing] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadThread = useCallback(
    () =>
      getThread(peerId).then(setThread, (e) => {
        if (e instanceof ApiError && e.status === 404) setMissing(true);
      }),
    [peerId],
  );
  usePoll(loadThread, 5000);

  // Swap one message in place after an edit / delete / react, without a refetch.
  const patchMessage = useCallback((m: ChatMessage) => {
    setThread((t) => t && { ...t, messages: t.messages.map((x) => (x.id === m.id ? m : x)) });
  }, []);

  // Keep the newest message in view as the thread grows.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [thread?.messages.length]);

  if (missing) {
    return (
      <div className="dm-blank">
        <p>They're not on signmysite.</p>
        <button className="btn sm" onClick={() => navigate("/messages")}>Back to messages</button>
      </div>
    );
  }
  if (!thread || !viewer) return <Loading />;
  const me = viewer;
  const { peer, messages } = thread;

  // Send, then reload from the server — the one source of truth for the thread, so
  // there's no optimistic copy to reconcile (and nothing for the poll to race).
  const send = async (text: string) => {
    await sendMessage(peer.id, text);
    await loadThread();
    onActivity();
  };

  return (
    <div className="dm-chat">
      <header className="dm-head">
        <Avatar of={peer} />
        <div className="dm-head-id">
          <IdentityLink of={peer} className="who">
            {peer.name || "Someone"}
          </IdentityLink>
          {peer.handle && <span className="dm-head-sub">@{peer.handle}</span>}
        </div>
      </header>

      <div className="dm-scroll">
        {messages.length === 0 ? (
          <div className="empty dm-empty">Say hello to {peer.name || "them"}.</div>
        ) : (
          messages.map((m) => (
            <MessageRow
              key={m.id}
              message={m}
              me={me.id}
              author={m.from === me.id ? me : peer}
              onChange={patchMessage}
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <Composer onSend={send} peerName={peer.name || "them"} />
    </div>
  );
}

/** One message — the comment row (.cmt) plus chat affordances: reactions beneath, and
 *  on hover an emoji tray + (for your own messages) edit / delete. */
function MessageRow({
  message,
  me,
  author,
  onChange,
}: {
  message: ChatMessage;
  me: string;
  author: { name: string; handle: string | null; avatar: string | null };
  onChange: (m: ChatMessage) => void;
}) {
  const mine = message.from === me;
  const [editing, setEditing] = useState(false);
  const [trayOpen, setTrayOpen] = useState(false);

  const react = async (emoji: string) => {
    setTrayOpen(false);
    onChange({ ...message, reactions: await reactToMessage(message.id, emoji) });
  };
  const saveEdit = async (text: string) => {
    if (text && text !== message.body) onChange(await editMessage(message.id, text));
    setEditing(false);
  };
  const remove = async () => {
    if (confirm("Delete this message?")) onChange(await deleteMessage(message.id));
  };

  const reactions = groupReactions(message.reactions, me);
  const myEmoji = new Set(reactions.filter((r) => r.mine).map((r) => r.emoji));

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
          <EditBox initial={message.body ?? ""} onSave={saveEdit} onCancel={() => setEditing(false)} />
        ) : (
          <div className="body dm-text">{message.body}</div>
        )}

        {reactions.length > 0 && (
          <div className="dm-reacts">
            {reactions.map((r) => (
              <button
                key={r.emoji}
                className={"dm-chip" + (r.mine ? " on" : "")}
                onClick={() => react(r.emoji)}
                title="Toggle reaction"
              >
                <span className="react-emoji">{r.emoji}</span>
                {r.count > 1 && <span className="dm-chip-n">{r.count}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {!message.deleted && !editing && (
        <div className={"dm-actions" + (trayOpen ? " open" : "")}>
          <div className="dm-react-wrap">
            <button className="dm-act" aria-label="React" onClick={() => setTrayOpen((v) => !v)}>☺</button>
            {trayOpen && <EmojiTray mine={myEmoji} onPick={react} onClose={() => setTrayOpen(false)} />}
          </div>
          {mine && (
            <>
              <button className="dm-act" onClick={() => setEditing(true)}>Edit</button>
              <button className="dm-act" onClick={remove}>Delete</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Inline editor for a message: Enter saves, Shift+Enter newlines, Escape cancels. */
function EditBox({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  return (
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
            onSave(draft.trim());
          }
          if (e.key === "Escape") onCancel();
        }}
      />
      <div className="dm-edit-actions">
        <button className="btn sm primary" onClick={() => onSave(draft.trim())}>Save</button>
        <button className="btn sm naked" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/** The emoji picker popover — the canonical reaction set, closing on outside click. */
function EmojiTray({
  mine,
  onPick,
  onClose,
}: {
  mine: Set<string>;
  onPick: (emoji: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose();
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onClose]);
  return (
    <div className="dm-tray" ref={ref}>
      {REACTIONS.map((e) => (
        <button key={e} className={"dm-tray-emoji" + (mine.has(e) ? " on" : "")} onClick={() => onPick(e)}>
          {e}
        </button>
      ))}
    </div>
  );
}

/** The bottom composer: Enter sends, Shift+Enter newlines. Keeps the draft if a send
 *  fails so nothing is lost. */
function Composer({ onSend, peerName }: { onSend: (text: string) => Promise<void>; peerName: string }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const toast = useToast();

  async function send() {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    try {
      await onSend(t);
      setText("");
    } catch {
      toast("Couldn't send. Try again.");
    } finally {
      setSending(false);
    }
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
      <button
        className={"dm-send" + (text.trim() ? " ready" : "")}
        aria-label="Send"
        disabled={!text.trim() || sending}
        onClick={send}
      >
        {sending ? <Spinner /> : <SendIcon />}
      </button>
    </div>
  );
}

/** Up-arrow send glyph — mirrors the widget's composer button. */
function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </svg>
  );
}

/** Fold a flat (emoji, by) list into chips: one per emoji, in first-seen order, with a
 *  count and whether the viewer is among the reactors. */
function groupReactions(
  reactions: ChatReaction[],
  me: string,
): Array<{ emoji: string; count: number; mine: boolean }> {
  const chips = new Map<string, { emoji: string; count: number; mine: boolean }>();
  for (const { emoji, by } of reactions) {
    const chip = chips.get(emoji) ?? { emoji, count: 0, mine: false };
    chip.count++;
    chip.mine ||= by === me;
    chips.set(emoji, chip);
  }
  return [...chips.values()];
}
