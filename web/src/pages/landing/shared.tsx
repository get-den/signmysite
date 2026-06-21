/*
 * Shared bits for the landing experiment (see index.tsx). The CTA is held
 * constant across both arms on purpose: the test isolates the hero (the live
 * demo vs. the network map), not the call to action. PEOPLE is the same roster
 * of real personal sites the public demo uses, so the map reads as the genuine
 * web. When a winner is chosen, fold what it uses into one Landing file and
 * delete the rest.
 */
import { useState } from "react";
import { authUrl } from "../../lib";
import { Button, CheckIcon, CopyIcon, useCopy } from "../../ui";
import { trackClick } from "./ab";

// The ready-to-paste prompt for the visitor's coding agent. skill.md walks the
// agent through everything, including the account-free bootstrap tag, so this
// works before the visitor has an account at all.
export const AGENT_PROMPT =
  `Add signmysite to my website. It's one script line, pasted before </body>, ` +
  `that shows who's reading my site. Follow ${location.origin}/skill.md, then deploy.`;

/**
 * The shared CTA: a pulsing "Copy prompt" beside a quiet Sign in, with the
 * explainer hint appearing click-stably below. Nothing moves on click — both
 * button labels stack in one grid cell (the .btn.following trick) so the wider
 * sizes it, and the hint is always in flow, hidden until copied. Both buttons
 * report to the experiment (see ab.ts); no-ops while browsing via ?v=.
 */
export function PromptCta() {
  const { copied, copy } = useCopy(AGENT_PROMPT);
  const [hinted, setHinted] = useState(false);
  return (
    <div className="lv-cta-col">
      <div className="lv-cta-row">
        <Button
          className={"pink lg copy-prompt" + (copied ? " is-copied" : "")}
          title={AGENT_PROMPT}
          onClick={() => { copy(); setHinted(true); trackClick("copy"); }}
        >
          <span className="lv-swap" data-hidden={copied || undefined}><CopyIcon /> Copy prompt</span>
          <span className="lv-swap" data-hidden={copied ? undefined : true}><CheckIcon /> Copied</span>
        </Button>
        <a className="btn lg" href={authUrl("/")} onClick={() => trackClick("signin")}>Sign in</a>
      </div>
      <p className={"lv-cta-hint lv-fine" + (hinted ? " on" : "")}>
        Now paste it into Claude, Cursor, or any coding agent. It installs the widget for you.
      </p>
    </div>
  );
}

const favicon = (d: string) => `https://www.google.com/s2/favicons?domain=${d}&sz=64`;

export type Person = { name: string; handle: string; avatar: string; site: string };

/** Real personal sites — the same roster as the public demo (server/demo.ts). */
export const PEOPLE: Person[] = [
  { name: "Paul Graham", handle: "pg", avatar: "https://upload.wikimedia.org/wikipedia/commons/e/e3/Paulgraham_240x320.jpg", site: "paulgraham.com" },
  { name: "Maggie Appleton", handle: "maggie", avatar: favicon("maggieappleton.com"), site: "maggieappleton.com" },
  { name: "Josh W. Comeau", handle: "josh", avatar: favicon("joshwcomeau.com"), site: "joshwcomeau.com" },
  { name: "Lynn Fisher", handle: "lynn", avatar: favicon("lynnandtonic.com"), site: "lynnandtonic.com" },
  { name: "Dan Abramov", handle: "dan", avatar: favicon("overreacted.io"), site: "overreacted.io" },
  { name: "Cassidy Williams", handle: "cassidy", avatar: favicon("cassidoo.co"), site: "cassidoo.co" },
  { name: "swyx", handle: "swyx", avatar: favicon("swyx.io"), site: "swyx.io" },
  { name: "Lee Robinson", handle: "leerob", avatar: favicon("leerob.com"), site: "leerob.com" },
];
