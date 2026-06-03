import { Link, NavLink, useNavigate } from "react-router-dom";
import { useViewer } from "../providers";
import { logout } from "../api";
import { authUrl } from "../lib";

export function Header() {
  const { viewer, loading, setViewer } = useViewer();
  const navigate = useNavigate();

  async function signOut() {
    try {
      await logout();
    } finally {
      setViewer(null);
      navigate("/");
    }
  }

  return (
    <header className="top">
      <Link className="brand" to="/">
        den
      </Link>
      <nav>
        {loading ? null : !viewer ? (
          <a className="btn sm primary" href={authUrl()}>
            Sign in
          </a>
        ) : !viewer.onboarded ? (
          // Mid-signup: keep it focused — just a way out.
          <button className="btn sm naked" onClick={signOut}>
            Sign out
          </button>
        ) : (
          <>
            <NavLink className="navlink" to="/" end>
              Home
            </NavLink>
            <a className="navlink" href={`/@${viewer.handle}`}>
              Your site
            </a>
            <NavLink className="navlink" to="/messages">
              Messages
            </NavLink>
            <button className="btn sm naked" onClick={signOut}>
              Sign out
            </button>
          </>
        )}
      </nav>
    </header>
  );
}
