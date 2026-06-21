import { useEffect, useRef, useState, type ReactNode } from "react";
import { verifySite, type Member } from "../api";
import { useViewer } from "../providers";
import { Button, CheckIcon, CopyIcon, VerifyButton, useCopy } from "../ui";

/*
 * The one "add signmysite to your site" surface — shared by the /verify page and the
 * onboarding final step, so they're identical. Three honest steps:
 *   1. Choose how it looks (clean cards — circle, peek, inline, invisible).
 *   2. Add it — "Copy prompt" leads (hand it to an AI agent, zero thinking); the
 *      paste-it-yourself snippet + per-platform steps sit underneath.
 *   3. Check it's live (verify, or skip during onboarding).
 * The chosen variant drives BOTH the prompt and the snippet, so changing the look
 * visibly changes what you copy.
 */

type Ctx = { origin: string; id: string; handle: string };
type Variant = {
  key: string;
  name: string;
  blurb: string;
  preview: ReactNode;
  snippet: (c: Ctx) => string;
  prompt: (c: Ctx) => string;
};

// One template for the badge variants — only the trailing description differs.
const widgetPrompt = (snippet: string, desc: string) =>
  `Add signmysite to my website. Paste this exactly, just before the closing </body> tag, then deploy:\n\n${snippet}\n\nIt shows ${desc}: who's reading my site, plus follow and comments. One lightweight line, no build step, nothing else on the page changes.`;

const VARIANTS: Variant[] = [
  {
    key: "circle",
    name: "Circle",
    blurb: "A round badge in the corner.",
    preview: <Mock kind="circle" />,
    snippet: ({ origin, id }) => `<script src="${origin}/w/${id}.js" data-launcher="circle"></script>`,
    prompt: (c) => widgetPrompt(`<script src="${c.origin}/w/${c.id}.js" data-launcher="circle"></script>`, "a small round badge in the corner"),
  },
  {
    key: "peek",
    name: "Peek",
    blurb: "A sliver on the edge that slides out.",
    preview: <Mock kind="peek" />,
    snippet: ({ origin, id }) => `<script src="${origin}/w/${id}.js" data-launcher="peek"></script>`,
    prompt: (c) => widgetPrompt(`<script src="${c.origin}/w/${c.id}.js" data-launcher="peek"></script>`, "a subtle sliver on the screen edge that slides out on hover"),
  },
  {
    key: "inline",
    name: "Inline link",
    blurb: "A link you place in your own content.",
    preview: <Mock kind="inline" />,
    snippet: ({ origin, id, handle }) =>
      `<a href="${origin}/@${handle}" data-signmysite>who's reading?</a>\n<script src="${origin}/w/${id}.js"></script>`,
    prompt: (c) =>
      `Add signmysite to my website as an inline link I can place in my content. Put this link where I want it, and add the script once before </body>:\n\n<a href="${c.origin}/@${c.handle}" data-signmysite>who's reading?</a>\n<script src="${c.origin}/w/${c.id}.js"></script>\n\nIt's a normal link that opens the signmysite card when clicked, and just links to my profile if JavaScript is off. Style the link to match my site.`,
  },
  {
    key: "invisible",
    name: "Invisible",
    blurb: "Nothing on the page, just analytics.",
    preview: <Mock kind="invisible" />,
    snippet: ({ origin, id }) => `<script src="${origin}/w/${id}.js" data-ui="none"></script>`,
    prompt: (c) =>
      `Add signmysite to my website with no visible widget, analytics only. Paste this once, just before </body>:\n\n<script src="${c.origin}/w/${c.id}.js" data-ui="none"></script>\n\nIt renders nothing on the page; I'll see who's reading from my signmysite dashboard.`,
  },
];

/** Site builders we have paste-here instructions for. Each is just a label + where the
 *  line goes, so adding one is a new entry, never a migration. */
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

/** A tiny CSS-only mock of a page wearing the variant — so each card is self-explanatory. */
function Mock({ kind }: { kind: string }) {
  return (
    <span className="vmock" aria-hidden="true">
      <span className="vmock-bar w1" />
      <span className={"vmock-bar w2" + (kind === "inline" ? " vmock-link" : "")} />
      <span className="vmock-bar w3" />
      {(kind === "circle" || kind === "peek") && <span className={"vmock-badge vmock-" + kind} />}
    </span>
  );
}

