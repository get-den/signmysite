import { DemoLink, JoinLink, PEOPLE } from "./shared";

/**
 * Variant 5 — the guestbook, a thing everyone already understands. The hero is a
 * filled-in guestbook card for "yoursite.com", signed by real people of the
 * personal web.
 */

// name index in PEOPLE, what they wrote, when.
const ENTRIES: Array<[number, string, string]> = [
  [0, "great essay.", "2h"],
  [1, "the diagrams in this one are lovely.", "5h"],
  [2, "been reading for years. finally signing.", "1d"],
  [5, "🔥", "2d"],
];

export function V5() {
  return (
    <div className="lv">
      <h1>The guestbook is back</h1>
      <p className="lv-sub">
        signmysite puts one on your website with a single line of HTML. Readers sign
        it, you see who they are, and their sites are a click away.
      </p>
      <div className="lv-gbook" aria-hidden="true">
        <div className="lv-gbook-head">
          <b>yoursite.com</b>
          <span>guestbook</span>
        </div>
        {ENTRIES.map(([i, body, t]) => {
          const p = PEOPLE[i];
          return (
            <div key={p.handle} className="lv-gbook-row">
              <img src={p.avatar} alt="" loading="lazy" />
              <span className="lv-gbook-meta">
                <b>{p.name}</b> <i>{p.site}</i>
              </span>
              <span className="lv-gbook-note">{body}</span>
              <span className="lv-gbook-time">{t}</span>
            </div>
          );
        })}
      </div>
      <div className="lv-cta-row">
        <JoinLink>Put one on my site</JoinLink>
        <DemoLink />
      </div>
    </div>
  );
}
