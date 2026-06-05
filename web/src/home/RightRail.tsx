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
import { useMemo, type ReactNode } from "react";
import type { AnalyticsRange, FeedActor, Site } from "../api";
import { compact, fmtDuration, host, relTime } from "../lib";
import { Avatar, IdentityLink } from "../ui";
import { FollowButton, SiteCTA } from "./parts";
import { useMediaQuery, type HomeStore as Store } from "./hooks";
import { WIDE } from "./FeedLayout";

export function RightRail({ store }: { store: Store }) {
  const wide = useMediaQuery(WIDE);
  const { viewer } = store;
  return (
    <div className={"rail-r" + (wide ? "" : " rail-r-compact")}>
      {/* Lead: add-site / verify (parts.SiteCTA), or analytics once verified. */}
      <SiteCTA viewer={viewer} />
      {viewer.verified && <Analytics store={store} />}

      {wide && <FollowBack store={store} />}
      <WhoToFollow store={store} limit={wide ? 5 : 3} />
    </div>
  );
}

/* ---- analytics (verified owners) ---------------------------------------- */

const RANGES: Array<[AnalyticsRange, string]> = [
  ["all", "All time"], ["day", "24 hours"], ["week", "7 days"], ["month", "30 days"],
];

function Analytics({ store }: { store: Store }) {
  const { analytics, range, setRange } = store;
  return (
    <section className="rail-block analytics">
      <div className="rail-block-head">
        <h2>Your site</h2>
        <select
          className="rail-select" value={range} aria-label="Analytics time range"
          onChange={(e) => setRange(e.target.value as AnalyticsRange)}
        >
          {RANGES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </div>
      <div className="analytics-nums">
        <Metric value={compact(analytics?.views ?? 0)} label="Views" />
        <Metric value={compact(analytics?.visitors ?? 0)} label="Visitors" />
        <Metric value={fmtDuration(analytics?.avgDurationMs)} label="Avg. time" />
      </div>
    </section>
  );
}

function Metric({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="metric">
      <div className="metric-val">{value}</div>
      <div className="metric-label">{label}</div>
    </div>
  );
}

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
          <Person key={s.id} actor={s} store={store} sub={s.reason || (s.url ? host(s.url) : `@${s.handle}`)} />
        ))}
      </ul>
    </section>
  );
}

/* ---- a person row (shared by both social blocks) ------------------------ */

function Person({ actor, sub, store }: { actor: FeedActor; sub: string; store: Store }) {
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
        <FollowButton following={store.isFollowing(actor.id)} onToggle={() => store.toggleFollow(actor)} />
      )}
    </li>
  );
}
