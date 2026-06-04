/*
 * Gallery — "The wall." The home stripped to its most honest job: look at the
 * personal sites. Den recedes to a thin bar of controls and the previews fill the
 * page. Your pinned three lead as large tiles (the showcase that rides to your
 * public profile); below, a quiet grid of the sites you follow and ones you might.
 * Hover a tile to pin it. The job is browsing and curating — taste, made visible.
 */
import { useMemo, useState } from "react";
import { Avatar, PinIcon, SearchIcon, SiteThumbnail } from "../ui";
import { profileHref } from "../lib";
import type { HomeData } from "./data";
import { Hint, SiteTile } from "./parts";

type Shelf = "all" | "following" | "recommended" | "saved";
const SHELVES: Array<[Shelf, string]> = [
  ["all", "Everything"],
  ["following", "Following"],
  ["recommended", "For you"],
  ["saved", "Most saved"],
];

export function Gallery({ data }: { data: HomeData }) {
  const { viewer, following, discovery, pinned, pinnedIds, allSites, togglePinSite } = data;
  const [shelf, setShelf] = useState<Shelf>("all");
  const [query, setQuery] = useState("");

  const base =
    shelf === "following" ? following :
    shelf === "recommended" ? discovery.recommended :
    shelf === "saved" ? discovery.mostSaved :
    allSites;

  const wall = useMemo(() => {
    const q = query.trim().toLowerCase();
    // The pinned three already lead the page as the featured row.
    const rest = base.filter((s) => !pinnedIds.has(s.id));
    if (!q) return rest;
    return rest.filter((s) =>
      (s.name || "").toLowerCase().includes(q) ||
      (s.handle || "").toLowerCase().includes(q) ||
      (s.reason || "").toLowerCase().includes(q) ||
      (s.tags || []).some((t) => t.toLowerCase().includes(q)),
    );
  }, [base, query, pinnedIds]);

  return (
    <div className="gallery">
      <div className="gallery-bar">
        <div className="seg" role="tablist" aria-label="Filter sites">
          {SHELVES.map(([id, label]) => (
            <button
              key={id} type="button" role="tab" aria-selected={shelf === id}
              className={"seg-btn" + (shelf === id ? " on" : "")}
              onClick={() => setShelf(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="search">
          <SearchIcon />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search sites" aria-label="Search sites" />
        </div>
      </div>

      <section className="gallery-featured" aria-label="Your pinned sites">
        <div className="gallery-feat-label">
          <PinIcon filled /> <span>Pinned to your profile</span>
        </div>
        {pinned.length ? (
          <div className="feat-grid">
            {pinned.map((site) => (
              <article className="feat" key={site.id}>
                <a className="tile-thumb" href={site.url || profileHref(site)} target={site.url ? "_blank" : undefined} rel="noopener" aria-label={`Open ${site.name}`}>
                  <SiteThumbnail site={site} />
                </a>
                <button type="button" className="tile-pin on" onClick={() => togglePinSite(site)} aria-label={`Unpin ${site.name}`} title="Unpin">
                  <PinIcon filled />
                </button>
                <div className="feat-foot">
                  <a className="tile-author" href={profileHref(site)}><Avatar of={site} /><span className="tile-name">{site.name}</span></a>
                  {site.notes?.length ? <span className="feat-note">{site.notes[0].body}</span> : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Hint>Hover any site below and tap the pin to feature it here and on your public profile (up to three).</Hint>
        )}
      </section>

      <section className="gallery-wall" aria-label="Sites">
        {wall.length ? (
          <div className="wall-grid">
            {wall.map((site) => (
              <SiteTile
                key={site.id} site={site}
                pinned={pinnedIds.has(site.id)}
                canPin={site.id !== viewer.id}
                onPin={togglePinSite}
              />
            ))}
          </div>
        ) : (
          <Hint>No sites match. Try a different search or filter.</Hint>
        )}
      </section>
    </div>
  );
}
