import { DemoLink, JoinLink, PEOPLE } from "./shared";

/**
 * Variant 7 — the map. The network itself is the hero: real personal sites as
 * dots, hairlines between them, and one open spot in the middle for yours.
 */

// Hand-placed node positions (percent of the map box), PEOPLE order:
// pg, maggie, josh, lynn, dan, cassidy, swyx, leerob.
const POS: Array<[number, number]> = [
  [14, 24], [31, 78], [34, 14], [67, 12], [87, 32], [80, 78], [60, 90], [9, 64],
];
const YOU: [number, number] = [50, 50];

// Edges by node index (8 = you): a web, not a star.
const EDGES: Array<[number, number]> = [
  [8, 0], [8, 1], [8, 3], [8, 4], [8, 5], [8, 7],
  [0, 2], [2, 3], [4, 5], [5, 6], [6, 1], [7, 1], [0, 7],
];

export function V7() {
  const pts = [...POS, YOU];
  return (
    <div className="lv lv-wide">
      <h1>The personal web, connected</h1>
      <p className="lv-sub">
        Every dot is someone's site. One line of HTML adds yours, shows you who
        visits, and links you into the rest.
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
      <div className="lv-cta-row">
        <JoinLink>Claim your spot</JoinLink>
        <DemoLink />
      </div>
    </div>
  );
}
