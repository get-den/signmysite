import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { follow, getProfile, getStats, postComment, type Member, type Stats } from "../api";
import { useToast, useViewer } from "../providers";
import { Avatar, IconButton, Loading } from "../ui";

/**
 * Landing after a widget hand-off.
 *
 *  • kind=note  — the postcard was already posted by /compose; this just confirms.
 *  • kind=react — the reaction has NOT been posted yet. We post it here, as the
 *    signed-in viewer, so it's always attributed (never "Someone"). If they have
 *    a den.com session it lands immediately; if not, they sign in first and it
 *    posts the moment they return.
 *
 * Either way it ends on the same confirmation, with a Follow nudge.
 */
export function Reacted() {
  const { viewer, loading } = useViewer();
  const [params] = useSearchParams();

  const kind = params.get("kind") === "note" ? "note" : "react";
  const to = params.get("to") || "";
  const siteName = params.get("site") || "this site";
  const emoji = params.get("emoji") || "🎉";

  const [target, setTarget] = useState<Member | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  // Notes arrive already-sent; reactions become "sent" once we post them below.
  const [sent, setSent] = useState(kind === "note");
  const posting = useRef(false);

  useEffect(() => {
    if (to) getProfile(to).then(setTarget).catch(() => {});
  }, [to]);

  useEffect(() => {
    if (to && viewer) getStats(to).then(setStats).catch(() => {});
  }, [to, viewer]);

  // Post the reaction as the viewer, once we know who they are. Guarded so it
  // fires exactly once.
  useEffect(() => {
    if (kind !== "react" || sent || !to || !viewer || posting.current) return;
    posting.current = true;
    postComment(to, emoji, "public")
      .then(() => setSent(true))
      .catch(() => { posting.current = false; });
  }, [kind, sent, to, viewer, emoji]);

  if (!to) return <Navigate to="/" replace />;

  const name = target?.name || siteName;
  const isNote = kind === "note";

  return (
    <div className="sheet">
      <div className="sheet-bar">
        <IconButton icon="close" to="/" />
      </div>

      <div className="confirm">
        <div className={"confirm-mark" + (isNote ? " mail" : "")} aria-hidden="true">
          {isNote ? "✉️" : emoji}
        </div>

        {loading ? (
          <Loading />
        ) : viewer ? (
          <Confirmed
            isNote={isNote}
            sent={sent}
            emoji={emoji}
            name={name}
            to={to}
            target={target}
            stats={stats}
            setStats={setStats}
          />
        ) : (
          <SignInToSend isNote={isNote} emoji={emoji} name={name} />
        )}
      </div>
    </div>
  );
}

/** Signed in: the reaction/note is (being) posted as them — confirm + Follow. */
function Confirmed({
  isNote, sent, emoji, name, to, target, stats, setStats,
}: {
  isNote: boolean; sent: boolean; emoji: string; name: string;
  to: string; target: Member | null; stats: Stats | null; setStats: (s: Stats) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  // After clicking Follow, hold off the red "Unfollow"-on-hover until the cursor
  // leaves — so the button doesn't snap to red while still under the click.
  const [justFollowed, setJustFollowed] = useState(false);

  const onFollow = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await follow(to);
      setStats(next);
      setJustFollowed(next.viewerFollows);
      toast(next.viewerFollows ? "Following" : "Unfollowed");
    } catch {
      toast("Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1 className="confirm-title">
        {isNote ? "Postcard sent" : sent ? "Reaction sent" : "Sending…"}
      </h1>
      <p className="confirm-sub">
        <b>{name}</b> got your {isNote ? "note" : emoji}
      </p>

      <div className="confirm-follow">
        {target?.handle || target?.url ? (
          <a className="confirm-who" href={target.handle ? `/@${target.handle}` : target.url!}>
            <Avatar of={target} />
            <span className="who">{name}</span>
          </a>
        ) : (
          <div className="confirm-who">
            <Avatar of={target || { name }} />
            <span className="who">{name}</span>
          </div>
        )}
        <button
          className={"btn" + (stats?.viewerFollows ? " following" : " primary") + (justFollowed ? " just" : "")}
          type="button"
          disabled={busy}
          onClick={onFollow}
          onMouseLeave={() => setJustFollowed(false)}
        >
          {stats?.viewerFollows ? <span className="lbl">Following</span> : "Follow"}
        </button>
      </div>
    </>
  );
}

/** Not signed in: the reaction is held until they sign in — then it posts as them. */
function SignInToSend({ isNote, emoji, name }: { isNote: boolean; emoji: string; name: string }) {
  const ret = `${location.origin}/#${location.hash.slice(1) || "/reacted"}`;
  const signin = `/api/auth/google?return=${encodeURIComponent(ret)}`;
  return (
    <>
      <h1 className="confirm-title">{isNote ? "Almost there" : "One more step"}</h1>
      <p className="confirm-sub">
        Sign in to add your {isNote ? "note" : emoji} to <b>{name}</b>. It posts as you, never anonymously.
      </p>
      <div className="confirm-cta">
        <a className="btn pink lg" href={signin}>Sign in & send</a>
        <Link className="confirm-skip" to="/">Maybe later</Link>
      </div>
    </>
  );
}
