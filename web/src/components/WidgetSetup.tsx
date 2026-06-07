import { useEffect, useRef, useState } from "react";
import { verifySite } from "../api";
import type { Member } from "../api";
import { useViewer } from "../providers";
import { Button, VerifyButton, WidgetInstall, useCopy } from "../ui";
import { PLACEHOLDER_THUMB } from "../lib";

/** Site builders we have paste-here instructions for. "Custom / HTML" leads and is
 *  the no-builder default; the rest cover the common no-code builders. `domain` drives
 *  the logo (its favicon); a platform is just a label + where the one line goes, so
 *  adding one is a new entry, never a migration. Steps stay terse on purpose — they
 *  slide down only once you pick your platform. */
type Platform = { id: string; name: string; domain?: string; steps: string[] };
const PLATFORMS: Platform[] = [
  { id: "custom", name: "Custom / HTML", steps: ["Open your page's HTML.", "Paste the line before </body>.", "Publish."] },
  { id: "webflow", name: "Webflow", domain: "webflow.com", steps: ["Project Settings → Custom Code.", "Paste into Footer Code.", "Save, then publish."] },
  { id: "framer", name: "Framer", domain: "framer.com", steps: ["Project Settings → General.", "Custom Code → End of <body>.", "Publish."] },
  { id: "squarespace", name: "Squarespace", domain: "squarespace.com", steps: ["Settings → Advanced → Code Injection.", "Paste into Footer.", "Save."] },
  { id: "wix", name: "Wix", domain: "wix.com", steps: ["Settings → Custom Code.", "Add to Body (end), all pages.", "Apply."] },
  { id: "wordpress", name: "WordPress", domain: "wordpress.org", steps: ["Open your theme footer or a headers plugin.", "Paste before </body>.", "Update."] },
  { id: "carrd", name: "Carrd", domain: "carrd.co", steps: ["Add an Embed element.", "Set its type to Code, paste.", "Publish."] },
  { id: "ghost", name: "Ghost", domain: "ghost.org", steps: ["Settings → Code injection.", "Paste into Site Footer.", "Save."] },
  { id: "shopify", name: "Shopify", domain: "shopify.com", steps: ["Edit code → theme.liquid.", "Paste before </body>.", "Save."] },
];

/** A platform's logo: its favicon, or a code glyph for the no-builder "Custom" case. */
function PlatformLogo({ domain }: { domain?: string }) {
  if (!domain) {
    return (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m9 8-4 4 4 4M15 8l4 4-4 4" />
      </svg>
    );
  }
  return <img src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`} alt="" width="24" height="24" loading="lazy" />;
}

/**
 * The canonical "add your widget" surface: pick your platform, follow the short
 * paste-here steps, then verify the live site. Shared verbatim by the /verify page
 * and the onboarding final step so the two are the exact same layout. Nothing is
 * selected at first — choosing a platform slides its instructions down.
 *
 * Verification flips the viewer to verified in place; `onVerified` lets the caller
 * react (the verify page navigates home; onboarding finishes signup). `onSkip`, when
 * given (onboarding), puts a Skip beside Verify so they can finish without proving it
 * yet. Both are optional — a member can also just leave the widget to auto-verify.
 */
export function WidgetSetup({ viewer, onVerified, onSkip }: { viewer: Member; onVerified?: () => void; onSkip?: () => void | Promise<void> }) {
  const { setViewer } = useViewer();
  const [platform, setPlatform] = useState<string | null>(null);
  const [missed, setMissed] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const current = PLATFORMS.find((p) => p.id === platform) ?? null;

  // The fastest install: a ready-to-paste prompt the member hands to their coding agent.
  const idShort = viewer.id.replace(/^signmysite:/, "");
  const agentPrompt =
    `Add the signmysite widget to my website. Paste this exact line just before the closing </body> tag, then deploy:\n\n` +
    `<script src="${location.origin}/w/${idShort}.js" data-ui="card"></script>\n\n` +
    `It's a single lightweight line that shows who's reading my site. Nothing else needs to change.`;
  const { copied: promptCopied, copy: copyPrompt } = useCopy(agentPrompt);

  // Already done it? Quietly check the live site once when this opens, and skip
  // straight ahead if the widget's already there — no need to make them paste it
  // again. Silent: a not-found here just leaves them on the setup as normal.
  const autoChecked = useRef(false);
  useEffect(() => {
    if (autoChecked.current || viewer.verified || !viewer.url) return;
    autoChecked.current = true;
    verifySite()
      .then((r) => {
        if (r.verified) {
          setViewer({ ...viewer, verified: true });
          onVerified?.();
        }
      })
      .catch(() => {});
  }, [viewer, setViewer, onVerified]);

  const skip = async () => {
    if (skipping || !onSkip) return;
    setSkipping(true);
    try { await onSkip(); } finally { setSkipping(false); }
  };

  return (
    <>
      <div className="agent-cta">
        <div className="agent-cta-head">
          <h2>The fastest way</h2>
          <p>Paste this into Claude, Cursor, or any coding agent and it adds signmysite for you.</p>
        </div>
        <Button className="pink lg" onClick={copyPrompt}>{promptCopied ? "Copied" : "Copy prompt for my agent"}</Button>
      </div>

      <div className="signin-or"><span>or add it yourself</span></div>

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
              <span className="platform-logo"><PlatformLogo domain={p.domain} /></span>
              <span className="platform-name">{p.name}</span>
            </button>
          ))}
        </div>
      </section>

      {current && (
        <section className="vstep slide-down" key={current.id}>
          <div className="vstep-head"><span className="vstep-num">2</span><h2>Add the widget</h2></div>
          <div className="vguide">
            <div className="vguide-main">
              <WidgetInstall viewer={viewer} />
              <ol className="vsteps">
                {current.steps.map((s, i) => <li key={i}>{s}</li>)}
              </ol>
            </div>
            <div className="vguide-shot">
              <img className="site-thumb" src={PLACEHOLDER_THUMB} alt="" />
            </div>
          </div>
        </section>
      )}

      {/* The commit row: Verify leads (black — the page's accent already belongs to
          the two Copy buttons), Skip sits beside it when onboarding. */}
      <div className="vfoot">
        <VerifyButton onVerified={onVerified} onMiss={() => setMissed(true)} />
        {onSkip && (
          <Button className="lg" loading={skipping} onClick={skip}>Skip for now</Button>
        )}
      </div>
      {missed && <p className="vfoot-miss">Not live yet. Publish, then verify again.</p>}
    </>
  );
}
