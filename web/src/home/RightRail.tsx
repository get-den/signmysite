/*
 * The right rail — modular and state-aware. Its lead block depends on where you are:
 *   no site linked    → "Add your site" (paste a URL)
 *   linked, unverified → "Verify your site"
 *   verified           → your analytics, with an all-time / day / week / month toggle
 * Below the lead sit the social blocks: "Follow back" (signmysite members who've read you
 * but you don't follow yet) and "Who to follow" (recommended sites). Every follow
 * here and in the feed reflects the same shared graph, so a row flips to "Following"
 * the instant you act. On narrow screens it renders compact, atop the feed column.
 */
import { useMemo } from "react";
import type { Analytics, FeedActor, Member, Site } from "../api";
import { fmtDuration, host, relTime } from "../lib";
import { Avatar, CloseIcon, IdentityLink, SiteThumbnail } from "../ui";
import { LiveRail } from "../live";
import { FollowButton, SiteCTA } from "./parts";
import { useMediaQuery, type HomeStore as Store } from "./hooks";
import { WIDE } from "./FeedLayout";

export function RightRail({ store }: { store: Store }) {
  const wide = useMediaQuery(WIDE);
  const { viewer } = store;
  return (
    <div className={"rail-r" + (wide ? "" : " rail-r-compact")}>
      {/* Realtime activity, when the "rail" live variant is on (see web/src/live.tsx). */}
      <LiveRail />
      {/* Lead: add-site / verify (parts.SiteCTA), or your site cards once verified. */}
      <SiteCTA viewer={viewer} />
      {viewer.verified && <SiteCard viewer={viewer} />}
      {viewer.verified && <SiteStats analytics={store.analytics} />}

      {wide && <FollowBack store={store} />}
      <WhoToFollow store={store} limit={wide ? 5 : 3} />
    </div>
  );
}

/* ---- your site (verified owners) ----------------------------------------- */
// Two LinkedIn-style cards: an identity card — your site's og:image as the banner,
// your pfp overlapping it — then a separate card of label/value stat rows for the
// last 30 days (the one window; no toggle).

function SiteCard({ viewer }: { viewer: Member }) {
  return (
    <section className="rail-block sitecard">
      <IdentityLink of={viewer} className="sitecard-id" ariaLabel="Your profile">
        <span className="sitecard-banner"><SiteThumbnail site={viewer} /></span>
        <Avatar of={viewer} />
        <b className="sitecard-name">{viewer.name}</b>
        {(viewer.url || viewer.handle) && (
          <span className="sitecard-sub">{viewer.url ? host(viewer.url) : `@${viewer.handle}`}</span>
        )}
      </IdentityLink>
    </section>
  );
}

