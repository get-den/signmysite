import { useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { follow, getProfile, getStats, save, type Member, type Stats } from "../api";
import { useViewer } from "../providers";
import { useToast } from "../providers";
import { Avatar } from "../ui";

/**
 * The landing after a reaction or a sent postcard. It celebrates that the thing
 * went through, then nudges the next step: make a Den (if they're a stranger),
 * or follow / save the site (if they're a member).
 */
export function Reacted() {
  const { viewer } = useViewer();
  const [params] = useSearchParams();

  const kind = params.get("kind") === "note" ? "note" : "react";
  const to = params.get("to") || "";
  const siteName = params.get("site") || "this site";
  const emoji = params.get("emoji") || "🎉";

  const [target, setTarget] = useState<Member | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    if (!to) return;
    getProfile(to).then(setTarget).catch(() => {});
    if (viewer) getStats(to).then(setStats).catch(() => {});
  }, [to, viewer]);

  if (!to) return <Navigate to="/" replace />;

  const name = target?.name || siteName;
  const isNote = kind === "note";

  return (
    <div className="sheet">
      <div className="sheet-bar">
        <Link className="sheet-close" to="/" aria-label="Close">✕</Link>
      </div>

      <div className="confirm">
        <div className={"confirm-mark" + (isNote ? " mail" : "")} aria-hidden="true">
          {isNote ? "✉️" : emoji}
        </div>
        <h1 className="confirm-title">
          {isNote ? "Your postcard is on its way" : "Reaction sent"}
        </h1>
        <p className="confirm-sub">
          {isNote
            ? `${name} will find it in their notes.`
            : <>Your {emoji} landed on <b>{name}</b>'s wall.</>}
        </p>

        {viewer ? (
          <MemberNext to={to} name={name} target={target} stats={stats} setStats={setStats} />
        ) : (
          <StrangerNext />
        )}
      </div>
    </div>
  );
}

/** Signed-in: offer to follow or save the site they just engaged with. */
function MemberNext({
  to, name, target, stats, setStats,
}: {
  to: string; name: string; target: Member | null; stats: Stats | null;
  setStats: (s: Stats) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const toggle = async (fn: (id: string) => Promise<Stats>, label: string) => {
    if (busy) return;
    setBusy(true);
    try {
      setStats(await fn(to));
      toast(label);
    } catch {
      toast("Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="confirm-site">
        <Avatar of={target || { name }} />
        <span>{name}</span>
      </div>
      <div className="confirm-actions">
        <button
          className={"btn" + (stats?.viewerFollows ? "" : " primary")}
          type="button"
          disabled={busy}
          onClick={() => toggle(follow, stats?.viewerFollows ? "Unfollowed" : "Following")}
        >
          {stats?.viewerFollows ? "Following ✓" : "Follow"}
        </button>
        <button
          className={"btn" + (stats?.viewerSaved ? "" : " pink")}
          type="button"
          disabled={busy}
          onClick={() => toggle(save, stats?.viewerSaved ? "Removed" : "Saved")}
        >
          {stats?.viewerSaved ? "Saved ✓" : "Save"}
        </button>
      </div>
      <Link className="confirm-skip" to="/">Back to your Den</Link>
    </>
  );
}

/** Not signed in: nudge them to make a Den, keeping them on this page after. */
function StrangerNext() {
  const ret = `${location.origin}/#${location.hash.slice(1) || "/reacted"}`;
  const signin = `/api/auth/google?return=${encodeURIComponent(ret)}`;
  return (
    <div className="confirm-cta">
      <p>Want a corner of the web like this one?</p>
      <a className="btn pink lg" href={signin}>Make your Den</a>
      <Link className="confirm-skip" to="/">Maybe later</Link>
    </div>
  );
}
