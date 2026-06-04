/*
 * Saved — the gallery of every site you've saved, inside the same three-pane frame as
 * the feed (left nav, no right rail). Hover a tile to pin it to your profile (up to 3);
 * the header search narrows the wall by name, handle or host.
 */
import { useEffect, useState } from "react";
import { ApiError, getPinned, getSaved, orEmpty, togglePin, type Site } from "../api";
import { useSearch, useToast, useViewer } from "../providers";
import { EmptyState, Loading, PageHead } from "../ui";
import { FeedLayout } from "../home/FeedLayout";
import { SiteTile } from "../home/parts";

export function Saved() {
  const { viewer } = useViewer();
  const { q } = useSearch();
  const toast = useToast();
  const [sites, setSites] = useState<Site[] | null>(null);
  const [pinned, setPinned] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    orEmpty(getSaved()).then((s) => alive && setSites(s));
    orEmpty(getPinned()).then((p) => alive && setPinned(new Set(p.map((x) => x.id))));
    return () => { alive = false; };
  }, []);

  if (!viewer) return null; // the route is Protected; this is just a type guard

  // Toggle a pin, then re-sync from the server (authoritative order + 3-pin limit).
  const togglePinSite = async (s: Site) => {
    try {
      await togglePin(s.id);
      setPinned(new Set((await getPinned()).map((x) => x.id)));
    } catch (e) {
      toast(e instanceof ApiError && e.status === 409 ? "Pin up to 3 — unpin one first." : "Couldn't update pin.");
    }
  };

  const needle = q.trim().toLowerCase();
  const wall = (sites ?? []).filter((s) =>
    !needle || [s.name, s.handle, s.url].some((v) => (v || "").toLowerCase().includes(needle)));

  return (
    <FeedLayout viewer={viewer}>
      <div className="saved">
        <PageHead title="Saved">
          {sites && sites.length > 0 && (
            <span className="feed-sub">{sites.length} {sites.length === 1 ? "site" : "sites"}</span>
          )}
        </PageHead>

        {sites === null ? (
          <Loading />
        ) : wall.length === 0 ? (
          <EmptyState>{needle ? "No saved sites match that." : "Nothing saved yet."}</EmptyState>
        ) : (
          <div className="wall-grid">
            {wall.map((s) => (
              <SiteTile key={s.id} site={s} canPin={s.id !== viewer.id} pinned={pinned.has(s.id)} onPin={togglePinSite} />
            ))}
          </div>
        )}
      </div>
    </FeedLayout>
  );
}
