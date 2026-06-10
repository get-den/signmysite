/*
 * The signed-out landing, currently running a pick-one experiment: ten alternate
 * takes living beside today's page. Plain visitors always get the classic landing.
 * Opening signmysite.com/#/?v=3 shows variant 3 plus a small switcher (click a
 * number, or use the arrow keys) for flipping through all of them. Once a winner
 * is picked: promote it to the default here, delete the losers and the switcher.
 */
import { useEffect, type ReactElement } from "react";
import { useSearchParams } from "react-router-dom";
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
  const active = Number.isFinite(n) && n >= 0 && n < VARIANTS.length ? n : 0;
  const browsing = raw !== null; // the switcher exists only for whoever typed ?v=

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
