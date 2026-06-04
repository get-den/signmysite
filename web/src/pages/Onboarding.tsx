import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, checkHandle, claimHandle, onboard, scrapeSite } from "../api";
import { useToast, useViewer } from "../providers";
import { host, handleFromSite, normHandle, validateSite, JOIN_SITE_KEY } from "../lib";
import { Button, IconButton, Spinner } from "../ui";
import { WidgetSetup } from "../components/WidgetSetup";

// Username candidates for the picker: a pasted website wins the top slot (it's
// what they just told us), then their display name, broken into useful variants.
function suggestions(name: string, fallback: string | null, site?: string | null): string[] {
  const out = new Set<string>();
  const add = (h: string) => {
    if (!h) return;
    out.add(h);
    out.add(h.replace(/-/g, ""));
    const first = h.split("-")[0];
    if (first) out.add(first);
  };
  if (site) add(handleFromSite(site));
  add(normHandle(name || ""));
  if (out.size === 0 && fallback) out.add(normHandle(fallback));
  return [...out].filter((h) => h.length >= 3).slice(0, 4);
}

type Check =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "ok" }
  | { state: "bad"; reason: string };

// Everything the wizard collects, persisted verbatim so a reload (or coming back
// later) never loses a step. `siteKnown` records that a site arrived before the
// site step — pasted on the landing or already linked — so we skip asking for it
// and the back button/progress dots stay honest across reloads.
type Draft = { step: 1 | 2 | 3; handle: string; site: string; siteKnown: boolean };

const draftKey = (id: string) => `signmysite:onboard:${id}`;
function loadDraft(id: string): Draft | null {
  try { const r = localStorage.getItem(draftKey(id)); return r ? (JSON.parse(r) as Draft) : null; } catch { return null; }
}

