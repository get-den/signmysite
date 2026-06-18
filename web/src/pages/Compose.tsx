import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, getProfile, postComment, type Member } from "../api";
import { useViewer } from "../providers";
import { savePending, clearPending } from "../pending";
import { Avatar, Button, IconButton } from "../ui";

/**
 * The postcard. A visitor types a note in someone's widget and is sent here to
 * finish and send it — full screen, like writing a postcard. They choose public
 * or private at the bottom. If they're not signed in, Send routes through the
 * sign-in page with the draft preserved in the URL (+ send=1) — so the moment
 * they're back, signed in, the note posts itself with nothing lost.
 */
export function Compose() {
  const { viewer, loading } = useViewer();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const to = params.get("to") || "";
  const siteName = params.get("site") || "this site";
  // The exact page they came from (passed by the widget), carried to the confirmation.
  const from = params.get("from") || "";

  const [body, setBody] = useState(params.get("body") || "");
  const [visibility, setVisibility] = useState<"public" | "private">(
    params.get("v") === "private" ? "private" : "public",
  );
  const [target, setTarget] = useState<Member | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Set when we come back from signing in (see send()): the draft should post
  // itself rather than wait for a second click. Guarded so it fires exactly once.
  const autosend = params.get("send") === "1";
  const delivered = useRef(false);

  useEffect(() => {
    if (to) getProfile(to).then(setTarget).catch(() => {});
  }, [to]);

  // Focus the draft with the caret AT THE END (autoFocus alone lands it at the
  // start of the prefilled text), so the visitor can keep typing where they left
  // off in the widget. Runs once on mount.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, []);

  // Keep a durable copy of the draft as they type, so a sign-in round trip that
  // doesn't land back here (a reaped mobile tab, a magic link opened elsewhere)
  // is still recoverable — the Home backstop resumes it. Cleared once it sends.
  useEffect(() => {
    if (!to) return;
    const text = body.trim();
    if (text) savePending({ kind: "note", to, site: siteName, from, body: text, visibility });
    else clearPending();
  }, [to, siteName, from, body, visibility]);

  // Back from sign-in with the draft in the URL: post it automatically, once the
  // viewer is known. deliver() is hoisted, so referencing it here is fine.
  useEffect(() => {
    if (autosend && !loading && viewer) deliver((params.get("body") || "").trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autosend, loading, viewer]);

  if (!to) return <Navigate to="/" replace />;

  const recipient = target?.name || siteName;

  // Post the note as the signed-in viewer, then land on the confirmation. Guarded
  // so it runs once whether triggered by a click or the post-sign-in autosend.
  async function deliver(text: string) {
    if (!text || delivered.current) return;
    delivered.current = true;
    setSending(true);
    setError("");
    try {
      await postComment(to, text, visibility);
      clearPending();
      const done = new URLSearchParams({ kind: "note", to, site: recipient, v: visibility });
      if (from) done.set("from", from);
      navigate(`/reacted?${done}`, { replace: true });
    } catch (e) {
      delivered.current = false;
      setError(e instanceof ApiError && e.status === 401 ? "Please sign in to send." : "Couldn't send. Try again.");
      setSending(false);
    }
  }

  function send() {
    const text = body.trim();
    if (!text || sending) return;
    // Not signed in yet: head to the sign-in page (Google or an email magic link,
    // which also creates an account), returning to this very postcard with the
    // draft + visibility preserved and send=1 — so it posts itself on the way back.
    if (!viewer) {
      const draft = new URLSearchParams({ to, site: siteName, body: text, v: visibility, send: "1" });
      if (from) draft.set("from", from);
      const ret = `/compose?${draft}`;
      navigate(`/auth?return=${encodeURIComponent(ret)}`);
      return;
    }
    deliver(text);
  }

  return (
    <div className="sheet">
      <div className="sheet-bar">
        <IconButton icon="close" to="/" />
      </div>

      <div className="postcard-stack">
        <div className="postcard-to">
          <span className="postcard-to-label">Writing to</span>
          {target?.handle || target?.url ? (
            // Open in a new tab so peeking at their profile never loses the draft.
            <a
              className="sheet-to"
              href={target.handle ? `/@${target.handle}` : target.url!}
              target="_blank"
              rel="noopener"
            >
              <Avatar of={target} /> <span className="who">{recipient}</span>
            </a>
          ) : (
            <span className="sheet-to">
              <Avatar of={target || { name: recipient }} /> <span className="who">{recipient}</span>
            </span>
          )}
        </div>

        <div className="postcard">
          <textarea
            ref={inputRef}
            className="postcard-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={`Say hello to ${recipient}…`}
            maxLength={1000}
          />
          <div className="postcard-foot">
            <div className="seg" role="radiogroup" aria-label="Who can see this comment">
              <button
                type="button"
                className={"seg-opt" + (visibility === "public" ? " on" : "")}
                aria-pressed={visibility === "public"}
                onClick={() => setVisibility("public")}
              >
                Public
              </button>
              <button
                type="button"
                className={"seg-opt" + (visibility === "private" ? " on" : "")}
                aria-pressed={visibility === "private"}
                onClick={() => setVisibility("private")}
              >
                Private
              </button>
            </div>
            <Button className="pink send-btn" loading={sending} disabled={!body.trim()} onClick={send}>
              {viewer || loading ? "Send" : "Sign in to continue"}
            </Button>
          </div>
          <p className="postcard-hint">
            {error ? (
              <span className="formerr">{error}</span>
            ) : visibility === "private" ? (
              "Only they will see this. A comment just for them."
            ) : (
              "Public comments appear on their profile for everyone to see."
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
