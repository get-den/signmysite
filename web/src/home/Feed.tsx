/*
 * The center column: a single reverse-chron feed of activity around you. A "since
 * you've been gone" digest leads (dismissible); then the stream — each row reads
 * "{A} {saved | commented on | reacted to} {B}'s site" and shows B's og:image, with
 * a comment's text under the image. Every site is followable inline (black button).
 * New pages load as you near the bottom; the header search narrows what's loaded.
 *
 * Built from small shared pieces: ActorAvatar, SiteLabel, SitePreview, FollowSite.
 */
import { Link } from "react-router-dom";
import type { FeedItem, FeedSite } from "../api";
import { compact, isReaction, profileHref, relTime } from "../lib";
import { Avatar, Button, CloseIcon, SiteThumbnail, Spinner } from "../ui";
import { useSearch } from "../providers";
import { Hint } from "./parts";
import { filterFeed, useInfiniteScroll, type HomeStore } from "./hooks";

export function Feed({ store }: { store: HomeStore }) {
  const { items, digest, feedLoading, loadMore, loadingMore, done } = store;
  const { q } = useSearch();
  const shown = filterFeed(items, q);
  const sentinel = useInfiniteScroll(loadMore, !done && !feedLoading && !q);

  return (
    <div className="feed">
      {!q && digest && <Digest digest={digest} />}

      {feedLoading ? (
        <div className="feed-loading"><Spinner size={22} /></div>
      ) : shown.length === 0 ? (
        <Hint>
          {q
            ? "Nothing in your feed matches that."
            : "Your feed is quiet for now. Follow a few people and the sites they save, note and update will land here."}
        </Hint>
      ) : (
        <ol className="feed-list">
          {shown.map((it) => (
            <li key={feedKey(it)}><FeedRow it={it} store={store} /></li>
          ))}
        </ol>
      )}

      {!q && !done && !feedLoading && (
        <div className="feed-more" ref={sentinel}>{loadingMore && <Spinner size={18} />}</div>
      )}
    </div>
  );
}

const feedKey = (it: FeedItem): string =>
  it.id ? it.kind + it.id : `${it.kind}:${it.actor?.id ?? "anon"}:${it.target.id}:${it.at}`;

/* ---- "since you've been gone" digest ------------------------------------- */
// Bigger, taller, number-forward. Dismissible: the X remembers THIS digest (by its
// counts) so it stays gone until the numbers change, then it returns.
const DISMISS_KEY = "signmysite:digest-dismissed";
const digestSig = (d: NonNullable<HomeStore["digest"]>) => `${d.newViews}-${d.newComments}-${d.newFollowers}`;

function Digest({ digest }: { digest: NonNullable<HomeStore["digest"]> }) {
  const sig = digestSig(digest);
  const isGone = () => { try { return localStorage.getItem(DISMISS_KEY) === sig; } catch { return false; } };
  // A render-bump on dismiss; isGone() is read fresh each render.
  const stats = [
    digest.newViews && { n: digest.newViews, label: digest.newViews === 1 ? "site view" : "site views" },
    digest.newComments && { n: digest.newComments, label: digest.newComments === 1 ? "new comment" : "new comments" },
    digest.newFollowers && { n: digest.newFollowers, label: digest.newFollowers === 1 ? "new follower" : "new followers" },
  ].filter(Boolean) as Array<{ n: number; label: string }>;
  if (!stats.length || isGone()) return null;
  return (
    <section className="digest" aria-label="Since you've been gone">
      <button
        type="button" className="digest-x" aria-label="Dismiss"
        onClick={() => { try { localStorage.setItem(DISMISS_KEY, sig); } catch { /* ignore */ } location.reload(); }}
      >
        <CloseIcon size={18} />
      </button>
      <div className="digest-label">Since you've been gone</div>
      <div className="digest-stats">
        {stats.map((s) => (
          <div className="digest-stat" key={s.label}>
            <div className="digest-num">{compact(s.n)}</div>
            <div className="digest-lbl">{s.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---- one feed row -------------------------------------------------------- */

function FeedRow({ it, store }: { it: FeedItem; store: HomeStore }) {
  const a = it.actor;
  const who = a?.name || (a?.handle ? `@${a.handle}` : "Someone");
  const yours = it.target.id === store.viewer.id;
  const react = it.kind === "comment" && it.body && isReaction(it.body) ? it.body.trim() : "";
  const showComment = it.kind === "comment" && !react;

  return (
    <article className="feed-item">
      <a className="feed-av" href={a ? profileHref(a) : "#"} aria-label={who}>
        <Avatar of={a ?? { name: "?" }} />
      </a>
      <div className="feed-body">
        <div className="feed-head">
          <p className="feed-line"><b>{who}</b> {verb()}</p>
          <div className="feed-aside">
            <time className="feed-time">{relTime(it.at)}</time>
            {!yours && it.target.id !== store.viewer.id && <FollowSite site={it.target} store={store} />}
          </div>
        </div>
        <SitePreview site={it.target} />
        {showComment && <p className="feed-quote">{it.body}</p>}
      </div>
    </article>
  );

  // The verb phrase after the actor's name, with the target as a link.
  function verb() {
    switch (it.kind) {
      case "saved": return <>saved {site()}</>;
      case "update": return <>updated their site</>;
      case "comment":
        return react
          ? <>reacted <span className="feed-react">{react}</span> to {site()}</>
          : <>commented on {site()}</>;
    }
  }
  function site() {
    return yours ? <b>your site</b> : <SiteLabel site={it.target} />;
  }
}

/** "{name}'s site" as a link to that site/profile. */
function SiteLabel({ site }: { site: FeedSite }) {
  return (
    <Link className="feed-tgt" to={profileHref(site)}>
      <b>{site.name || `@${site.handle}`}'s site</b>
    </Link>
  );
}

/** The target site's og:image — the visual anchor of every row. */
function SitePreview({ site }: { site: FeedSite }) {
  const href = site.url || profileHref(site);
  return (
    <a className="feed-media" href={href} target={site.url ? "_blank" : undefined} rel="noopener" aria-label={`Open ${site.name}`}>
      <SiteThumbnail site={site} />
    </a>
  );
}

/** Follow the site shown — black, inline. Hidden once you follow it. */
function FollowSite({ site, store }: { site: FeedSite; store: HomeStore }) {
  if (store.isFollowing(site.id)) return null;
  return <Button className="sm primary" onClick={() => store.follow(site)}>Follow</Button>;
}
