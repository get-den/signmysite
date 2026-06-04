/*
 * Shared presentational atoms for the home layouts. Each is deliberately small
 * and unopinionated about arrangement — the layouts own the composition, these
 * own the look of a single thing (a reader, a stat, an identity chip). One pink
 * accent, hairline rules, Söhne; nothing here introduces a new color.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { updateProfile } from "../api";
import type { Member, Site, ViewerVisit } from "../api";
import { compact, host, profileHref, relTime, validateSite } from "../lib";
import { useToast, useViewer } from "../providers";
import { Avatar, Button, PinIcon, SiteThumbnail, Spinner } from "../ui";
import { firstName } from "./data";

/** Date line + a greeting that follows the clock. The Brief's masthead. */
export function Greeting({ viewer }: { viewer: Member }) {
  const now = new Date();
  const h = now.getHours();
  const part = h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const date = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  return (
    <div className="greet">
      <div className="greet-date">{date}</div>
      <h1 className="greet-hi">{part}, {firstName(viewer)}.</h1>
    </div>
  );
}

/** The follow-back control: a solid pink "Follow back", or a quiet "Following"
 *  once the relation exists. The single action the home keeps asking you to take. */
export function FollowBtn({ who, onFollow }: { who: ViewerVisit; onFollow: (v: ViewerVisit) => void }) {
  return who.viewerFollows ? (
    <span className="reader-following">Following</span>
  ) : (
    <Button className="sm pink" onClick={() => onFollow(who)}>Follow back</Button>
  );
}

/** One signmysite reader as a list row: who they are, how they read you, a follow-back.
 *  The atom behind Brief's priority list and Stream's read events. */
export function ReaderRow({ who, onFollow }: { who: ViewerVisit; onFollow: (v: ViewerVisit) => void }) {
  return (
    <li className="reader">
      <a className="reader-id" href={profileHref(who)}>
        <Avatar of={who} />
        <span className="reader-meta">
          <b>{who.name || `@${who.handle ?? "someone"}`}</b>
          <span className="reader-sub">
            {who.views === 1 ? "read you" : `read you ${compact(who.views)}x`} · {relTime(who.lastSeen)}
            {who.followsYou && <span className="reader-tag">follows you</span>}
          </span>
        </span>
      </a>
      <FollowBtn who={who} onFollow={onFollow} />
    </li>
  );
}

/** A site preview tile for the gallery wall: the og:image, name + counts, and an
 *  optional pin toggle that writes through to your public profile. */
export function SiteTile({
  site, pinned, canPin, onPin, big = false,
}: {
  site: Site; pinned?: boolean; canPin?: boolean; onPin?: (s: Site) => void; big?: boolean;
}) {
  const profile = profileHref(site);
  const external = !!site.url;
  return (
    <article className={"tile" + (big ? " tile-big" : "")}>
      <a
        className="tile-thumb"
        href={site.url || profile}
        target={external ? "_blank" : undefined}
        rel="noopener"
        aria-label={`Open ${site.name}`}
      >
        <SiteThumbnail site={site} />
        {site.isNew && <span className="tile-new">New</span>}
      </a>
      {canPin && onPin && (
        <button
          type="button"
          className={"tile-pin" + (pinned ? " on" : "")}
          onClick={() => onPin(site)}
          aria-pressed={pinned}
          aria-label={pinned ? `Unpin ${site.name}` : `Pin ${site.name} to your profile`}
          title={pinned ? "Pinned to your profile" : "Pin to your profile"}
        >
          <PinIcon filled={pinned} />
        </button>
      )}
      <div className="tile-foot">
        <a className="tile-author" href={profile}>
          <Avatar of={site} />
          <span className="tile-name">{site.name}</span>
        </a>
        {site.reason && <span className="tile-reason">{site.reason}</span>}
      </div>
    </article>
  );
}

/**
 * The nudge shown (in every layout) while a linked site is unverified. Rather than
 * poll, it leans on auto-detection: the moment the widget loads on the member's own
 * site, the server flips them verified (same-origin proof). So this just re-checks
 * the viewer whenever the tab regains focus — they tab back from adding the widget
 * and it clears itself. A manual Refresh and a path into the full setup sit beside it.
 */
