/*
 * The right rail — modular and state-aware. Its lead block depends on where you are:
 *   no site linked    → "Add your site" (paste a URL)
 *   linked, unverified → "Verify your site"
 *   verified           → a condensed glance at your analytics (SiteStatsMini); the
 *                        full breakdown lives on your own profile, via "See more".
 * Below the lead sits "Follow back" (signmysite members who've read you but you don't
 * follow yet). Every follow here and in the feed reflects the same shared graph, so a
 * row flips to "Following" the instant you act. On narrow screens it renders compact,
 * atop the feed column.
 */
import type { FeedActor, Member } from "../api";
import { host, relTime } from "../lib";
import { Avatar, CloseIcon, IdentityLink, SiteThumbnail } from "../ui";
import { LiveRail } from "../live";
import { FollowButton, SiteCTA } from "./parts";
import { SiteStatsMini } from "./SiteStats";
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
      {viewer.verified && <SiteStatsMini analytics={store.analytics} />}

      {wide && <FollowBack store={store} />}
      {/* "Who to follow" — temporarily hidden.
      <WhoToFollow store={store} limit={wide ? 5 : 3} /> */}
    </div>
  );
}

/* ---- your site (verified owners) ----------------------------------------- */
// A LinkedIn-style identity card — your site's og:image as the banner, your pfp
// overlapping it. The numbers that go with it are the condensed SiteStatsMini below.

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
// Temporarily hidden from the rail (see RightRail). Kept here so it can be switched
// back on without rebuilding it.
/*
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
*/

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
