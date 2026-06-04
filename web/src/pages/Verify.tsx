import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { scrapeSite, verifySite } from "../api";
import { useToast, useViewer } from "../providers";
import { Button, Spinner, WidgetInstall } from "../ui";
import { validateSite, PLACEHOLDER_THUMB } from "../lib";

/** Site builders we have paste-here instructions for. "Custom / HTML" leads and is
 *  the default; the rest cover the common no-code builders. Each is just a label +
 *  where the one line goes — adding one is a new entry, never a migration. */
type Platform = { id: string; name: string; steps: string[] };
const PLATFORMS: Platform[] = [
  { id: "custom", name: "Custom / HTML", steps: ["Open your page's HTML.", "Paste the line just before the closing </body> tag.", "Save and publish."] },
  { id: "webflow", name: "Webflow", steps: ["Open Project Settings, then Custom Code.", "Paste the line into Footer Code.", "Save, then publish your site."] },
  { id: "framer", name: "Framer", steps: ["Open Project Settings, then General.", "Under Custom Code, paste into End of <body>.", "Publish."] },
  { id: "squarespace", name: "Squarespace", steps: ["Go to Settings, Advanced, Code Injection.", "Paste the line into the Footer box.", "Save."] },
  { id: "wix", name: "Wix", steps: ["Open Settings, then Custom Code.", "Add the line to Body - end, on all pages.", "Apply."] },
  { id: "wordpress", name: "WordPress", steps: ["Use a headers and footers plugin, or your theme footer.", "Paste the line before </body>.", "Update."] },
  { id: "carrd", name: "Carrd", steps: ["Add an Embed element where you like.", "Set its type to Code and paste the line.", "Publish."] },
  { id: "ghost", name: "Ghost", steps: ["Open Settings, then Code injection.", "Paste the line into Site Footer.", "Save."] },
  { id: "shopify", name: "Shopify", steps: ["Online Store, Themes, Edit code, theme.liquid.", "Paste the line before </body>.", "Save."] },
];

/**
 * "Add the widget" page. Pick your platform, follow the paste-here steps, then we
 * check your live site. Reached from the dashboard nudge and from "Add to my site"
 * after someone reacts on a friend's widget — which can arrive before they've
 * linked a site at all, so we capture the address first when it's missing.
 */
export function Verify() {
  const { viewer, setViewer } = useViewer();
  const toast = useToast();
  const navigate = useNavigate();

  // Step 0, only when they have no site yet: ask for it, scrape + save it server-side.
  const [siteUrl, setSiteUrl] = useState("");
  const [linking, setLinking] = useState(false);
  const siteCheck = validateSite(siteUrl);

  const [platform, setPlatform] = useState("custom");
  const [checking, setChecking] = useState(false);
  const [missed, setMissed] = useState(false);
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

  const check = async () => {
    if (checking) return;
    setChecking(true); setMissed(false);
    try {
      const r = await verifySite();
      if (r.verified) {
        setViewer({ ...viewer, verified: true });
        toast("Verified ✓");
        navigate("/");
      } else {
        setMissed(true);
      }
    } catch {
      setMissed(true);
    } finally {
      setChecking(false);
    }
  };

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

  const current = PLATFORMS.find((p) => p.id === platform) ?? PLATFORMS[0];

  return (
    <div className="verify-setup">
      <h1>Add signmysite to your site</h1>

      <section className="vstep">
        <div className="vstep-head"><span className="vstep-num">1</span><h2>Select your platform</h2></div>
        <div className="platform-grid">
          {PLATFORMS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={"platform" + (p.id === platform ? " on" : "")}
              aria-pressed={p.id === platform}
              onClick={() => { setPlatform(p.id); setMissed(false); }}
            >
              {p.name}
            </button>
          ))}
        </div>
      </section>

      <section className="vstep">
        <div className="vstep-head"><span className="vstep-num">2</span><h2>Add the widget</h2></div>
        <div className="vguide">
          <div className="vguide-main">
            <WidgetInstall viewer={viewer} label="Your one-line widget" />
            <ol className="vsteps">
              {current.steps.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
            <div className="vcheck">
              {checking ? (
                <span className="vcheck-status"><Spinner /> Checking your site…</span>
              ) : (
                <>
                  <Button className="pink" onClick={check}>{missed ? "Check again" : "I've added it"}</Button>
                  {missed && <span className="vcheck-miss">Not live yet. Publish, then check again.</span>}
                </>
              )}
            </div>
          </div>
          <div className="vguide-shot">
            <img className="site-thumb" src={PLACEHOLDER_THUMB} alt="" />
          </div>
        </div>
      </section>
    </div>
  );
}
