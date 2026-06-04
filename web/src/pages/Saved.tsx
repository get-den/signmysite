/*
 * Saved — the gallery of every site you've saved. A plain wall of previews inside the
 * same three-pane frame as the feed (left nav, no right rail), so it reads as a sibling
 * of Home. The header search narrows the wall by name, handle or host.
 */
import { useEffect, useState } from "react";
import { getSaved, orEmpty, type Site } from "../api";
import { useSearch, useViewer } from "../providers";
import { Loading } from "../ui";
import { FeedLayout } from "../home/FeedLayout";
import { Hint, SiteTile } from "../home/parts";

export function Saved() {
  const { viewer } = useViewer();
  const { q } = useSearch();
  const [sites, setSites] = useState<Site[] | null>(null);

  useEffect(() => {
    let alive = true;
    orEmpty(getSaved()).then((s) => alive && setSites(s));
    return () => { alive = false; };
  }, []);

  if (!viewer) return null; // the route is Protected; this is just a type guard

  const needle = q.trim().toLowerCase();
  const wall = (sites ?? []).filter((s) =>
    !needle ||
    [s.name, s.handle, s.url].some((v) => (v || "").toLowerCase().includes(needle)));

  return (
    <FeedLayout viewer={viewer}>
      <div className="saved">
        <header className="feed-head">
          <h1 className="feed-title">Saved</h1>
          {sites && sites.length > 0 && (
            <span className="feed-sub">{sites.length} {sites.length === 1 ? "site" : "sites"}</span>
          )}
        </header>

        {sites === null ? (
          <Loading />
        ) : wall.length === 0 ? (
          <Hint>
            {needle
              ? "No saved sites match that."
              : "Nothing saved yet. Open any site and hit Save, and it'll collect here."}
          </Hint>
        ) : (
          <div className="wall-grid">
            {wall.map((s) => <SiteTile key={s.id} site={s} />)}
          </div>
        )}
      </div>
    </FeedLayout>
  );
}
