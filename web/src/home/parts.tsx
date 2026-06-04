/*
 * Shared presentational atoms for the home. Small and unopinionated about
 * arrangement — the panes own the composition, these own the look of a single thing
 * (a site tile, the state-aware site CTA, an empty-state line). One accent, hairline
 * rules, Söhne; nothing here introduces a new color.
 */
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { updateProfile, type Member, type Site } from "../api";
import { host, profileHref, validateSite } from "../lib";
import { useToast, useViewer } from "../providers";
import { Avatar, Button, PinIcon, SiteThumbnail } from "../ui";

/** An empty-state line: calm, never a dead end — always says what to do next. */
export function Hint({ children }: { children: ReactNode }) {
  return <p className="home-hint">{children}</p>;
}

/** A site preview tile for the saved wall: the og:image, name + avatar, and an
 *  optional pin toggle that writes through to your public profile. */
export function SiteTile({
  site, pinned, canPin, onPin,
}: {
  site: Site; pinned?: boolean; canPin?: boolean; onPin?: (s: Site) => void;
}) {
  const profile = profileHref(site);
  const external = !!site.url;
  return (
    <article className="tile">
      <a
        className="tile-thumb"
        href={site.url || profile}
        target={external ? "_blank" : undefined}
        rel="noopener"
        aria-label={`Open ${site.name}`}
      >
        <SiteThumbnail site={site} />
        {site.isNew && <span className="tile-new">New</span>}
      </a>
      {canPin && onPin && (
        <button
          type="button"
          className={"tile-pin" + (pinned ? " on" : "")}
          onClick={() => onPin(site)}
          aria-pressed={pinned}
          aria-label={pinned ? `Unpin ${site.name}` : `Pin ${site.name} to your profile`}
          title={pinned ? "Pinned to your profile" : "Pin to your profile"}
        >
          <PinIcon filled={pinned} />
        </button>
      )}
      <div className="tile-foot">
        <a className="tile-author" href={profile}>
          <Avatar of={site} />
          <span className="tile-name">{site.name}</span>
        </a>
        {site.reason && <span className="tile-reason">{site.reason}</span>}
      </div>
    </article>
  );
}

/**
 * The state-aware lead of the right rail. The first thing you should see depends on
 * where you are: no linked site → a box to add one; a linked but unverified site → a
 * prompt to verify it. Once verified it renders nothing, and the rail shows your
 * analytics instead (see RightRail).
 */
export function SiteCTA({ viewer }: { viewer: Member }) {
  if (!viewer.url) return <AddSiteForm />;
  if (!viewer.verified) return <VerifyCTA url={viewer.url} />;
  return null;
}

// Paste a site → save it on your profile (then verify next). Mirrors the edit page:
// validate live, PATCH the profile, refresh the viewer in place.
function AddSiteForm() {
  const { viewer, setViewer } = useViewer();
  const toast = useToast();
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    if (busy || !viewer) return;
    const check = validateSite(raw);
    if (!check.ok || !check.url) { setErr(check.error || "Enter your site's web address."); return; }
    setBusy(true); setErr("");
    try {
      const updated = await updateProfile({
        name: viewer.name, handle: viewer.handle ?? "", url: check.url,
        avatar: viewer.avatar ?? "", links: viewer.links ?? [],
      });
      setViewer(updated);
      toast("Site linked. Verify it next.");
    } catch {
      setErr("Couldn't link that site. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rail-block cta cta-add">
      <div className="cta-head">
        <h2>Add your site</h2>
        <p>Link your personal site and signmysite starts showing who reads it.</p>
      </div>
      <div className={"cta-field" + (err ? " bad" : "")}>
        <input
          value={raw}
          onChange={(e) => { setRaw(e.target.value); setErr(""); }}
          placeholder="yoursite.com"
          aria-label="Your site's web address"
          autoCapitalize="none" autoCorrect="off" spellCheck={false}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        />
        <Button className="primary" loading={busy} disabled={!raw.trim()} onClick={submit}>Add</Button>
      </div>
      {err && <p className="cta-err">{err}</p>}
    </section>
  );
}

// Linked but unproven: a nudge into the guided /verify flow. The whole install lives
// there, so this just points the way — and useAutoReverify flips the rail to analytics
// the moment the widget is detected, so there's no button to press here twice.
function VerifyCTA({ url }: { url: string }) {
  return (
    <section className="rail-block cta cta-verify">
      <div className="cta-head">
        <h2>Verify your site</h2>
        <p>Add the one-line widget to <b>{host(url)}</b> to confirm it's yours and unlock analytics.</p>
      </div>
      <Link className="btn primary" to="/verify">Verify your site</Link>
    </section>
  );
}
