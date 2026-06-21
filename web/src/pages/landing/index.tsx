/*
 * The signed-out landing, currently a two-arm A/B test: a plain visitor is
 * randomly, stickily assigned one of the ARMS (see ab.ts) and their view time +
 * CTA clicks are recorded anonymously — results on /admin. Opening
 * signmysite.com/?v=7 (or the hash form #/?v=7) instead forces that variant and
 * shows a small switcher (click a number, or use the arrow keys) for flipping
 * between the takes; forced views record nothing. Once a winner is picked:
 * promote it to a single Landing here, delete the loser, the switcher, and ab.ts.
 */
import { useEffect, useState, type ReactElement } from "react";
import { useSearchParams } from "react-router-dom";
import { assignedArm, beginView } from "./ab";
import { LiveDemo } from "./LiveDemo";
import { TheMap } from "./TheMap";

// id is the variant number recorded by the experiment (mirrors the historical
// numbering, so /admin's LANDING_NAMES stays meaningful): 2 = live demo, 7 = map.
const VARIANTS: Array<{ id: number; name: string; El: () => ReactElement }> = [
  { id: 2, name: "Live demo", El: LiveDemo },
  { id: 7, name: "The map", El: TheMap },
];

export function Landing() {
  const [params, setParams] = useSearchParams();
  // Accept ?v= in either position — signmysite.com/?v=7 (the natural thing to
  // type) or the hash-router form signmysite.com/#/?v=7 the switcher writes.
  const raw = params.get("v") ?? new URLSearchParams(location.search).get("v");
  const forcedId = raw === null ? null : Math.floor(Number(raw));
  const browsing = raw !== null; // the switcher exists only for whoever typed ?v=
  const [arm] = useState(assignedArm); // the sticky random assignment
  const active = VARIANTS.some((x) => x.id === forcedId) ? (forcedId as number) : arm;

  // The experiment: record exposure, visible time, and (via trackClick) the CTA
  // clicks — but only for genuine assigned views, never while browsing with ?v=.
  useEffect(() => {
    if (!browsing) return beginView(active);
  }, [browsing, active]);

  const pick = (id: number) => setParams({ v: String(id) }, { replace: true });

  useEffect(() => {
    if (!browsing) return;
    const ids = VARIANTS.map((x) => x.id);
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /^(input|textarea)$/i.test(e.target.tagName)) return;
      const i = ids.indexOf(active);
      if (e.key === "ArrowRight") pick(ids[(i + 1) % ids.length]);
      if (e.key === "ArrowLeft") pick(ids[(i + ids.length - 1) % ids.length]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const current = VARIANTS.find((x) => x.id === active) ?? VARIANTS[0];
  const { El } = current;
  return (
    <>
      <El />
      {browsing && (
        <nav className="lv-switch" aria-label="Landing variants">
          {VARIANTS.map((x) => (
            <button
              key={x.id}
              className={x.id === active ? "on" : ""}
              title={x.name}
              onClick={() => pick(x.id)}
            >
              {x.id}
            </button>
          ))}
          <span className="lv-switch-name">{current.name}</span>
        </nav>
      )}
    </>
  );
}
