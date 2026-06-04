/*
 * Spotlight — the same "how is my site doing?" job as Console, but staged around a
 * single dominant number. Your total reach fills the page; the rest (visitors this
 * week, new comments, saves) sits quietly beneath it. Same state-aware top: add a
 * site, or verify it, before the numbers mean anything. For when you want the one
 * figure that says "people are out there reading me," not a grid of them.
 */
import { compact } from "../lib";
import type { HomeData } from "./data";
import { Hint, ReaderRow, SiteCTA, StatCard } from "./parts";

export function Spotlight({ data }: { data: HomeData }) {
  const { viewer, stats, analytics, newComments, unfollowedReaders, followBack } = data;
  const hasSite = !!viewer.url;
  const saves = stats?.saved ?? 0;
  const reach = analytics?.views ?? stats?.views ?? 0;

  return (
    <div className="spotlight">
      <SiteCTA viewer={viewer} />

      {hasSite ? (
        <>
          <div className="spot-hero">
            <div className="spot-num">{compact(reach)}</div>
            <div className="spot-cap">{reach === 1 ? "read of your site, all time" : "reads of your site, all time"}</div>
          </div>

          <section className="spot-row" aria-label="This week">
            <StatCard value={compact(analytics?.visitorsWeek)} label="Visitors" sub="this week" />
            <StatCard
              value={compact(newComments)} label="New comments" sub="this week"
              to="/notes" accent={newComments > 0}
            />
            <StatCard value={compact(saves)} label="Saves" sub={saves === 1 ? "person saved you" : "people saved you"} />
          </section>

          {unfollowedReaders.length > 0 && (
            <section className="console-block">
              <div className="block-head"><h3>Who's reading you</h3></div>
              <ul className="reader-list">
                {unfollowedReaders.slice(0, 4).map((w) => <ReaderRow key={w.id} who={w} onFollow={followBack} />)}
              </ul>
            </section>
          )}
        </>
      ) : (
        <Hint>Link your site and your reach shows up here, big and clear.</Hint>
      )}
    </div>
  );
}
