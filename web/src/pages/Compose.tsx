import { useEffect, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, getProfile, postComment, type Member } from "../api";
import { useViewer } from "../providers";
import { Avatar, Button, IconButton } from "../ui";

/**
 * The postcard. A visitor types a note in someone's widget and is sent here to
 * finish and send it — full screen, like writing a postcard. They choose public
 * or private at the bottom, and sign in on the way out (the draft is preserved
 * across the sign-in round-trip via the URL).
 */
export function Compose() {
  const { viewer } = useViewer();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const to = params.get("to") || "";
  const siteName = params.get("site") || "this site";

  const [body, setBody] = useState(params.get("body") || "");
  const [visibility, setVisibility] = useState<"public" | "private">(
    params.get("v") === "private" ? "private" : "public",
  );
  const [target, setTarget] = useState<Member | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (to) getProfile(to).then(setTarget).catch(() => {});
  }, [to]);

  if (!to) return <Navigate to="/" replace />;

  const recipient = target?.name || siteName;

  async function send() {
    const text = body.trim();
    if (!text || sending) return;

    // Not signed in yet: sign in on den.com, returning to this very postcard with
    // the draft + chosen visibility preserved so nothing is lost.
    if (!viewer) {
      const ret = `${location.origin}/#/compose?${new URLSearchParams({ to, site: siteName, body: text, v: visibility })}`;
      location.href = `/api/auth/google?return=${encodeURIComponent(ret)}`;
      return;
    }

    setSending(true);
    setError("");
    try {
      await postComment(to, text, visibility);
      navigate(`/reacted?${new URLSearchParams({ kind: "note", to, site: recipient, v: visibility })}`, { replace: true });
    } catch (e) {
      setError(e instanceof ApiError && e.status === 401 ? "Please sign in to send." : "Couldn't send — try again.");
      setSending(false);
    }
  }

  return (
    <div className="sheet">
      <div className="sheet-bar">
        <IconButton icon="close" to="/" />
        <span className="sheet-kicker">Writing to</span>
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
          className="postcard-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={`Say hello to ${recipient}…`}
          autoFocus
          maxLength={1000}
        />
        <div className="postcard-foot">
          <div className="seg" role="radiogroup" aria-label="Who can see this note">
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
            {viewer ? "Send" : "Sign in & send"}
          </Button>
        </div>
        <p className="postcard-hint">
          {error ? (
            <span className="formerr">{error}</span>
          ) : visibility === "private" ? (
            "Only they will see this — a note just for them."
          ) : (
            "Public notes appear on their profile for everyone to see."
          )}
        </p>
      </div>
    </div>
  );
}
