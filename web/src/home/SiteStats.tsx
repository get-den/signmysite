/*
 * Your own site's analytics, in two altitudes:
 *   SiteStatsMini  — a condensed rail widget (3 headline figures + "See more").
 *                    Rides the home feed's right rail, where a glance is enough.
 *   SiteStats      — the full breakdown (figures, who-you-follow read it, device
 *                    split, sources / countries / languages). Lives on your own
 *                    profile, where "See more" lands.
 * Both read the same last-30-days Analytics; the mini is the synthesis, the full is
 * the detail. Owner-only — a setup CTA stands in until the site is verified.
 */
import { Link } from "react-router-dom";
import type { Analytics, FeedActor } from "../api";
import { compact, fmtDuration } from "../lib";
import { Avatar } from "../ui";

/* ---- condensed (home feed rail) ----------------------------------------- */
// Just the three numbers that say how you're doing — reach, unique reach, and how
// long they stay — under a plain widget header, with a link through to the rest.

export function SiteStatsMini({ analytics }: { analytics: Analytics | null }) {
  const a = analytics;
  return (
    <section className="rail-block sitemini">
      <div className="rail-block-head">
        <h2>Your site</h2>
        <Link className="rail-more" to="/profile">See more</Link>
      </div>
      <div className="sitemini-figs">
        <Fig value={compact(a?.views ?? 0)} label="Views" />
        <Fig value={compact(a?.visitors ?? 0)} label="Visitors" />
        <Fig value={fmtDuration(a?.avgDurationMs)} label="Avg. time" />
      </div>
    </section>
  );
}

function Fig({ value, label }: { value: string; label: string }) {
  return (
    <div className="sitemini-fig">
      <div className="sitemini-n">{value}</div>
      <div className="sitemini-l">{label}</div>
    </div>
  );
}

/* ---- full (your profile) ------------------------------------------------- */
// The label/value figures, then the social line, the phone/desktop split, and the
// three top-three breakdowns. Last 30 days, the one window (no toggle).

export function SiteStats({ analytics }: { analytics: Analytics | null }) {
  const a = analytics;
  const returningPct = a?.visitors ? Math.round((a.returning / a.visitors) * 100) : 0;
  return (
    <section className="rail-block sitecard-stats">
      <div className="rail-block-head">
        <h2>Your site</h2>
        <span className="rail-block-sub">Last 30 days</span>
      </div>
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
