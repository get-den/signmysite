import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, checkHandle, claimHandle, onboard, scrapeSite, verifySite } from "../api";
import { useToast, useViewer } from "../providers";
import { host, handleFromSite, normHandle, validateSite, JOIN_SITE_KEY } from "../lib";
import { Button, CopyField, IconButton, Spinner } from "../ui";
import { LinksEditor } from "../components/LinksEditor";

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

type Scrape = { host: string; reachable: boolean; thumbnail: string | null; avatar: string | null };
type Draft = { step: 1 | 2 | 3; handle: string; site: string; scrape: Scrape | null; links: string[] };

const draftKey = (id: string) => `den:onboard:${id}`;
function loadDraft(id: string): Draft | null {
  try { const r = localStorage.getItem(draftKey(id)); return r ? (JSON.parse(r) as Draft) : null; } catch { return null; }
}

export function Onboarding() {
  const { viewer, setViewer } = useViewer();
  const toast = useToast();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [handle, setHandle] = useState("");
  const [site, setSite] = useState("");
  const [check, setCheck] = useState<Check>({ state: "idle" });
  const [claiming, setClaiming] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [scrape, setScrape] = useState<Scrape | null>(null);
  const [links, setLinks] = useState<string[]>([]);
  const [verifyState, setVerifyState] = useState<"idle" | "verifying" | "failed">("idle");
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
      setScrape(d.scrape);
      setLinks(d.links || []);
      setStep(d.step || 1);
    } else if (viewer.url) {
      const sc: Scrape = { host: host(viewer.url), reachable: true, thumbnail: null, avatar: viewer.avatar };
      setHandle(viewer.handle || picks[0] || "");
      setSite(host(viewer.url));
      setScrape(sc);
      setStep(3);
    } else {
      setHandle(picks[0] || "");
      if (joinSite) setSite(joinSite);
    }
    try { localStorage.removeItem(JOIN_SITE_KEY); } catch { /* ignore */ } // consume once
  }, [viewer, picks, joinSite]);

  // Persist the draft on every meaningful change (durable across reloads).
  useEffect(() => {
    if (!viewer || !restored.current) return;
    try { localStorage.setItem(draftKey(viewer.id), JSON.stringify({ step, handle, site, scrape, links })); } catch { /* ignore */ }
  }, [viewer, step, handle, site, scrape, links]);

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

  // Step 1 → 2: reserve the username server-side (durable), then advance.
  async function toSite() {
    if (!ready || claiming) return;
    setClaiming(true);
    try {
      await claimHandle(handle);
      setStep(2);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setCheck({ state: "bad", reason: "Just taken. Try another." });
      else toast("Couldn't save. Try again.");
    } finally {
      setClaiming(false);
    }
  }

  // Step 2 → 3: optimistically scrape the site (thumbnail + inferred avatar).
  async function toVerify() {
    if (!siteCheck.ok || scraping) return;
    setScraping(true);
    try {
      const r = await scrapeSite(siteCheck.url!);
      setScrape(r);
      setVerifyState("idle");
      setStep(3);
    } catch {
      toast("Couldn't reach that site. Check the address.");
    } finally {
      setScraping(false);
    }
  }

  // Land in the app. Handle + site are already saved; this flips onboarded.
  async function finish() {
    if (saving) return;
    setSaving(true);
    try {
      const updated = await onboard(handle, links);
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

  async function doVerify() {
    if (verifyState === "verifying" || saving) return;
    setVerifyState("verifying");
    try {
      const r = await verifySite();
      if (r.verified) await finish();
      else setVerifyState("failed");
    } catch {
      setVerifyState("failed");
    }
  }

  const idShort = viewer.id.replace(/^den:/, "");
  const scriptTag = `<script src="${location.origin}/w/${idShort}.js"></script>`;

  return (
    <div className="onb">
      <div className="onb-card">
        <div className="onb-head">
          <IconButton
            icon="back"
            className={"onb-back" + (step === 1 ? " is-hidden" : "")}
            onClick={() => setStep(step === 3 ? 2 : 1)}
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

            <div className="onb-socials">
              <span className="onb-sub">Your socials <span className="onb-opt">optional</span></span>
              <LinksEditor value={links} onChange={setLinks} />
            </div>

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
          <div className="onb-step" key="step3">
            <h1>Add your widget</h1>

            <CopyField text={scriptTag} />

            {verifyState === "failed" && (
              <div className="onb-msg bad slide-down" key="verify-failed">
                Couldn't find the script on {scrape?.host ?? "your site"} yet. Add it, publish, then try again.
              </div>
            )}

            <div className="onb-actions">
              <Button className="primary lg" loading={verifyState === "verifying"} onClick={doVerify}>
                Done
              </Button>
              <Button className="naked lg" loading={saving} disabled={verifyState === "verifying"} onClick={finish}>
                Skip for now
              </Button>
            </div>
          </div>
        )}

        <div className="onb-steps" aria-hidden="true">
          <span className={"onb-dot" + (step === 1 ? " on" : "")} />
          <span className={"onb-dot" + (step === 2 ? " on" : "")} />
          <span className={"onb-dot" + (step === 3 ? " on" : "")} />
        </div>
      </div>
    </div>
  );
}
