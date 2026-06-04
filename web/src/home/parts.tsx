/*
 * Shared presentational atoms for the home layouts. Each is deliberately small
 * and unopinionated about arrangement — the layouts own the composition, these
 * own the look of a single thing (a reader, a stat, an identity chip). One pink
 * accent, hairline rules, Söhne; nothing here introduces a new color.
 */
import { type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Member, Site, ViewerVisit } from "../api";
import { compact, host, profileHref, relTime } from "../lib";
import { Avatar, Button, PinIcon, SiteThumbnail, useCopy } from "../ui";
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

/** One Den reader as a list row: who they are, how they read you, a follow-back.
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
  site, index, pinned, canPin, onPin, big = false,
}: {
  site: Site; index: number; pinned?: boolean; canPin?: boolean; onPin?: (s: Site) => void; big?: boolean;
}) {
  const profile = profileHref(site);
  const external = !!site.url;
  return (
    <article className={"tile" + (big ? " tile-big" : "")}>
      <a
        className={"tile-thumb thumb-" + (index % 6)}
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

/** The one-line widget snippet + a copy button. The whole install, everywhere. */
export function WidgetLine({ viewer, className = "" }: { viewer: Member; className?: string }) {
  const tag = `<script src="${location.origin}/w/${viewer.id.replace(/^den:/, "")}.js"></script>`;
  const { copied, copy } = useCopy(tag);
  return (
    <div className={("widget-line " + className).trim()}>
      <code className="snippet">{tag}</code>
      <button className="btn sm" type="button" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
    </div>
  );
}

/** The quiet nudge shown (in every layout) while a linked site is unverified. */
export function VerifyNotice({ viewer }: { viewer: Member }) {
  if (!viewer.url || viewer.verified) return null;
  return (
    <div className="verify-bar">
      <span>Your site <b>{host(viewer.url)}</b> is unverified. Add your widget to claim it.</span>
      <Link className="btn sm" to="/verify">Verify</Link>
    </div>
  );
}

/** An empty-state line: calm, never a dead end — always says what to do next. */
export function Hint({ children }: { children: ReactNode }) {
  return <p className="home-hint">{children}</p>;
}
