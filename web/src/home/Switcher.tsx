/*
 * The layout switcher — a small, honest control for trying on the four homes.
 * It's a design instrument as much as a feature: flip between Brief / Stream /
 * Orbit / Gallery, or hit "Surprise me" to be handed a different one. The blurb
 * underneath names each layout's job, so the choice is about what you want the
 * home to do, not just how it looks.
 */
import type { LayoutId, LayoutMeta } from "./index";

export function Switcher({
  layouts, value, blurb, onChange, onShuffle,
}: {
  layouts: LayoutMeta[];
  value: LayoutId;
  blurb: string;
  onChange: (id: LayoutId) => void;
  onShuffle: () => void;
}) {
  return (
    <div className="home-switch">
      <div className="home-switch-row">
        <div className="seg home-seg" role="tablist" aria-label="Home layout">
          {layouts.map((l) => (
            <button
              key={l.id}
              type="button"
              role="tab"
              aria-selected={value === l.id}
              className={"seg-btn" + (value === l.id ? " on" : "")}
              onClick={() => onChange(l.id)}
            >
              {l.label}
            </button>
          ))}
        </div>
        <button type="button" className="home-shuffle" onClick={onShuffle} aria-label="Show me a different layout">
          <ShuffleIcon /> Surprise me
        </button>
      </div>
      <p className="home-blurb">{blurb}</p>
    </div>
  );
}

function ShuffleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 4h3v3" /><path d="M2 6h2.4c.9 0 1.7.4 2.3 1l9 9c.6.6 1.4 1 2.3 1H21" /><path d="M18 20h3v-3" /><path d="M2 18h2.4c.9 0 1.7-.4 2.3-1l3-3" /><path d="m14 8 1-1c.6-.6 1.4-1 2.3-1H21" />
    </svg>
  );
}
