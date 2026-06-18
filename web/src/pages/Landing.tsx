import { useState } from "react";
import { authUrl } from "../lib";
import { Button, CheckIcon, CopyIcon, useCopy } from "../ui";

/**
 * The signed-out home: the product, live. A real site wearing the widget in a
 * browser frame (the public demo, click-safe), one line of copy above, and the
 * fastest install below: copy a short prompt and hand it to your coding agent.
 * Chosen from a ten-variant test of this page; the others live in git history
 * (web/src/pages/landing/, removed when this one won).
 */

// The ready-to-paste prompt for the visitor's coding agent. skill.md walks the
// agent through everything, including the account-free bootstrap tag, so this
// works before the visitor has an account at all.
const AGENT_PROMPT =
  `Add signmysite to my website. It's one script line, pasted before </body>, ` +
  `that shows who's reading my site. Follow ${location.origin}/skill.md, then deploy.`;

export function Landing() {
  const { copied, copy } = useCopy(AGENT_PROMPT);
  const [hinted, setHinted] = useState(false);
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
      {/* Nothing moves on click: both button labels stack in one grid cell (the
          .btn.following trick) so the wider sizes it, and the hint is always in
          flow — hidden, not absent. */}
      <div className="lv-cta-col">
        <div className="lv-cta-row">
          <Button
            className={"pink lg copy-prompt" + (copied ? " is-copied" : "")}
            title={AGENT_PROMPT}
            onClick={() => { copy(); setHinted(true); }}
          >
            <span className="lv-swap" data-hidden={copied || undefined}><CopyIcon /> Copy prompt</span>
            <span className="lv-swap" data-hidden={copied ? undefined : true}><CheckIcon /> Copied</span>
          </Button>
          <a className="btn lg" href={authUrl("/")}>Sign in</a>
        </div>
        <p className={"lv-cta-hint lv-fine" + (hinted ? " on" : "")}>
          Now paste it into Claude, Cursor, or any coding agent. It installs the widget for you.
        </p>
      </div>
    </div>
  );
}
