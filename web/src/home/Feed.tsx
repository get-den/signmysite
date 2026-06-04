/*
 * The center column: a single reverse-chron feed of everything around you. A
 * "since you've been gone" digest leads (only when there's something new), then the
 * stream itself — who read you, notes on your site, and your network's activity
 * (people you follow commenting, following, updating). Each row states what happened
 * in one line and carries its own action inline (follow back, reply, open). New pages
 * load as you near the bottom. The header search narrows what's already loaded.
 */
import { Link } from "react-router-dom";
import type { FeedActor, FeedItem } from "../api";
import { compact, isReaction, profileHref, relTime } from "../lib";
import { Avatar, Button, Spinner } from "../ui";
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
            : "Your feed is quiet for now. Add your site, follow a few people, and the things they do will land here."}
        </Hint>
      ) : (
        <ol className="feed-list">
          {shown.map((it) => (
            <li key={feedKey(it)}>
              <FeedRow it={it} store={store} />
            </li>
          ))}
        </ol>
      )}

      {!q && !done && !feedLoading && (
        <div className="feed-more" ref={sentinel}>
          {loadingMore && <Spinner size={18} />}
        </div>
      )}
    </div>
  );
}

function feedKey(it: FeedItem): string {
  if (it.id) return it.kind + it.id;
  return `${it.kind}:${it.actor?.id ?? "anon"}:${it.target?.id ?? ""}:${it.at}`;
}

// The "since you've been gone" summary: rolling counts over the digest window. Each
// nonzero metric becomes a chip; an all-zero digest never renders (handled above).
function Digest({ digest }: { digest: NonNullable<HomeStore["digest"]> }) {
  const chips = [
    digest.newViews && { n: digest.newViews, label: digest.newViews === 1 ? "site view" : "site views" },
    digest.newComments && { n: digest.newComments, label: digest.newComments === 1 ? "new comment" : "new comments" },
    digest.newFollowers && { n: digest.newFollowers, label: digest.newFollowers === 1 ? "new follower" : "new followers" },
  ].filter(Boolean) as Array<{ n: number; label: string }>;
  if (!chips.length) return null;
  return (
    <section className="digest" aria-label="Since you've been gone">
      <div className="digest-label">Since you've been gone</div>
      <div className="digest-row">
        {chips.map((c) => (
          <span className="digest-chip" key={c.label}>
            <b>{compact(c.n)}</b> {c.label}
          </span>
        ))}
      </div>
    </section>
  );
}

function FeedRow({ it, store }: { it: FeedItem; store: HomeStore }) {
  const actor = it.actor;
  const who = actor?.name || (actor?.handle ? `@${actor.handle}` : "Someone");
  const react = it.body && isReaction(it.body) ? it.body.trim() : "";

  return (
    <article className="feed-item">
      <a className="feed-av" href={actor ? profileHref(actor) : "#"} aria-label={who}>
        <Avatar of={actor ?? { name: "?" }} />
      </a>
      <div className="feed-body">
        <p className="feed-line">{line()}</p>
        {it.body && !react && it.visibility === "private" && it.kind === "comment_in" ? (
          <p className="feed-quote feed-quote-muted">Private note</p>
        ) : it.body && !react ? (
          <p className="feed-quote">{it.body}</p>
        ) : null}
        {it.kind === "update" && it.thumbnail && (
          <a className="feed-thumb" href={actor?.url || (actor ? profileHref(actor) : "#")}
            target={actor?.url ? "_blank" : undefined} rel="noopener">
            <img src={it.thumbnail} alt="" loading="lazy" decoding="async" />
          </a>
        )}
        <div className="feed-meta">{relTime(it.at)}</div>
      </div>
      <div className="feed-action">{action()}</div>
    </article>
  );

  function line() {
    const name = <b>{who}</b>;
    switch (it.kind) {
      case "read":
        return <>{name} read your site{it.views && it.views > 1 ? <span className="feed-dim"> · {compact(it.views)}×</span> : null}</>;
      case "comment_in":
        return react
          ? <>{name} reacted <span className="feed-react">{react}</span> on your site</>
          : <>{name} left a note on your site</>;
      case "comment_out":
        return react
          ? <>{name} reacted <span className="feed-react">{react}</span> on {tgt()}</>
          : <>{name} left a note on {tgt()}</>;
      case "follow":
        return <>{name} followed {tgt()}</>;
      case "update":
        return <>{name} updated their site</>;
    }
  }

  function tgt() {
    const t = it.target;
    if (!t) return <b>a site</b>;
    return <Link className="feed-tgt" to={profileHref(t)}><b>{t.name || `@${t.handle}`}</b></Link>;
  }

  function action() {
    // A read you don't follow back, or a suggested person to follow: offer Follow.
    const followable: FeedActor | undefined =
      it.kind === "read" ? actor ?? undefined :
      it.kind === "follow" ? it.target :
      undefined;
    if (followable && followable.id !== store.viewer.id) {
      return store.isFollowing(followable.id)
        ? <span className="feed-follows">Following</span>
        : <Button className="sm pink" onClick={() => store.follow(followable)}>Follow{it.kind === "read" ? " back" : ""}</Button>;
    }
    // A note on your site → reply where the conversation belongs.
    if (it.kind === "comment_in" && actor?.handle) {
      return <Link className="feed-reply" to={`/@${actor.handle}`}>Reply</Link>;
    }
    return null;
  }
}
