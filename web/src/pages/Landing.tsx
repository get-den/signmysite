import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { authUrl, validateSite, JOIN_SITE_KEY } from "../lib";
import { ProfileMock } from "../components/ProfileMock";
import { Footer } from "../components/Footer";

// The site, scheme-less and slash-trimmed — the shape the onboarding field shows.
const bare = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");

/**
 * The signed-out home: a left-aligned hero with a claim box. Paste your site and
 * Join, and we carry it across sign-in so onboarding opens with your username
 * already guessed from the domain. No site yet? Join still works — empty just
 * funnels to sign-in like before. Sign-in itself lives on /auth.
 *
 * What you type is stored as you go, so backing out of sign-in (or a reload) drops
 * you right back here with the site still in the box.
 */
export function Landing() {
  const navigate = useNavigate();
  const [site, setSite] = useState<string>(() => {
    try { return localStorage.getItem(JOIN_SITE_KEY) || ""; } catch { return ""; }
  });
  const check = validateSite(site);
  const touched = site.trim().length > 0;

  // Persist as they type: a valid address is stored bare; clearing the box clears
  // it. A half-typed address is left alone so we never stash junk.
  useEffect(() => {
    try {
      if (check.ok) localStorage.setItem(JOIN_SITE_KEY, bare(check.url!));
      else if (!touched) localStorage.removeItem(JOIN_SITE_KEY);
    } catch { /* ignore */ }
  }, [site]);

  function join() {
    if (touched && !check.ok) return; // let the inline error stand; don't proceed
    navigate(authUrl().slice(1)); // "#/auth?return=…" → router path
  }

  return (
    <>
    <div className="land">
      <div className="land-hero">
        <h1>Your corner of the internet</h1>
        <p>One link for everything you make, and everyone who follows it. Your sites, your notes, and your people, tied into a single profile that's yours.</p>
        <div className="land-claim-wrap">
          <form className="land-claim" onSubmit={(e) => { e.preventDefault(); join(); }}>
            <div className={"land-claim-field" + (touched && !check.ok ? " bad" : "")}>
              <input
                value={site}
                onChange={(e) => setSite(e.target.value)}
                placeholder="yoursite.com"
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                aria-label="Your website"
              />
            </div>
            <button type="submit" className="btn pink lg" disabled={touched && !check.ok}>Join</button>
          </form>
          {touched && check.error && <p className="land-claim-hint bad">{check.error}</p>}
        </div>
      </div>
      <div className="land-art">
        <ProfileMock />
      </div>
    </div>
    <Footer />
    </>
  );
}
