import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ApiError,
  getDiscovery,
  getFollowing,
  getInbox,
  getPinned,
  getStats,
  orEmpty,
  togglePin,
  verifySite,
  type Discovery,
  type InboxNote,
  type Member,
  type PinnedSite,
  type Site,
  type Stats,
} from "../api";
import { compact, host, profileHref, siteThumb } from "../lib";
import { mockDiscovery, mockFollowing } from "../mockData";
import { useToast, useViewer } from "../providers";
import { Avatar, Button, EyeIcon, HeartIcon, PinIcon, SearchIcon, Tip, useCopy } from "../ui";

const PIN_LIMIT = 3;

type Shelf = "all" | "following" | "recommended" | "saved";
const SHELVES: Array<[Shelf, string]> = [
  ["all", "Explore"],
  ["following", "Following"],
  ["recommended", "For you"],
  ["saved", "Most saved"],
];

function dedupe(sites: Site[]): Site[] {
  const seen = new Set<string>();
  return sites.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
}

export function Dashboard({ viewer }: { viewer: Member }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [notes, setNotes] = useState<InboxNote[]>([]);
  const [following, setFollowing] = useState<Site[]>(mockFollowing);
  const [discovery, setDiscovery] = useState<Discovery>(mockDiscovery);
  const [shelf, setShelf] = useState<Shelf>("all");
  const [query, setQuery] = useState("");
  const [pinned, setPinned] = useState<PinnedSite[]>([]);
  const toast = useToast();

  useEffect(() => {
    let alive = true;
    const keep = <T,>(fn: (v: T) => void) => (v: T) => alive && fn(v);
    getStats(viewer.id).then(keep(setStats)).catch(() => {});
    orEmpty(getInbox()).then(keep(setNotes));
    orEmpty(getFollowing()).then((sites) => alive && setFollowing(sites.length ? sites : mockFollowing));
    getDiscovery().then(keep(setDiscovery)).catch(() => {});
    orEmpty(getPinned()).then(keep(setPinned));
    return () => { alive = false; };
  }, [viewer.id]);

  const pinnedIds = useMemo(() => new Set(pinned.map((p) => p.id)), [pinned]);

  // Toggle a pin, then re-sync the showcase from the server (authoritative order
  // + the limit). A rejected 4th pin (409) surfaces as a gentle nudge.
  const onPin = async (site: Site) => {
    try {
      await togglePin(site.id);
      setPinned(await getPinned());
    } catch (e) {
      if (e instanceof ApiError && e.status === 409)
        toast(`Pin up to ${PIN_LIMIT} — unpin one first.`);
      else toast("Couldn't update pin.");
    }
  };

  const allSites = useMemo(
    () => dedupe([...following, ...discovery.recommended, ...discovery.mostSaved, ...discovery.saved]),
    [following, discovery],
  );

  const base =
    shelf === "following" ? following :
    shelf === "recommended" ? discovery.recommended :
    shelf === "saved" ? discovery.mostSaved :
    allSites;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter((s) =>
      (s.name || "").toLowerCase().includes(q) ||
      (s.handle || "").toLowerCase().includes(q) ||
      (s.reason || "").toLowerCase().includes(q) ||
      (s.tags || []).some((t) => t.toLowerCase().includes(q)),
    );
  }, [base, query]);

  return (
    <div className="dash">
      <VerifyNotice viewer={viewer} />
      <header className="dash-head">
        <DashYou viewer={viewer} />
        <div className="dash-head-actions">
          <Link className="btn sm" to="/edit">Edit profile</Link>
          {viewer.handle && <a className="btn sm primary" href={`/@${viewer.handle}`}>View profile</a>}
        </div>
      </header>

      <div className="stat-row">
        <Stat n={stats?.views} l="Views" tip="Times your sites have been opened — every widget impression counts." />
        <Stat n={stats?.followers} l="Followers" tip="People following you. Your updates show up in their Den feed." />
        <Stat n={stats?.following} l="Following" tip="Sites you follow. Their new posts appear in your feed." />
        <Stat n={stats?.saved} l="Saved" tip="Sites you've saved to revisit later — private to you." />
      </div>

      <div className="dash-grid">
        <RecentNotes notes={notes} />
        <InstallWidget viewer={viewer} />
      </div>

      <PinnedShelf pinned={pinned} onUnpin={onPin} />

      <section className="explore">
        <div className="explore-bar">
          <div className="seg" role="tablist" aria-label="Filter sites">
            {SHELVES.map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={shelf === id}
                className={"seg-btn" + (shelf === id ? " on" : "")}
                onClick={() => setShelf(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="search">
            <SearchIcon />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search sites"
              aria-label="Search sites"
            />
          </div>
        </div>
        <SiteGrid sites={visible} selfId={viewer.id} pinnedIds={pinnedIds} onPin={onPin} />
      </section>
    </div>
  );
}

/** The owner's own identity, linking to their public profile. */
function DashYou({ viewer }: { viewer: Member }) {
  const inner = (
    <>
      <Avatar of={viewer} />
      <div>
        <h1 className="dash-name">{viewer.name || "You"}</h1>
        <div className="dash-handle">@{viewer.handle || "you"}</div>
      </div>
    </>
  );
  return viewer.handle ? (
    <a className="dash-you" href={`/@${viewer.handle}`}>{inner}</a>
  ) : (
    <div className="dash-you">{inner}</div>
  );
}

function Stat({ n, l, tip }: { n: number | null | undefined; l: string; tip: string }) {
  return (
    <Tip label={tip}>
      {/* tabIndex makes the tile focusable so the tooltip is keyboard-accessible. */}
      <div className="stat" tabIndex={0}>
        <b>{compact(n)}</b>
        <span>{l}</span>
      </div>
    </Tip>
  );
}

// The pin showcase: the (max 3) sites featured on your public profile, each with
// the notes you left on it. Empty state nudges the user to pin from the grid.
function PinnedShelf({ pinned, onUnpin }: { pinned: PinnedSite[]; onUnpin: (s: Site) => void }) {
  return (
    <section className="pin-shelf">
      <div className="pin-head">
        <h2>Pinned</h2>
        <span className="muted">Featured on your profile · max {PIN_LIMIT}</span>
      </div>
      {pinned.length ? (
        <div className="pin-cards">
          {pinned.map((site) => (
            <article className="pin-card" key={site.id}>
              <a className="shot-author" href={profileHref(site)}>
                <Avatar of={site} />
                <span className="shot-name">{site.name}</span>
              </a>
              <button type="button" className="pin-card-unpin" onClick={() => onUnpin(site)} aria-label={`Unpin ${site.name}`}>
                <PinIcon filled />
              </button>
              {site.notes.length > 0 && (
                <div className="pin-card-notes">
                  {site.notes.map((n) => <span className="pin-bubble" key={n.id}>{n.body}</span>)}
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className="pin-empty">Pin a site below to feature it here and on your public profile.</div>
      )}
    </section>
  );
}

function SiteGrid({
  sites, selfId, pinnedIds, onPin,
}: {
  sites: Site[]; selfId: string; pinnedIds: Set<string>; onPin: (s: Site) => void;
}) {
  return (
    <div className="shots">
      {sites.length ? (
        sites.map((site, index) => (
          <SiteCard
            key={site.id}
            site={site}
            index={index}
            pinned={pinnedIds.has(site.id)}
            canPin={site.id !== selfId}
            onPin={onPin}
          />
        ))
      ) : (
        <div className="empty-card">No sites match — try a different search or filter.</div>
      )}
    </div>
  );
}

function SiteCard({
  site, index, pinned, canPin, onPin,
}: {
  site: Site; index: number; pinned: boolean; canPin: boolean; onPin: (s: Site) => void;
}) {
  const profile = profileHref(site);
  const siteHref = site.url || profile;
  const external = !!site.url;
  return (
    <article className="shot">
      <a
        className={"shot-thumb thumb-" + (index % 6)}
        href={siteHref}
        target={external ? "_blank" : undefined}
        rel="noopener"
        style={{ backgroundImage: `url(${JSON.stringify(siteThumb(site))})` }}
        aria-label={`Open ${site.name}`}
      >
        {site.isNew && <span className="shot-new">New</span>}
      </a>
      {canPin && (
        <button
          type="button"
          className={"shot-pin" + (pinned ? " on" : "")}
          onClick={() => onPin(site)}
          aria-pressed={pinned}
          aria-label={pinned ? `Unpin ${site.name}` : `Pin ${site.name} to your profile`}
          title={pinned ? "Pinned to your profile" : "Pin to your profile"}
        >
          <PinIcon filled={pinned} />
        </button>
      )}
      <div className="shot-foot">
        <a className="shot-author" href={profile} aria-label={`${site.name}'s profile`}>
          <Avatar of={site} />
          <span className="shot-name">{site.name}</span>
        </a>
        <div className="shot-stats">
          <span className="shot-stat"><HeartIcon />{compact(site.savedCount)}</span>
          <span className="shot-stat"><EyeIcon />{compact(site.views)}</span>
        </div>
      </div>
    </article>
  );
}

function RecentNotes({ notes }: { notes: InboxNote[] }) {
  return (
    <div className="card">
      <div className="card-head">
        <h3>Recent notes</h3>
        <Link to="/messages">View all</Link>
      </div>
      {notes.length ? (
        notes.slice(0, 3).map((note) => <NoteLine key={note.id} note={note} />)
      ) : (
        <div className="empty">No notes yet. Your widget is ready for hellos.</div>
      )}
    </div>
  );
}

function NoteLine({ note }: { note: InboxNote }) {
  const a = note.author;
  const inner: ReactNode = (
    <>
      <Avatar of={a} />
      <div>
        <b>{a.name || "Someone"}</b>
        <p>{note.visibility === "private" ? "Private note" : note.body}</p>
      </div>
    </>
  );
  return a.handle ? (
    <a className="note-line" href={`/@${a.handle}`}>{inner}</a>
  ) : (
    <Link className="note-line" to="/messages">{inner}</Link>
  );
}

// A quiet nudge while a linked site is unverified. Verifying re-checks the live
// site for the widget; if it's not there yet, we point them at the widget card.
function VerifyNotice({ viewer }: { viewer: Member }) {
  const { setViewer } = useViewer();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!viewer.url || viewer.verified) return null;

  const verify = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await verifySite();
      if (r.verified) {
        setViewer({ ...viewer, verified: true });
        toast("Verified ✓");
      } else {
        toast("Add the Den script to your site, then verify.");
      }
    } catch {
      toast("Couldn't verify — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="verify-bar">
      <span>
        Your site <b>{host(viewer.url)}</b> is <span className="unverified">unverified</span>. Add your widget to claim it.
      </span>
      <Button className="sm" loading={busy} onClick={verify}>Verify</Button>
    </div>
  );
}

function InstallWidget({ viewer }: { viewer: Member }) {
  const tag = `<script src="${location.origin}/w/${viewer.id.replace(/^den:/, "")}.js"></script>`;
  const { copied, copy } = useCopy(tag);
  return (
    <div className="card dash-widget">
      <div className="card-head">
        <h3>Your widget</h3>
        <a href={`/@${viewer.handle}`}>View on your site →</a>
      </div>
      <p>One line — works on any site builder.</p>
      <div className="snippet">{tag}</div>
      <button className="btn sm pink" type="button" onClick={copy}>{copied ? "Copied" : "Copy script"}</button>
    </div>
  );
}
