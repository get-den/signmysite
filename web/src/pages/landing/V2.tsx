import { CopyCta } from "./shared";

/**
 * Variant 2 — show, don't tell. The page IS the product: a live, clickable demo of
 * a real site wearing the widget, in a browser frame. One line of copy above, one
 * CTA below.
 */
export function V2() {
  return (
    <div className="lv lv-wide">
      <h1>A tiny widget that shows who's reading</h1>
      <p className="lv-sub">
        This is a live demo of someone's site. The badge in the corner is the whole
        widget, added with one line of HTML. Click it.
      </p>
      <div className="lv-browser">
        <div className="lv-browser-bar">
          <i /><i /><i />
          <span className="lv-browser-url">molly.example</span>
          <span className="lv-live">live demo</span>
        </div>
        <iframe className="lv-browser-frame" src="/widget/demo.html" title="Live demo of the signmysite widget" />
      </div>
      <CopyCta />
    </div>
  );
}
