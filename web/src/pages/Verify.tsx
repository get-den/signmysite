import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { scrapeSite } from "../api";
import { useToast, useViewer } from "../providers";
import { Button } from "../ui";
import { validateSite } from "../lib";
import { WidgetSetup } from "../components/WidgetSetup";

/**
 * "Add the widget" page. The whole install — copy-a-prompt-for-your-agent, the
 * platform picker, the paste-here steps, and the live check — lives in the shared
 * <WidgetSetup>, so this page and the onboarding final step are the exact same
 * layout. Reached from the dashboard nudge and from "Add to my site" after someone
 * reacts on a friend's widget — which can arrive before they've linked a site at
 * all, so we capture the address first when it's missing.
 */
export function Verify() {
  const { viewer, setViewer } = useViewer();
  const toast = useToast();
  const navigate = useNavigate();

  // Step 0, only when they have no site yet: ask for it, scrape + save it server-side.
  const [siteUrl, setSiteUrl] = useState("");
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

  // No site on file yet: capture it first, then this same page shows the steps.
  if (!viewer.url) {
    return (
      <div className="narrow verify-page">
        <h1>Add signmysite to your site</h1>
        <p className="verify-lead">What's your site? We'll point your widget at it, then show you where to paste it.</p>
        <div className={"verify-site" + (siteUrl.trim() && !siteCheck.ok ? " bad" : "")}>
          <input
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
        <Button className="pink lg verify-copy" loading={linking} disabled={!siteCheck.ok} onClick={linkSite}>Continue</Button>
      </div>
    );
  }

  return (
    <div className="verify-setup">
      <h1>Add signmysite to your site</h1>
      <WidgetSetup viewer={viewer} onVerified={() => navigate("/")} />
    </div>
  );
}
