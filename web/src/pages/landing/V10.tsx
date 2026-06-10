import { DemoLink, JoinLink } from "./shared";

/**
 * Variant 10 — the fact sheet. No persuasion, just a product label: six facts a
 * skimmer absorbs in five seconds, then the one button.
 */

const FACTS: Array<[string, string]> = [
  ["What", "A guestbook widget for personal websites"],
  ["Install", "One line of HTML, before </body>"],
  ["Shows", "Who reads your site, with names and faces"],
  ["Gives", "Signatures, notes, follows, a webring"],
  ["Works on", "Any site, any builder"],
  ["Price", "Free"],
];

export function V10() {
  return (
    <div className="lv">
      <div className="lv-spec">
        <div className="lv-spec-head">
          <b>signmysite</b>
          <span>fact sheet</span>
        </div>
        <dl>
          {FACTS.map(([k, v]) => (
            <div key={k} className="lv-spec-row">
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <JoinLink>Get yours</JoinLink>
        <DemoLink />
      </div>
    </div>
  );
}