export function Onboarding() {
  const { viewer, setViewer } = useViewer();
  const toast = useToast();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [handle, setHandle] = useState("");
  const [site, setSite] = useState("");
  // Did we already have their site before the site step? Then we skip it.
  const [siteKnown, setSiteKnown] = useState(false);
  const [check, setCheck] = useState<Check>({ state: "idle" });
  const [claiming, setClaiming] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [saving, setSaving] = useState(false);
  const seq = useRef(0);

  // A website pasted into the landing claim box, carried across sign-in. Read once;
  // it seeds both the username guess and the site field below.
  const [joinSite] = useState<string>(() => {
    try { return localStorage.getItem(JOIN_SITE_KEY) || ""; } catch { return ""; }
  });

  const picks = useMemo(
    () => suggestions(viewer?.name ?? "", viewer?.handle ?? null, joinSite),
    [viewer?.name, viewer?.handle, joinSite],
  );

  // Restore in-progress work once, so a reload (or coming back later) never loses
  // anything. Prefer a local draft; otherwise resume from what the server saved
  // (a linked site means they already reached the verify step); otherwise this is
  // a fresh sign-up, so seed from a site they pasted on the way in.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !viewer) return;
    restored.current = true;
    const d = loadDraft(viewer.id);
    if (d) {
      setHandle(d.handle || picks[0] || "");
      setSite(d.site || "");
      setSiteKnown(!!d.siteKnown);
      setStep(d.step || 1);
    } else if (viewer.url) {
      setHandle(viewer.handle || picks[0] || "");
      setSite(host(viewer.url));
      setSiteKnown(true);
      setStep(3);
    } else {
      setHandle(picks[0] || "");
      if (joinSite) { setSite(joinSite); setSiteKnown(true); }
    }
    try { localStorage.removeItem(JOIN_SITE_KEY); } catch { /* ignore */ } // consume once
  }, [viewer, picks, joinSite]);

  // Persist the draft on every meaningful change (durable across reloads).
  useEffect(() => {
    if (!viewer || !restored.current) return;
    try { localStorage.setItem(draftKey(viewer.id), JSON.stringify({ step, handle, site, siteKnown })); } catch { /* ignore */ }
  }, [viewer, step, handle, site, siteKnown]);

  // Debounced live availability — the heart of the picker.
  useEffect(() => {
    const h = handle;
    if (!h) return setCheck({ state: "idle" });
    if (h.length < 3) return setCheck({ state: "bad", reason: "At least 3 characters." });
    setCheck({ state: "checking" });
    const my = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const r = await checkHandle(h);
        if (my !== seq.current) return;
        setCheck(r.available ? { state: "ok" } : { state: "bad", reason: r.reason || "Already taken." });
      } catch {
        if (my === seq.current) setCheck({ state: "idle" });
      }
    }, 320);
    return () => clearTimeout(t);
  }, [handle]);

  if (!viewer) return null;
  const vid = viewer.id;

  const ready = check.state === "ok";
  const siteCheck = validateSite(site);

  // Step 1 → reserve the username server-side (durable). If we already have their
  // site (pasted on the landing, or linked before), save it and jump straight to
  // the widget step — no reason to ask again. Otherwise stop at the site step.
  async function toSite() {
    if (!ready || claiming) return;
    setClaiming(true);
    try {
      await claimHandle(handle);
      const sc = validateSite(site);
      if (sc.ok) {
        try { await scrapeSite(sc.url!); } catch { /* unreachable is fine — the url still saves */ }
        setSiteKnown(true);
        setStep(3);
      } else {
        setStep(2);
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setCheck({ state: "bad", reason: "Just taken. Try another." });
      else toast("Couldn't save. Try again.");
    } finally {
      setClaiming(false);
    }
  }

  // Step 2 → 3: save the site they typed (scrape captures a preview too), then on
  // to the widget. Verification itself happens on the widget step / back home.
  async function toVerify() {
    if (!siteCheck.ok || scraping) return;
    setScraping(true);
    try {
      await scrapeSite(siteCheck.url!);
      setStep(3);
    } catch {
      toast("Couldn't reach that site. Check the address.");
    } finally {
      setScraping(false);
    }
  }

  // Land in the app. The handle + site are already saved; this flips onboarded and
  // lets them straight through — verification is non-blocking and finishes (auto-
  // detected) once their widget loads, surfaced by the banner on the home page.
  async function finish() {
    if (saving) return;
    setSaving(true);
    try {
      const updated = await onboard(handle);
      try { localStorage.removeItem(draftKey(vid)); } catch { /* ignore */ }
      setViewer(updated);
    } catch (e) {
      setSaving(false);
      if (e instanceof ApiError && e.status === 409) {
        setStep(1);
        setCheck({ state: "bad", reason: "Just taken. Try another." });
      } else {
        toast("Couldn't finish. Try again.");
      }
    }
  }

  // When a site was known up front the site step is skipped, so back from the
  // widget step returns to the username step and the dots drop the middle one.
  const backFrom3 = siteKnown ? 1 : 2;
  const dots: Array<1 | 2 | 3> = siteKnown ? [1, 3] : [1, 2, 3];

  return (
    <div className="onb">
      <div className={"onb-card" + (step === 3 ? " onb-card-wide" : "")}>
        <div className="onb-head">
          <IconButton
            icon="back"
            className={"onb-back" + (step === 1 ? " is-hidden" : "")}
            onClick={() => setStep(step === 3 ? backFrom3 : 1)}
          />
        </div>

        {step === 1 && (
          <div className="onb-step" key="step1">
            <h1>Pick your username</h1>

            <div className={"onb-handle " + check.state}>
              <span className="onb-prefix">@</span>
              <input
                value={handle}
                onChange={(e) => setHandle(normHandle(e.target.value))}
                placeholder="yourname"
                autoFocus
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                aria-label="Username"
                onKeyDown={(e) => { if (e.key === "Enter" && ready) toSite(); }}
              />
              <span className="onb-tick">
                {check.state === "checking" ? <Spinner /> : check.state === "ok" ? "✓" : check.state === "bad" ? "✕" : ""}
              </span>
            </div>

            {check.state === "bad" && (
              <div className="onb-msg bad slide-down" key={"bad:" + check.reason}>
                {check.reason}
              </div>
            )}

            {picks.length > 0 && (
              <div className="onb-suggest">
                <span className="label">Try:</span>
                {picks.map((s) => (
                  <button key={s} type="button" onClick={() => setHandle(s)}>{s}</button>
                ))}
              </div>
            )}

            <Button className="primary lg" loading={claiming} disabled={!ready} onClick={toSite}>
              Continue
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="onb-step" key="step2">
            <h1>Add your site</h1>

            <div className={"onb-site" + (site.trim() && !siteCheck.ok ? " bad" : "")}>
              <input
                value={site}
                onChange={(e) => setSite(e.target.value)}
                placeholder="yoursite.com"
                inputMode="url"
                autoFocus
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                aria-label="Your website"
                onKeyDown={(e) => { if (e.key === "Enter" && siteCheck.ok) toVerify(); }}
              />
            </div>

            {site.trim() && siteCheck.error && (
              <div className="onb-msg bad slide-down" key={"site:" + siteCheck.error}>{siteCheck.error}</div>
            )}

            <div className="onb-actions">
              <Button className="primary lg" loading={scraping} disabled={!siteCheck.ok} onClick={toVerify}>
                Continue
              </Button>
              <Button className="naked lg" loading={saving} disabled={scraping} onClick={finish}>
                I don't have a site
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="onb-step onb-widget" key="step3">
            <h1>Add signmysite to your site</h1>

            <WidgetSetup viewer={viewer} onVerified={finish} />

            <div className="onb-foot">
              <Button className="naked" onClick={finish}>Skip</Button>
              <Button className="primary lg" loading={saving} onClick={finish}>Done</Button>
            </div>
          </div>
        )}

        <div className="onb-steps" aria-hidden="true">
          {dots.map((d) => (
            <span key={d} className={"onb-dot" + (step === d ? " on" : "")} />
          ))}
        </div>
      </div>
    </div>
  );
}
