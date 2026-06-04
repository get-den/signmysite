import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { follow, getProfile, getStats, postComment, type Member, type Stats } from "../api";
import { useToast, useViewer } from "../providers";
import { savePending, clearPending } from "../pending";
import { SignIn } from "../components/SignIn";
import { AddToSite } from "../components/AddToSite";
import { Avatar, IconButton, Loading } from "../ui";

/**
 * Landing after a widget hand-off.
 *
 *  • kind=note  — the postcard was already posted by /compose; this just confirms.
 *  • kind=react — the reaction has NOT been posted yet. We post it here, as the
 *    signed-in viewer, so it's always attributed (never "Someone"). If they have
 *    a signmysite.com session it lands immediately; if not, they sign in first (Google
 *    or an email link) and it posts the moment they return.
 *
 * Either way it ends on the same confirmation: a way back to the site they came
 * from, an "Add to my site" nudge if they don't have one yet, and Follow.
 */
export function Reacted() {
  const { viewer, loading } = useViewer();
  const [params] = useSearchParams();

  const kind = params.get("kind") === "note" ? "note" : "react";
  const to = params.get("to") || "";
  const siteName = params.get("site") || "this site";
  const emoji = params.get("emoji") || "🎉";
  // The exact page they came from (passed by the widget), so we can slip them back.
  const from = params.get("from") || "";

  const [target, setTarget] = useState<Member | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  // Notes arrive already-sent; reactions become "sent" once we post them below.
  const [sent, setSent] = useState(kind === "note");
  const posting = useRef(false);

  // Stash the reaction durably the moment we land, so a botched sign-in round trip
  // (a reaped mobile tab, a magic link opened in another browser) can still recover
  // it. A note is already posted by /compose, so there's nothing left to hold.
  useEffect(() => {
    if (!to) return;
    if (kind === "react" && !sent) savePending({ kind: "react", to, site: siteName, from, emoji });
    else clearPending();
  }, [kind, to, siteName, from, emoji, sent]);

  useEffect(() => {
    if (to) getProfile(to).then(setTarget).catch(() => {});
  }, [to]);

  useEffect(() => {
    if (to && viewer) getStats(to).then(setStats).catch(() => {});
  }, [to, viewer]);

  // Post the reaction as the viewer, once we know who they are. Guarded so it
  // fires exactly once; clears the durable copy as soon as it lands.
  useEffect(() => {
    if (kind !== "react" || sent || !to || !viewer || posting.current) return;
    posting.current = true;
    postComment(to, emoji, "public")
      .then(() => { clearPending(); setSent(true); })
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
            from={from}
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

/** Pretty host for a "back to …" label: drop the scheme and any www. */
function prettyHost(url: string): string {
  try { return new URL(url).host.replace(/^www\./, ""); } catch { return ""; }
}

/** Signed in: the reaction/note is (being) posted as them — confirm + next steps. */
function Confirmed({
  isNote, sent, emoji, name, to, from, target, stats, setStats,
}: {
  isNote: boolean; sent: boolean; emoji: string; name: string;
  to: string; from: string; target: Member | null; stats: Stats | null; setStats: (s: Stats) => void;
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

  // Where to slip back to: the exact page they came from if the widget passed it,
  // else the target's linked site, else their signmysite profile.
  const backHref = from || target?.url || (target?.handle ? `/@${target.handle}` : "");
  const backLabel = prettyHost(from) || prettyHost(target?.url || "") || name;
  const profile = target?.handle ? `/@${target.handle}` : target?.url || "";

  return (
    <>
      <h1 className="confirm-title">
        {isNote ? "Note sent" : sent ? "Reaction sent" : "Sending…"}
      </h1>
      <p className="confirm-sub">
        {isNote ? <>It's on <b>{name}</b>'s site now.</> : <><b>{name}</b> got your {emoji}</>}
      </p>

      {/* The account they reached, with Follow right beside it. */}
      <div className="confirm-follow">
        {profile ? (
          <a className="confirm-who" href={profile}>
            <Avatar of={target || { name }} />
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

      {/* Back to the site they came from (to see their reaction land), then the
          growth nudge — install signmysite on your own site — if they haven't yet. */}
      <div className="confirm-actions">
        {backHref && (
          <a className="btn pink lg" href={backHref}>
            Back to {backLabel}
          </a>
        )}
        <AddToSite className="lg" />
      </div>
    </>
  );
}

/**
 * Not signed in: the reaction is held until they sign in — then it posts as them.
 * Both Google and an email magic link are offered (email matters on mobile and in
 * in-app browsers where Google's OAuth is blocked), each returning to this page
 * with the emoji intact so nothing is lost.
 */
function SignInToSend({ isNote, emoji, name }: { isNote: boolean; emoji: string; name: string }) {
  return (
    <>
      <h1 className="confirm-title">{isNote ? "Almost there" : "One more step"}</h1>
      <p className="confirm-sub">
        Sign in to add your {isNote ? "note" : emoji} to <b>{name}</b>. It posts as you, never anonymously.
      </p>
      <div className="confirm-signin">
        <SignIn returnTo={location.href} />
        <Link className="confirm-skip" to="/">Maybe later</Link>
      </div>
    </>
  );
}
