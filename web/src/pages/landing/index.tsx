/*
 * The signed-out landing, currently an A/B test: a plain visitor is randomly,
 * stickily assigned one of the ARMS (see ab.ts) and their view time + CTA clicks
 * are recorded anonymously — results on /admin. Opening signmysite.com/?v=3 (or
 * the hash form #/?v=3) instead forces variant 3 and shows a small switcher
 * (click a number, or use the arrow keys) for flipping through all eleven takes;
 * forced views record nothing. Once a winner is picked: promote it to the
 * default here, delete the losers, the switcher, and ab.ts.
 */
import { useEffect, useState, type ReactElement } from "react";
import { useSearchParams } from "react-router-dom";
import { assignedArm, beginView } from "./ab";
import { Classic } from "./Classic";
import { V1 } from "./V1";
import { V2 } from "./V2";
import { V3 } from "./V3";
import { V4 } from "./V4";
import { V5 } from "./V5";
import { V6 } from "./V6";
import { V7 } from "./V7";
import { V8 } from "./V8";
import { V9 } from "./V9";
import { V10 } from "./V10";

const VARIANTS: Array<{ name: string; El: () => ReactElement }> = [
  { name: "Classic (today's page)", El: Classic },
  { name: "The line", El: V1 },
  { name: "Live demo", El: V2 },
  { name: "The letter", El: V3 },
  { name: "Three steps", El: V4 },
  { name: "Guestbook", El: V5 },
  { name: "Before and after", El: V6 },
  { name: "The map", El: V7 },
  { name: "Plain answers", El: V8 },
  { name: "On your site", El: V9 },
  { name: "Fact sheet", El: V10 },
];

export function Landing() {
  const [params, setParams] = useSearchParams();
  // Accept ?v= in either position — signmysite.com/?v=3 (the natural thing to
  // type) or the hash-router form signmysite.com/#/?v=3 the switcher writes.
  const raw = params.get("v") ?? new URLSearchParams(location.search).get("v");
  const n = raw === null ? NaN : Math.floor(Number(raw));
  const forced = Number.isFinite(n) && n >= 0 && n < VARIANTS.length ? n : null;
  const browsing = raw !== null; // the switcher exists only for whoever typed ?v=
  const [arm] = useState(assignedArm); // the sticky random assignment
  const active = forced ?? arm;

  // The experiment: record exposure, visible time, and (via trackClick) the CTA
  // clicks — but only for genuine assigned views, never while browsing with ?v=.
  useEffect(() => {
    if (!browsing) return beginView(active);
  }, [browsing, active]);

  const pick = (i: number) => setParams({ v: String(i) }, { replace: true });

  useEffect(() => {
    if (!browsing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /^(input|textarea)$/i.test(e.target.tagName)) return;
      if (e.key === "ArrowRight") pick((active + 1) % VARIANTS.length);
      if (e.key === "ArrowLeft") pick((active + VARIANTS.length - 1) % VARIANTS.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const { El } = VARIANTS[active];
  return (
    <>
      <El />
      {browsing && (
        <nav className="lv-switch" aria-label="Landing variants">
          {VARIANTS.map((x, i) => (
            <button
              key={i}
              className={i === active ? "on" : ""}
              title={x.name}
              onClick={() => pick(i)}
            >
              {i}
            </button>
          ))}
          <span className="lv-switch-name">{VARIANTS[active].name}</span>
        </nav>
      )}
    </>
  );
}
