/*
 * Shared presentational atoms for the home. Small and unopinionated about
 * arrangement — the panes own the composition, these own the look of a single thing
 * (a site tile, the state-aware site CTA, an empty-state line). One accent, hairline
 * rules, Söhne; nothing here introduces a new color.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { updateProfile, type Member, type Site } from "../api";
import { host, profileHref, validateSite } from "../lib";
import { useToast, useViewer } from "../providers";
import { Avatar, Button, IdentityLink, PinIcon, SiteThumbnail, VerifyButton } from "../ui";

/**
 * The one follow control, shared by the feed and both rails — the same lifecycle as
 * the widget + public profile: black "Follow" → quiet outline "Following" that reveals
 * "Unfollow" (red) on hover, then click to unfollow. It never disappears. The
 * inline-grid in .btn.following keeps "Following"/"Unfollow" the exact same width (no
 * resize on hover); the .just guard (set on follow, cleared on the next mouseleave)
 * stops it snapping to red under a cursor still resting on it right after you follow.
 */
export function FollowButton({ following, onToggle, sm = true }: { following: boolean; onToggle: () => void; sm?: boolean }) {
  const [just, setJust] = useState(false);
  const click = () => { if (!following) setJust(true); onToggle(); };
  const base = "btn" + (sm ? " sm" : "");
  return following ? (
    <button type="button" className={base + " following" + (just ? " just" : "")} onClick={click} onMouseLeave={() => setJust(false)}>
      <span className="lbl">Following</span>
    </button>
  ) : (
    <button type="button" className={base + " primary"} onClick={click}>Follow</button>
  );
}

/** A site preview tile for the saved wall: the og:image, name + avatar, and an
 *  optional pin toggle that writes through to your public profile. */
export function SiteTile({
  site, pinned, canPin, onPin,
}: {
  site: Site; pinned?: boolean; canPin?: boolean; onPin?: (s: Site) => void;
}) {
  return (
    <article className="tile">
      <a
        className="tile-thumb"
        href={site.url || profileHref(site)}
        target={site.url ? "_blank" : undefined}
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
        <IdentityLink of={site} className="tile-author">
          <Avatar of={site} />
          <span className="tile-name">{site.name}</span>
        </IdentityLink>
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
        <p>Link your site to see who reads it.</p>
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

// Linked but unproven: verify in place with the same control as the setup page. On
// success the viewer flips verified and this whole block gives way to analytics; on a
// miss we surface "I need help", which opens the full guided /verify flow.
function VerifyCTA({ url }: { url: string }) {
  const [missed, setMissed] = useState(false);
  return (
    <section className="rail-block cta cta-verify">
      <div className="cta-head">
        <h2>Verify your site</h2>
        <p>Add the one-line widget to <b>{host(url)}</b> to confirm it's yours and unlock analytics.</p>
      </div>
      <div className="cta-verify-actions">
        <VerifyButton className="primary" onMiss={() => setMissed(true)} />
        {missed && <Link className="btn" to="/verify">I need help</Link>}
      </div>
    </section>
  );
}
