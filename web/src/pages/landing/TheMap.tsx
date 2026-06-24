import { PEOPLE, PromptCta } from "./shared";

/**
 * Variant 7 — the map. The network itself is the hero: real personal sites as
 * nodes on a calm ring, hairline links between them, and one open spot in the
 * middle for yours. Kept deliberately minimal — six sites, a clean hexagonal
 * web, no clutter — so the shape reads in a glance.
 */

// Six roster sites on an even ring (percent of the map box); you sit at center.
const POS: Array<[number, number]> = [
  [22, 28], [50, 16], [78, 28], [78, 72], [50, 84], [22, 72],
];
const YOU: [number, number] = [50, 50];

// The outer ring, plus three alternating spokes to you (node index 6): enough to
// read as an interconnected web, few enough to stay airy.
const EDGES: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0],
  [6, 0], [6, 2], [6, 4],
];

export function TheMap() {
  const pts = [...POS, YOU];
  return (
    <div className="lv lv-wide">
      <h1>The personal web, connected</h1>
      <p className="lv-sub">
        Every dot is someone's site. One line of HTML adds yours.
      </p>
      <div className="lv-map" aria-hidden="true">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none">
          {EDGES.map(([a, b]) => (
            <line
              key={`${a}-${b}`}
              x1={pts[a][0]} y1={pts[a][1]} x2={pts[b][0]} y2={pts[b][1]}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
        {POS.map(([x, y], i) => (
          <img
            key={PEOPLE[i].handle}
            className="lv-map-node"
            style={{ left: `${x}%`, top: `${y}%` }}
            src={PEOPLE[i].avatar}
            alt=""
            title={PEOPLE[i].site}
            loading="lazy"
          />
        ))}
        <span className="lv-map-you" style={{ left: `${YOU[0]}%`, top: `${YOU[1]}%` }}>
          your site
        </span>
      </div>
      <PromptCta />
    </div>
  );
}