function SiteStats({ analytics }: { analytics: Analytics | null }) {
  const a = analytics;
  const returningPct = a?.visitors ? Math.round((a.returning / a.visitors) * 100) : 0;
  return (
    <section className="rail-block sitecard-stats">
      <p className="sitecard-range">Your site · last 30 days</p>
      {a && <FollowedReaders readers={a.followedReaders} />}
      <dl className="sitecard-rows">
        <Stat label="Views" value={(a?.views ?? 0).toLocaleString()} />
        <Stat label="Unique visitors" value={(a?.visitors ?? 0).toLocaleString()} />
        <Stat label="Avg. time" value={fmtDuration(a?.avgDurationMs)} />
        {!!a?.visitors && <Stat label="Returning visitors" value={`${returningPct}%`} />}
      </dl>
      {a && <DeviceSplit devices={a.devices} />}
      {a && <Breakdown title="Where from" rows={a.referrers.map((s) => ({ label: sourceName(s.key), count: s.count }))} />}
      {a && <Breakdown title="Countries" rows={a.countries.map((s) => ({ label: countryLabel(s.key!), count: s.count }))} />}
      {a && <Breakdown title="Languages" rows={a.languages.map((s) => ({ label: langLabel(s.key!), count: s.count }))} />}
    </section>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="sitecard-stat">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

// "Maya and 2 others you follow read your site this week" — the LinkedIn-style
// social line. Faces of the most recent readers you follow, then the sentence.
function FollowedReaders({ readers }: { readers: FeedActor[] }) {
  if (!readers.length) return null;
  const first = readers[0].name || (readers[0].handle ? `@${readers[0].handle}` : "Someone");
  const rest = readers.length - 1;
  const text = rest === 0
    ? `${first}, who you follow, read your site this week`
    : `${first} and ${rest} other${rest > 1 ? "s" : ""} you follow read your site this week`;
  return (
    <div className="sitecard-social">
      <span className="sitecard-faces">
        {readers.slice(0, 3).map((r) => <Avatar key={r.id} of={r} />)}
      </span>
      {text}
    </div>
  );
}

// Phone vs desktop as one split bar — only shown once a visit has carried the signal.
function DeviceSplit({ devices }: { devices: { phone: number; desktop: number } }) {
  const total = devices.phone + devices.desktop;
  if (!total) return null;
  const phone = Math.round((devices.phone / total) * 100);
  return (
    <div className="sitecard-devices">
      <div className="sitecard-split" role="img" aria-label={`Phone ${phone}%, desktop ${100 - phone}%`}>
        <span style={{ width: `${phone}%` }} />
      </div>
      <div className="sitecard-split-legend">
        <span>Phone {phone}%</span>
        <span>Desktop {100 - phone}%</span>
      </div>
    </div>
  );
}

// One breakdown section (sources / countries / languages): top three rows, each a
// label + visitor count over a faint bar proportional to the section's leader.
function Breakdown({ title, rows }: { title: string; rows: Array<{ label: string; count: number }> }) {
  const top = rows.slice(0, 3);
  if (!top.length) return null;
  const max = Math.max(...top.map((r) => r.count));
  return (
    <div className="sitecard-break">
      <h3>{title}</h3>
      {top.map((r) => (
        <div key={r.label} className="sitecard-bar">
          <span className="sitecard-bar-fill" style={{ width: `${Math.round((r.count / max) * 100)}%` }} />
          <span className="sitecard-bar-label">{r.label}</span>
          <span className="sitecard-bar-n">{r.count}</span>
        </div>
      ))}
    </div>
  );
}

/* Display names for the raw analytics keys. The server stores honest signals
   (referrer host, ISO country, language subtag); turning them into words is purely
   a presentation concern, so it lives here. */

// Hosts everyone recognizes get their product name; anything else shows as its
// bare host, and a null referrer is a direct visit (typed / bookmarked).
const SOURCES: Array<[RegExp, string]> = [
  [/^(twitter|x)\.com$|^t\.co$/, "X (Twitter)"],
  [/(^|\.)google\./, "Google"],
  [/^news\.ycombinator\.com$/, "Hacker News"],
  [/(^|\.)reddit\.com$/, "Reddit"],
  [/(^|\.)linkedin\.com$|^lnkd\.in$/, "LinkedIn"],
  [/(^|\.)instagram\.com$/, "Instagram"],
  [/(^|\.)facebook\.com$|^fb\.com$/, "Facebook"],
  [/(^|\.)youtube\.com$|^youtu\.be$/, "YouTube"],
  [/(^|\.)bing\.com$/, "Bing"],
  [/^duckduckgo\.com$/, "DuckDuckGo"],
];
const sourceName = (host: string | null): string =>
  host == null ? "Direct" : (SOURCES.find(([re]) => re.test(host))?.[1] ?? host);

// "US" → "🇺🇸 United States", "de" → "German" — via Intl, falling back to the raw
// code on any engine/code the lookup can't handle.
const displayName = (type: "region" | "language", code: string): string => {
  try { return new Intl.DisplayNames(undefined, { type }).of(code) || code; } catch { return code; }
};
const countryLabel = (cc: string): string => {
  const flag = String.fromCodePoint(...[...cc.toUpperCase()].map((ch) => 0x1f1a5 + ch.charCodeAt(0)));
  return `${flag} ${displayName("region", cc)}`;
};
const langLabel = (l: string): string => displayName("language", l);

/* ---- follow back -------------------------------------------------------- */
// signmysite members who've read you and that you didn't already follow at load. The
// button reflects the live graph, so following one flips it to "Following" in place.

function FollowBack({ store }: { store: Store }) {
  const list = store.followBack.slice(0, 5);
  if (!list.length) return null;
  return (
    <section className="rail-block">
      <div className="rail-block-head"><h2>Follow back</h2></div>
      <ul className="person-list">
        {list.map((f) => (
          <Person key={f.id} actor={f} store={store} sub={`Followed you · ${relTime(f.followedAt)}`} />
        ))}
      </ul>
    </section>
  );
}

/* ---- who to follow ------------------------------------------------------ */

function WhoToFollow({ store, limit }: { store: Store; limit: number }) {
  // Snapshot once recommendations load: drop yourself + anyone you already followed at
  // THAT moment, then keep the list stable. So following someone here flips their button
  // to "Following" in place rather than popping them off the list. (isFollowing is left
  // out of the deps on purpose — re-running on every follow is exactly what we avoid.)
  const people = useMemo(
    () => store.recommended.filter((s) => s.id !== store.viewer.id && !store.isFollowing(s.id)).slice(0, limit),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store.recommended, store.viewer.id, limit],
  );
  if (!people.length) return null;
  return (
    <section className="rail-block">
      <div className="rail-block-head"><h2>Who to follow</h2></div>
      <ul className="person-list">
        {people.map((s: Site) => (
          <Person
            key={s.id} actor={s} store={store}
            sub={s.reason || (s.url ? host(s.url) : `@${s.handle}`)}
            onDismiss={() => store.dismissRecommendation(s)}
          />
        ))}
      </ul>
    </section>
  );
}

/* ---- a person row (shared by both social blocks) ------------------------ */

function Person({
  actor, sub, store, onDismiss,
}: { actor: FeedActor; sub: string; store: Store; onDismiss?: () => void }) {
  const name = actor.name || (actor.handle ? `@${actor.handle}` : "Someone");
  return (
    <li className="person">
      <IdentityLink of={actor} className="person-id">
        <Avatar of={actor} />
        <span className="person-meta">
          <b>{name}</b>
          <span className="person-sub">{sub}</span>
        </span>
      </IdentityLink>
      {actor.id === store.viewer.id ? null : (
        <div className="person-actions">
          <FollowButton following={store.isFollowing(actor.id)} onToggle={() => store.toggleFollow(actor)} />
          {onDismiss && (
            <button
              type="button" className="person-dismiss" aria-label={`Not interested in ${name}`}
              title="Not interested" onClick={onDismiss}
            >
              <CloseIcon size={15} />
            </button>
          )}
        </div>
      )}
    </li>
  );
}
