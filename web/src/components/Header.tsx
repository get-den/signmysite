import { Link, useNavigate } from "react-router-dom";
import { useViewer } from "../providers";
import { logout } from "../api";
import { signinUrl } from "../lib";

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
            <Link className="who" to="/">
              @{viewer.handle || "you"}
            </Link>
            <Link className="btn sm" to="/inbox">
              Pigeon box
            </Link>
            <Link className="btn sm" to="/embed">
              Get widget
            </Link>
            <button className="btn sm naked" onClick={signOut}>
              Sign out
            </button>
          </>
        ) : (
          <a className="btn sm primary" href={signinUrl()}>
            Sign in
          </a>
        )}
      </nav>
    </header>
  );
}
