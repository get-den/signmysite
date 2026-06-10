import { PLACEHOLDER_THUMB } from "../../lib";
import { DemoLink, JoinLink, WidgetPill } from "./shared";

/**
 * Variant 6 — before and after. The same site twice: bare, then wearing the
 * widget. The contrast carries the pitch; the copy only names the problem.
 */
export function V6() {
  return (
    <div className="lv">
      <h1>Your readers are invisible</h1>
      <p className="lv-sub">
        People visit your site every day and leave no trace. signmysite is a tiny
        widget that makes them visible, right where they were.
      </p>
      <div className="lv-ba" aria-hidden="true">
        <figure className="lv-ba-card is-before">
          <span className="lv-ba-shot">
            <img src={PLACEHOLDER_THUMB} alt="" />
          </span>
          <figcaption>Your site today</figcaption>
        </figure>
        <span className="lv-ba-arrow">→</span>
        <figure className="lv-ba-card">
          <span className="lv-ba-shot">
            <img src={PLACEHOLDER_THUMB} alt="" />
            <span className="lv-ba-note lv-bubble">found you through maggie. staying.</span>
            <WidgetPill />
          </span>
          <figcaption>With one line of HTML</figcaption>
        </figure>
      </div>
      <div className="lv-cta-row">
        <JoinLink>Make mine visible</JoinLink>
        <DemoLink />
      </div>
    </div>
  );
}