export function EmbedSetup({
  viewer, onVerified, onSkip,
}: {
  viewer: Member;
  onVerified?: () => void;
  onSkip?: () => void | Promise<void>;
}) {
  const { setViewer } = useViewer();
  const [sel, setSel] = useState("circle");
  const [platform, setPlatform] = useState<string | null>(null);
  const [missed, setMissed] = useState(false);
  const [skipping, setSkipping] = useState(false);

  const ctx: Ctx = { origin: location.origin, id: viewer.id.replace(/^signmysite:/, ""), handle: viewer.handle || "" };
  const variant = VARIANTS.find((v) => v.key === sel)!;
  const snippet = variant.snippet(ctx);
  const promptCopy = useCopy(variant.prompt(ctx));
  const snippetCopy = useCopy(snippet);
  const current = PLATFORMS.find((p) => p.id === platform) ?? null;

  // Already done it? Quietly check the live site once on open and flip to verified if
  // the widget's already there — no need to make them paste it again.
  const autoChecked = useRef(false);
  useEffect(() => {
    if (autoChecked.current || viewer.verified || !viewer.url) return;
    autoChecked.current = true;
    verifySite()
      .then((r) => { if (r.verified) { setViewer({ ...viewer, verified: true }); onVerified?.(); } })
      .catch(() => {});
  }, [viewer, setViewer, onVerified]);

  const skip = async () => {
    if (skipping || !onSkip) return;
    setSkipping(true);
    try { await onSkip(); } finally { setSkipping(false); }
  };

  return (
    <div className="es">
      {/* 1 — choose the look */}
      <section className="es-step">
        <div className="es-head">
          <span className="es-num">1</span>
          <div><h2>Choose how it looks</h2></div>
        </div>
        <div className="variant-grid">
          {VARIANTS.map((v) => (
            <button
              key={v.key}
              type="button"
              className={"variant-card" + (v.key === sel ? " on" : "")}
              aria-pressed={v.key === sel}
              onClick={() => setSel(v.key)}
            >
              <span className="variant-preview">{v.preview}</span>
              <span className="variant-name">
                {v.name}
                {v.key === sel && <span className="variant-check"><CheckIcon size={13} /></span>}
              </span>
              <span className="variant-blurb">{v.blurb}</span>
            </button>
          ))}
        </div>
      </section>

      {/* 2 — add it (copy prompt leads) */}
      <section className="es-step">
        <div className="es-head">
          <span className="es-num">2</span>
          <div><h2>Add it to your site</h2></div>
        </div>

        <div className="agent-cta">
          <div className="agent-cta-head">
            <h2>Copy/paste this to your AI agent</h2>
          </div>
          <Button className={"pink lg copy-prompt" + (promptCopy.copied ? " is-copied" : "")} onClick={promptCopy.copy}>
            {promptCopy.copied ? <CheckIcon /> : <CopyIcon />}
            {promptCopy.copied ? "Copied" : "Copy prompt"}
          </Button>
        </div>

        <div className="es-snippet">
          <div className="snippet">{snippet}</div>
          <Button className="es-copy" onClick={snippetCopy.copy}>
            {snippetCopy.copied ? <CheckIcon /> : <CopyIcon />}
            {snippetCopy.copied ? "Copied" : "Copy"}
          </Button>
        </div>

        <details className="es-where">
          <summary>Where do I paste it on my platform?</summary>
          <div className="platform-grid">
            {PLATFORMS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={"platform" + (p.id === platform ? " on" : "")}
                aria-pressed={p.id === platform}
                onClick={() => setPlatform(p.id)}
              >
                <span className="platform-logo"><PlatformLogo domain={p.domain} /></span>
                <span className="platform-name">{p.name}</span>
              </button>
            ))}
          </div>
          {current && (
            <ol className="vsteps slide-down" key={current.id}>
              {current.steps.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          )}
        </details>
      </section>

      {/* 3 — verify */}
      <section className="es-step">
        <div className="es-head">
          <span className="es-num">3</span>
          <div><h2>Check it's live</h2></div>
        </div>
        <div className="vfoot">
          <VerifyButton onVerified={onVerified} onMiss={() => setMissed(true)} />
          {onSkip && <Button className="lg" loading={skipping} onClick={skip}>Skip for now</Button>}
        </div>
        {missed && <p className="vfoot-miss">Not live yet. Publish, then verify again.</p>}
      </section>
    </div>
  );
}
