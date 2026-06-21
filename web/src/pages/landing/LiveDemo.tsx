import { PromptCta } from "./shared";

/**
 * Variant 2 — the live demo. The page IS the product: a real site wearing the
 * widget in a clickable browser frame (the public demo), one line of copy above,
 * the shared CTA below. This is today's shipped landing; the experiment pits it
 * against The map (variant 7).
 */
export function LiveDemo() {
  return (
    <div className="lv lv-wide">
      <h1>A tiny widget that shows who's reading</h1>
      <div className="lv-browser">
        <div className="lv-browser-bar">
          <i /><i /><i />
          <span className="lv-browser-url">molly.example</span>
          <span className="lv-live">live demo</span>
        </div>
        <iframe className="lv-browser-frame" src="/widget/demo.html" title="Live demo of the signmysite widget" />
      </div>
      <PromptCta />
    </div>
  );
}
