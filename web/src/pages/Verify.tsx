import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { scrapeSite } from "../api";
import { useToast, useViewer } from "../providers";
import { Button, IconButton } from "../ui";
import { validateSite } from "../lib";
import { EmbedSetup } from "../components/EmbedSetup";

/**
 * "Add signmysite to your site" — the single most important page: where a new member
 * turns their account into a live widget. It folds together what used to be two pages
 * (/verify and /embed): pick how it looks, copy it in (prompt-first), then verify.
 *
 * The whole install lives in the shared <EmbedSetup>, so this page and the onboarding
 * final step are identical. The only thing this page adds is the chrome (close + hero),
 * a one-time "what's your site?" capture when we don't have it yet, and a calm
 * "verified" banner once it's proven. Reached from the dashboard nudge and from "Add to
 * my site" — which can arrive before a site is linked, hence the capture.
 */
export function Verify() {
  const { viewer, setViewer } = useViewer();
  const toast = useToast();
  const navigate = useNavigate();

  // Pre-fill the site when arriving from an unclaimed profile's "Claim this site" link
  // (/verify?site=their-domain), so the real owner doesn't retype what they just saw.
  const [siteUrl, setSiteUrl] = useState(() => new URLSearchParams(window.location.search).get("site") ?? "");
  const [linking, setLinking] = useState(false);
  const siteCheck = validateSite(siteUrl);
  if (!viewer) return null; // wrapped in <Protected>

  async function linkSite() {
    if (!siteCheck.ok || linking || !viewer) return;
    setLinking(true);
    try {
      await scrapeSite(siteCheck.url!); // saves the url (+ a preview) server-side
      setViewer({ ...viewer, url: siteCheck.url! });
    } catch {
      toast("Couldn't reach that site. Check the address.");
    } finally {
      setLinking(false);
    }
  }

  return (
    <div className="es-page">
      <div className="sheet-bar"><IconButton icon="close" to="/" /></div>

      <header className="es-hero">
        <h1>Add signmysite to your site</h1>
      </header>

      {!viewer.url ? (
        // No site on file yet: capture it first (we point the widget at it + verify it).
        <section className="es-site">
          <label htmlFor="es-site-url">First, what's your site?</label>
          <div className={"verify-site" + (siteUrl.trim() && !siteCheck.ok ? " bad" : "")}>
            <input
              id="es-site-url"
              value={siteUrl}
              onChange={(e) => setSiteUrl(e.target.value)}
              placeholder="yoursite.com"
              inputMode="url"
              autoFocus
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              aria-label="Your website"
              onKeyDown={(e) => { if (e.key === "Enter" && siteCheck.ok) linkSite(); }}
            />
          </div>
          {siteUrl.trim() && siteCheck.error && <p className="formerr">{siteCheck.error}</p>}
          <Button className="pink lg" loading={linking} disabled={!siteCheck.ok} onClick={linkSite}>Continue</Button>
        </section>
      ) : (
        <>
          {viewer.verified && (
            <div className="es-done">
              <span className="es-done-mark" aria-hidden="true">✓</span>
              <span>Your site is verified. You're all set.</span>
            </div>
          )}
          <EmbedSetup viewer={viewer} onVerified={() => navigate("/")} />
        </>
      )}
    </div>
  );
}
