/*
 * The app's one header — pinned above the single scroll container, its three slots
 * mirroring the panes below so everything optically lines up: the wordmark over the
 * nav rail, the search field over the feed, and an account/auth slot over the right
 * rail. Search is a signed-in affordance that filters the current view (see
 * useSearch). On narrow screens, where the nav rail collapses to a bottom tab bar,
 * the account chip moves here so you can still reach sign-out.
 */
import { Link, useLocation, useNavigate } from "react-router-dom";
import { logout } from "../api";
import { authUrl } from "../lib";
import { useSearch, useViewer } from "../providers";
import { SearchIcon } from "../ui";
import { AvatarMenu } from "../home/AvatarMenu";
import { useMediaQuery } from "../home/hooks";
import { WIDE } from "../home/FeedLayout";

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
          {loading ? null : !viewer ? (
            pathname === "/auth" ? null : (
              <a className="btn sm pink" href={authUrl()}>Join now</a>
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

function SearchBar() {
  const { q, setQ } = useSearch();
  return (
    <form className="topbar-search search" role="search" onSubmit={(e) => e.preventDefault()}>
      <SearchIcon />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search"
        aria-label="Search"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
      />
      {q && (
        <button type="button" className="topbar-search-clear" aria-label="Clear search" onClick={() => setQ("")}>×</button>
      )}
    </form>
  );
}