export function VerifyNotice({ viewer }: { viewer: Member }) {
  const { refreshViewer } = useViewer();
  const [refreshing, setRefreshing] = useState(false);
  const pending = !!viewer.url && !viewer.verified;

  useEffect(() => {
    if (!pending) return;
    const recheck = () => { if (document.visibilityState === "visible") refreshViewer(); };
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [pending, refreshViewer]);

  if (!pending) return null;

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    await refreshViewer();
    setRefreshing(false);
  };

  return (
    <div className="verify-bar">
      <span className="verify-bar-msg">
        <Spinner />
        Listening for your widget on <b>{host(viewer.url!)}</b>. It verifies itself once it loads.
      </span>
      <span className="verify-bar-actions">
        <button type="button" className="btn sm naked" onClick={refresh} disabled={refreshing}>
          {refreshing ? <Spinner /> : "Refresh"}
        </button>
        <Link className="btn sm primary" to="/verify">Add your site</Link>
      </span>
    </div>
  );
}

/** An empty-state line: calm, never a dead end — always says what to do next. */
export function Hint({ children }: { children: ReactNode }) {
  return <p className="home-hint">{children}</p>;
}

/** One KPI in the executive summary: a big number, a label, an optional sub-line,
 *  and — when it links somewhere ("take me to them") — a quiet arrow on hover. */
export function StatCard({
  value, label, sub, to, accent = false,
}: {
  value: ReactNode; label: string; sub?: string; to?: string; accent?: boolean;
}) {
  const body = (
    <>
      <div className="kpi-val">{value}</div>
      <div className="kpi-label">{label}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
      {to && <span className="kpi-go" aria-hidden="true">→</span>}
    </>
  );
  const cls = "kpi" + (accent ? " kpi-accent" : "") + (to ? " kpi-link" : "");
  return to ? <Link className={cls} to={to}>{body}</Link> : <div className={cls}>{body}</div>;
}

/**
 * The state-aware top of the analytics layouts. The first thing you should see
 * depends on where you are: no linked site → a clear box to add one; a linked but
 * unverified site → a prompt to verify it. Once verified it renders nothing, and
 * the layout shows your summary instead.
 */
export function SiteCTA({ viewer }: { viewer: Member }) {
  if (!viewer.url) return <AddSiteForm />;
  if (!viewer.verified) return <VerifyCTA url={viewer.url} />;
  return null;
}

// Paste a site → save it on your profile (then verify next). Mirrors the edit
// page: validate live, PATCH the profile, refresh the viewer in place.
function AddSiteForm() {
  const { viewer, setViewer } = useViewer();
  const toast = useToast();
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    if (busy || !viewer) return;
    const check = validateSite(raw);
    if (!check.ok || !check.url) { setErr(check.error || "Enter your site's web address."); return; }
    setBusy(true); setErr("");
    try {
      const updated = await updateProfile({
        name: viewer.name, handle: viewer.handle ?? "", url: check.url,
        avatar: viewer.avatar ?? "", links: viewer.links ?? [],
      });
      setViewer(updated);
      toast("Site linked. Verify it next.");
    } catch {
      setErr("Couldn't link that site. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="cta cta-add">
      <div className="cta-head">
        <h2>Add your site</h2>
        <p>Link your personal site and signmysite starts showing you who reads it.</p>
      </div>
      <div className={"cta-field" + (err ? " bad" : "")}>
        <input
          value={raw}
          onChange={(e) => { setRaw(e.target.value); setErr(""); }}
          placeholder="yoursite.com"
          aria-label="Your site's web address"
          autoCapitalize="none" autoCorrect="off" spellCheck={false}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        />
        <Button className="primary" loading={busy} disabled={!raw.trim()} onClick={submit}>Add site</Button>
      </div>
      {err && <p className="cta-err">{err}</p>}
    </section>
  );
}

// Linked but unproven: a nudge into the guided /verify flow (pick platform, paste,
// confirm). The whole install lives there, so this just points the way.
function VerifyCTA({ url }: { url: string }) {
  return (
    <section className="cta cta-verify">
      <div className="cta-head">
        <h2>Add signmysite to your site</h2>
        <p>Add the one-line widget to <b>{host(url)}</b> to confirm it's yours.</p>
      </div>
      <Link className="btn primary" to="/verify">Add your site</Link>
    </section>
  );
}
