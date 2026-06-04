/*
 * Brief — "Today." The home as a calm, once-a-day editorial check-in. One narrow
 * reading column: a masthead that greets you and states the day in a sentence,
 * then the single most valuable thing to do (follow back the humans reading you),
 * then a quiet what's-new list, then your numbers as a footnote. The job is a
 * 30-second visit that's worth making every morning.
 */
import { Link } from "react-router-dom";
import { compact, host, relTime } from "../lib";
import { Avatar, WidgetInstall } from "../ui";
import type { HomeData } from "./data";
import { Greeting, Hint, ReaderRow } from "./parts";

export function Brief({ data }: { data: HomeData }) {
  const { viewer, stats, analytics, unfollowedReaders, freshFollows, followBack } = data;
  const known = analytics?.knownVisitors ?? 0;

  const situation =
    unfollowedReaders.length > 0
      ? `${unfollowedReaders.length} ${unfollowedReaders.length === 1 ? "person who reads you isn't" : "people who read you aren't"} in your circle yet.`
      : known > 0
        ? "You've followed back everyone reading you. Your circle is in sync."
        : "Your site is out there working. Share it to meet your first readers.";

  return (
    <div className="brief">
      <header className="brief-top">
        <Greeting viewer={viewer} />
        <p className="brief-situation">{situation}</p>
      </header>

      <section className="brief-act" aria-label="Follow back">
        <div className="brief-label">
          <span>Follow back</span>
          {unfollowedReaders.length > 0 && <span className="brief-count">{unfollowedReaders.length}</span>}
        </div>
        {unfollowedReaders.length > 0 ? (
          <ul className="reader-list">
            {unfollowedReaders.map((who) => (
              <ReaderRow key={who.id} who={who} onFollow={followBack} />
            ))}
          </ul>
        ) : (
          <Hint>
            Nobody new to follow back today. When a signmysite member opens your site, they show up
            here, ready to connect.
          </Hint>
        )}
      </section>

      {freshFollows.length > 0 && (
        <section className="brief-new" aria-label="New from your follows">
          <div className="brief-label"><span>New from your follows</span></div>
          <ul className="fresh-list">
            {freshFollows.slice(0, 5).map((site) => (
              <li key={site.id}>
                <a className="fresh-row" href={site.url || `/@${site.handle}`} target={site.url ? "_blank" : undefined} rel="noopener">
                  <Avatar of={site} />
                  <span className="fresh-meta">
                    <b>{site.name}</b>
                    <span className="fresh-sub">
                      {site.url ? host(site.url) : `@${site.handle}`}
                      {site.lastEdited ? ` · updated ${relTime(site.lastEdited)}` : " · updated"}
                    </span>
                  </span>
                  <span className="fresh-go" aria-hidden="true">→</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="brief-foot">
        <p className="brief-numbers">
          <b>{compact(stats?.views)}</b> reads
          <span className="dot" /> <b>{compact(stats?.followers)}</b> followers
          <span className="dot" /> <b>{compact(stats?.following)}</b> following
          <span className="dot" /> <b>{compact(stats?.saved)}</b> saved
        </p>
        <div className="brief-foot-row">
          <WidgetInstall viewer={viewer} className="brief-widget" />
          <div className="brief-foot-links">
            <Link to="/edit">Edit profile</Link>
            {viewer.handle && <a href={`/@${viewer.handle}`}>View as visitor</a>}
          </div>
        </div>
      </footer>
    </div>
  );
}
