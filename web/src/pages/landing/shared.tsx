/*
 * Shared bits for the landing experiment (see index.tsx): the one-line install tag,
 * the roster of real personal sites the public demo already uses (so mocks read as
 * the genuine web), and the small CTA atoms every variant composes. When a winning
 * variant is chosen, fold what it uses into Landing and delete the rest.
 */
import type { CSSProperties } from "react";
import { authUrl } from "../../lib";

/** The one-line install, with a literal "you" until there's an account behind it. */
export const SCRIPT_TAG = `<script src="${location.origin}/w/you.js"></script>`;

/** The tag as display: same text, with the placeholder id highlighted. */
export function ScriptTag() {
  return (
    <code className="lv-tag" aria-label={SCRIPT_TAG}>
      {'<script src="' + location.origin + "/w/"}
      <b>you</b>
      {'.js"></script>'}
    </code>
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

/** An overlapping facepile of the roster. */
export function Faces({ n = 4, size = 26, from = 0 }: { n?: number; size?: number; from?: number }) {
  return (
    <span className="lv-faces" style={{ "--lv-face": `${size}px` } as CSSProperties}>
      {PEOPLE.slice(from, from + n).map((p) => (
        <img key={p.handle} className="lv-face" src={p.avatar} alt="" title={p.name} loading="lazy" />
      ))}
    </span>
  );
}

/** The quiet secondary action every variant offers: see the thing alive first. */
export function DemoLink({ label = "See a live demo" }: { label?: string }) {
  return (
    <a className="lv-demolink" href="/widget/demo.html" target="_blank" rel="noopener">
      {label}
    </a>
  );
}

/** The primary CTA: into sign-up (then onboarding asks for the site). */
export function JoinLink({ children, onClick }: { children: string; onClick?: () => void }) {
  return (
    <a className="btn pink lg" href={authUrl("/")} onClick={onClick}>
      {children}
    </a>
  );
}

/** The widget badge as readers meet it on a site: faces + an invitation. */
export function WidgetPill({ label = "Sign my site" }: { label?: string }) {
  return (
    <span className="lv-wpill" aria-hidden="true">
      <Faces n={3} size={22} from={1} />
      {label}
    </span>
  );
}
