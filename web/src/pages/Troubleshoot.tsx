import type { ReactNode } from "react";
import { Link } from "react-router-dom";

// The examples below name THIS origin so the help text always matches the live
// domain. The app is same-origin, so there's no hardcoded host to update if it
// moves — location is the client-side mirror of the server's BASE_URL.
const ORIGIN = location.origin; // e.g. https://signmysite.com
const HOST = location.host; // e.g. signmysite.com

/**
 * Plain, scannable fixes for the widget — the page the widget's "Not working?"
 * link points at. Ordered by how often each thing actually trips people up
 * during install + signup.
 */
const ITEMS: Array<{ q: string; a: ReactNode }> = [
  {
    q: "The widget isn't showing up",
    a: (
      <>
        <b>Hard-refresh the page</b> first: ⌘⇧R on Mac, Ctrl-Shift-R on Windows. A cached
        older script is the most common cause. Then check the tag is exactly{" "}
        <code>{`<script src="${ORIGIN}/w/you.js"></script>`}</code> and
        sits just before the closing <code>&lt;/body&gt;</code> tag. Open your browser console
        (F12). An ad-blocker or strict content-security-policy can block third-party scripts.
      </>
    ),
  },
  {
    q: "It says “Couldn't load signmysite”",
    a: (
      <>
        The widget couldn't reach the API. Confirm you're online and that{" "}
        <code>{HOST}</code> loads in a tab. If you're running a local copy, make sure
        the server is up and the script's domain matches it.
      </>
    ),
  },
  {
    q: "I signed in, but it still asks me to create an account",
    a: (
      <>
        Give it a second. The card refreshes itself after the sign-in popup closes. If it
        doesn't, <b>hard-refresh</b>. The widget recognizes you by a token it stores when you
        sign in <em>through it</em> (a normal signmysite.com login cookie can't be read from another
        site), so make sure you completed the popup on this same site. Still stuck? Use{" "}
        <b>Log out</b> in the widget and sign in again.
      </>
    ),
  },
  {
    q: "I'm signed up, how do I finish?",
    a: (
      <>
        After signing up, the widget shows your <b>permanent tag</b>:{" "}
        <code>{`<script src="${ORIGIN}/w/YOUR_ID.js"></script>`}</code>.
        Copy it and replace the <code>/w/you.js</code> line on your site. The generic line keeps
        showing the “create your account” card to visitors. Your permanent tag is what makes the
        widget <em>yours</em>.
      </>
    ),
  },
  {
    q: "Leaving a note or reaction opens a new tab",
    a: (
      <>
        That's expected when the widget doesn't yet know you're signed in (e.g. a first visit, or
        a session that ended). It opens a tab on signmysite.com to authenticate, then posts as you. Once
        you've signed in through the widget on a site, it posts inline with no tab.
      </>
    ),
  },
  {
    q: "I'm developing locally",
    a: (
      <>
        Everything works on <code>localhost</code>: sign up straight from the widget. Notes and
        your profile URL won't be pinned to a <code>localhost</code> address; once you deploy,
        set your real site URL in <Link to="/edit">Edit profile</Link> (or just reload the widget
        on the live site).
      </>
    ),
  },
];

export function Troubleshoot() {
  return (
    <div className="narrow">
      <h2 className="section">Troubleshooting</h2>
      <p className="lead">
        Quick fixes for the signmysite widget. Most issues are solved by a hard refresh.
      </p>

      {ITEMS.map((it) => (
        <div className="section help-item" key={it.q}>
          <h3>{it.q}</h3>
          <p>{it.a}</p>
        </div>
      ))}

      <p className="lead">
        Still stuck? <a href="/skill.md">Read the agent guide</a> or open an issue on the
        project repo. Include your browser, the exact script tag, and any console errors.
      </p>
    </div>
  );
}
