import { useState } from "react";
import { host, JOIN_SITE_KEY, validateSite } from "../../lib";
import { DemoLink, JoinLink, WidgetPill } from "./shared";

/**
 * Variant 9 — on your site. The visitor types their own address and the preview
 * dresses itself as their site wearing the widget. The address is stashed so
 * onboarding can pick it up after sign-up.
 */
export function V9() {
  const [raw, setRaw] = useState("");
  const check = validateSite(raw);
  const domain = check.ok && check.url ? host(check.url) : null;

  const stash = () => {
    if (!check.ok || !check.url) return;
    try { localStorage.setItem(JOIN_SITE_KEY, check.url); } catch { /* ignore */ }
  };

  return (
    <div className="lv">
      <h1>See it on your own site</h1>
      <p className="lv-sub">
        signmysite is a one-line guestbook widget for personal sites. Type your
        address for a preview, no sign-up needed.
      </p>
      <input
        className="lv-site-input"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        placeholder="yoursite.com"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        aria-label="Your website address"
      />
      <div className={"lv-browser lv-preview" + (domain ? "" : " is-idle")} aria-hidden="true">
        <div className="lv-browser-bar">
          <i /><i /><i />
          <span className="lv-browser-url">
            {domain && <img src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`} alt="" />}
            {domain ?? "yoursite.com"}
          </span>
        </div>
        <div className="lv-preview-page">
          <span className="lv-preview-bone is-title" />
          <span className="lv-preview-bone" />
          <span className="lv-preview-bone is-short" />
          <WidgetPill />
        </div>
      </div>
      <p className="lv-fine">
        {domain
          ? `The badge sits in the corner, and readers click it to sign ${domain}.`
          : "The badge sits in the corner. Readers click it to sign your site."}
      </p>
      <div className="lv-cta-row">
        <JoinLink onClick={stash}>{domain ? `Add it to ${domain}` : "Add it to my site"}</JoinLink>
        <DemoLink />
      </div>
    </div>
  );
}
