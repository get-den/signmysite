import { useState } from "react";
import { SignIn } from "../../components/SignIn";
import { Button } from "../../ui";
import { DemoLink } from "./shared";

/**
 * Variant 3 — the letter. No interface at all, just a short argument addressed to
 * someone who keeps a personal site. The one button reveals sign-in in place.
 */
export function V3() {
  const [joining, setJoining] = useState(false);
  return (
    <div className="lv lv-left lv-letter">
      <p className="lv-letter-open">You have a website. The people you admire have websites.</p>
      <p>And none of them can see each other. Every personal site is its own island, with a view counter for company.</p>
      <p>signmysite is one small line of HTML. It puts a guestbook in the corner of your site. Readers sign it, you see exactly who came by, and their own sites are one click away.</p>
      <p>Site by site, the personal web becomes a neighborhood again.</p>
      {joining ? (
        <div className="lv-signin slide-down"><SignIn returnTo="/" /></div>
      ) : (
        <div className="lv-cta-row">
          <Button className="primary lg" onClick={() => setJoining(true)}>Get your line</Button>
          <DemoLink />
        </div>
      )}
    </div>
  );
}
