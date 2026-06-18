/*
 * The app's one header — pinned above the single scroll container, its three slots
 * mirroring the panes below so everything optically lines up: the wordmark over the
 * nav rail, the search field over the feed, and an account/auth slot over the right
 * rail. Search is a signed-in affordance: it opens a typeahead of people (by name,
 * @handle, or site URL) you can jump straight to, and the shared query also narrows the
 * current view (see useSearch). On narrow screens, where the nav rail collapses to a
 * bottom tab bar, the account chip moves here so you can still reach sign-out.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { logout, searchAccounts, type Member } from "../api";
import { authUrl, host, profilePath } from "../lib";
import { useSearch, useViewer } from "../providers";
import { Avatar, SearchIcon } from "../ui";
import { AvatarMenu } from "../home/AvatarMenu";
import { useMediaQuery } from "../home/hooks";
import { WIDE } from "../home/FeedLayout";
import { LiveBell } from "../live";

export function TopBar() {
  const { viewer, loading, setViewer } = useViewer();
  const wide = useMediaQuery(WIDE);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const onboarded = !!viewer?.onboarded;

  async function signOut() {
    try { await logout(); } finally { setViewer(null); navigate("/"); }
  }

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="topbar-brand">
          <Link className="brand" to="/">signmysite</Link>
        </div>

        {onboarded ? <SearchBar /> : <div className="topbar-spacer" />}

        <div className="topbar-right">
          <LiveBell />
          {loading ? null : !viewer ? (
            pathname === "/auth" ? null : (
              <a className="btn sm pink" href={authUrl()}>Sign up</a>
            )
          ) : !onboarded ? (
            <button className="btn sm naked" onClick={signOut}>Sign out</button>
          ) : !wide ? (
            <AvatarMenu viewer={viewer} compact />
          ) : null}
        </div>
      </div>
    </header>
  );
}

// People search: a debounced typeahead over name / @handle / site URL. The shared
// query (useSearch) also narrows the home feed, so typing does both — find an account
// to jump to, and filter what's on screen. Picking a result opens their in-app profile.
function SearchBar() {
  const { q, setQ } = useSearch();
  const navigate = useNavigate();
  const [results, setResults] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const needle = q.trim();
    if (!needle) { setResults([]); setLoading(false); return; }
    setLoading(true);
    const t = setTimeout(() => {
      searchAccounts(needle)
        .then((r) => { setResults(r); setLoading(false); })
        .catch(() => { setResults([]); setLoading(false); });
    }, 180);
    return () => clearTimeout(t);
  }, [q]);

  // Dismiss the dropdown on an outside click or Escape.
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, []);

  const close = () => { setOpen(false); setQ(""); };
  const goTo = (m: Member) => {
    const path = profilePath(m);
    close();
    if (path) navigate(path);
    else if (m.url) window.open(m.url, "_blank", "noopener");
  };

  const showDrop = open && !!q.trim();
  return (
    <div className="topbar-search-wrap" ref={wrap}>
      <form className="topbar-search search" role="search" onSubmit={(e) => { e.preventDefault(); if (results[0]) goTo(results[0]); }}>
        <SearchIcon />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search people, @handles, sites"
          aria-label="Search people by name, handle, or site"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        {q && (
          <button type="button" className="topbar-search-clear" aria-label="Clear search" onClick={close}>×</button>
        )}
      </form>

      {showDrop && (
        <div className="search-results" role="listbox" aria-label="People">
          {results.length ? (
            results.map((m) => <SearchResult key={m.id} m={m} onPick={close} />)
          ) : (
            <div className="search-empty">{loading ? "Searching…" : "No people found."}</div>
          )}
        </div>
      )}
    </div>
  );
}

// One person in the search dropdown. Routes in-app to /@<handle> (Link, so the dropdown
// closes via onPick), else out to their site.
function SearchResult({ m, onPick }: { m: Member; onPick: () => void }) {
  const path = profilePath(m);
  const sub = m.handle ? `@${m.handle}` : (m.url ? host(m.url) : "");
  const inner = (
    <>
      <Avatar of={m} />
      <span className="search-result-meta">
        <b>{m.name || (m.handle ? `@${m.handle}` : "Someone")}</b>
        {sub && <span className="search-result-sub">{sub}</span>}
      </span>
    </>
  );
  return path ? (
    <Link className="search-result" to={path} role="option" onClick={onPick}>{inner}</Link>
  ) : m.url ? (
    <a className="search-result" href={m.url} target="_blank" rel="noopener" role="option" onClick={onPick}>{inner}</a>
  ) : (
    <span className="search-result">{inner}</span>
  );
}
