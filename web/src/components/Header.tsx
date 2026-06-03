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
        {loading ? null : viewer ? (
          <>
            <NavLink className="navlink" to="/" end>
              Home
            </NavLink>
            <NavLink className="navlink" to="/site">
              Your site
            </NavLink>
            <NavLink className="navlink" to="/messages">
              Messages
            </NavLink>
            <button className="btn sm naked" onClick={signOut}>
              Sign out
            </button>
          </>
        ) : (
          <a className="btn sm primary" href={authUrl()}>
            Sign in
          </a>
        )}
      </nav>
    </header>
  );
}
