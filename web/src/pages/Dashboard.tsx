import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  getDiscovery,
  getFollowing,
  getInbox,
  getStats,
  orEmpty,
  type Discovery,
  type InboxNote,
  type Member,
  type Site,
  type Stats,
} from "../api";
import { compact, host } from "../lib";
import { mockDiscovery, mockFollowing } from "../mockData";
import { Avatar } from "../ui";

type Shelf = "following" | "recommended" | "saved";
const tabs: Array<[Shelf, string]> = [["following", "Following"], ["recommended", "Recommended"], ["saved", "Most saved"]];

export function Dashboard({ viewer }: { viewer: Member }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [notes, setNotes] = useState<InboxNote[]>([]);
  const [following, setFollowing] = useState<Site[]>([]);
  const [discovery, setDiscovery] = useState<Discovery>(mockDiscovery);
  const [shelf, setShelf] = useState<Shelf>("following");

  useEffect(() => {
    let alive = true;
    const keep = <T,>(fn: (v: T) => void) => (v: T) => alive && fn(v);
    getStats(viewer.id).then(keep(setStats)).catch(() => {});
    orEmpty(getInbox()).then(keep(setNotes));
    orEmpty(getFollowing()).then((sites) => alive && setFollowing(sites.length ? sites : mockFollowing));
    getDiscovery().then(keep(setDiscovery)).catch(() => {});
    return () => { alive = false; };
  }, [viewer.id]);

  const sites =
    shelf === "following" ? following :
    shelf === "recommended" ? discovery.recommended || [] :
    discovery.mostSaved || [];
  const fallback = shelf === "following" ? mockFollowing : shelf === "recommended" ? mockDiscovery.recommended : mockDiscovery.mostSaved;

  return (
    <div className="dash">
      <section className="dash-hero">
        <div className="hero-copy">
          <p className="eyebrow">Your internet, collected</p>
          <h1>Follow sites, save inspiration, and see what your people are building.</h1>
          <div className="hero-actions">
            <Link className="btn primary" to="/site">Get your widget</Link>
            <Link className="btn" to="/messages">Read notes</Link>
          </div>
        </div>

        <div className="profile-card">
          <Avatar of={viewer} />
          <div>
            <div className="profile-name">{viewer.name || "You"}</div>
            <div className="profile-handle">@{viewer.handle || "you"}</div>
          </div>
          <div className="mini-stats">
            <Stat label="views" value={stats?.views} />
            <Stat label="followers" value={stats?.followers} />
            <Stat label="following" value={stats?.following} />
            <Stat label="saved" value={stats?.saved} />
          </div>
        </div>
      </section>

      <section className="workspace">
        <div className="feed-panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Discover</p>
              <h2>Sites from your graph</h2>
            </div>
            <div className="tabs" role="tablist" aria-label="Discovery shelves">
              {tabs.map(([id, label]) => (
                <button key={id} className={"tab" + (shelf === id ? " on" : "")} onClick={() => setShelf(id)} type="button">
                  {label}
                </button>
              ))}
            </div>
          </div>
          <SiteGrid sites={sites.length ? sites : fallback} />
        </div>

        <aside className="side-rail">
          <Rail title="Saved for later">
            {(discovery.saved.length ? discovery.saved : mockDiscovery.saved).slice(0, 3).map((site) => <MiniSite key={site.id} site={site} />)}
          </Rail>
          <Rail title="Recent notes" to="/messages">
            {notes.length ? notes.slice(0, 3).map((note) => <NoteLine key={note.id} note={note} />) : <div className="empty">No notes yet. Your widget is ready for hellos.</div>}
          </Rail>
          <div className="widget-card">
            <div className="ribbon-preview">⌑</div>
            <div>
              <h3>Install the fast widget</h3>
              <p>Vanilla JS, rounded, and ready for any site builder.</p>
              <Link className="btn sm primary" to="/site">Copy script</Link>
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}

function SiteGrid({ sites }: { sites: Site[] }) {
  if (!sites.length) return <div className="empty-card">Nothing here yet. Follow a few sites to train the graph.</div>;
  return <div className="site-grid">{sites.map((site, index) => <SiteCard key={site.id} site={site} index={index} />)}</div>;
}

function SiteCard({ site, index }: { site: Site; index: number }) {
  const href = site.url || (site.handle ? `/@${site.handle}` : "#");
  return (
    <a className="site-card" href={href} target={site.url ? "_blank" : undefined} rel="noopener">
      <div className={"thumb thumb-" + (index % 6)} style={site.thumbnail ? { backgroundImage: `url(${JSON.stringify(site.thumbnail)})` } : undefined}>
        <span className="open-dot">↗</span>
      </div>
      <div className="site-meta">
        <Avatar of={site} />
        <div className="site-copy">
          <div className="site-title">{site.name}{site.isNew && <span className="newdot" />}</div>
          <div className="site-sub">{site.reason || (site.url ? host(site.url) : "@" + site.handle)}</div>
        </div>
        <div className="card-stats">
          <span>♡ {compact(site.savedCount)}</span>
          <span>◉ {compact(site.views)}</span>
        </div>
      </div>
    </a>
  );
}

function Rail({ title, to, children }: { title: string; to?: string; children: ReactNode }) {
  return (
    <div className="rail-card">
      <div className="rail-head">
        <h3>{title}</h3>
        {to && <Link to={to}>View</Link>}
      </div>
      {children}
    </div>
  );
}

function MiniSite({ site }: { site: Site }) {
  const href = site.url || (site.handle ? `/@${site.handle}` : "#");
  return (
    <a className="mini-site" href={href} target={site.url ? "_blank" : undefined} rel="noopener">
      <Avatar of={site} />
      <span>{site.name}</span>
      <b>{compact(site.savedCount)}</b>
    </a>
  );
}

function NoteLine({ note }: { note: InboxNote }) {
  return (
    <Link className="comment-line" to="/messages">
      <Avatar of={note.author} />
      <div>
        <b>{note.author.name || "Someone"}</b>
        <p>{note.visibility === "private" ? "Private note" : note.body}</p>
      </div>
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: number | null | undefined }) {
  return <div><b>{compact(value)}</b><span>{label}</span></div>;
}
