import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useViewer } from "../providers";
import { IconButton, Loading } from "../ui";
import { SignIn } from "../components/SignIn";
import { ProfileMock } from "../components/ProfileMock";

/**
 * The focused sign-in page (in-app /#/auth). Anywhere that needs a signed-in
 * member (the landing "Join now", Compose's signed-out Send, the header) sends
 * them here with ?return=, then back once they're in — so the original action
 * resumes. Magic-link email is the primary method, Google underneath; the link
 * doubles as sign-up, so one page covers join + log in.
 */
export function Auth() {
  const { viewer, loading } = useViewer();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const ret = params.get("return") || "/";

  if (loading) return <Loading />;
  // Already signed in: skip the page and resume wherever we were headed.
  if (viewer) return <Navigate to={inAppPath(ret)} replace />;

  return (
    <div className="auth">
      <div className="auth-form">
        <IconButton icon="back" className="auth-back" onClick={() => navigate(backPath(ret))} />
        <h1 className="auth-title">Join Den</h1>
        <p className="auth-sub">
          Sign in or create your account. We'll email you a link, no password needed.
        </p>
        <SignIn returnTo={ret} />
        <p className="auth-fine">New here or coming back, the same link gets you in.</p>
      </div>
      <aside className="auth-art" aria-hidden="true">
        <ProfileMock />
      </aside>
    </div>
  );
}

/** A same-origin return URL (maybe absolute, with our #hash) → an in-app router path. */
function inAppPath(ret: string): string {
  try {
    const u = new URL(ret, location.origin);
    if (u.origin === location.origin && u.hash.startsWith("#/")) return u.hash.slice(1);
  } catch {}
  return ret.startsWith("/") ? ret : "/";
}

/**
 * Where the back button goes: the same place we'd return to after signing in, with
 * the draft preserved — but with `send` dropped, since backing out of sign-in means
 * "let me keep writing", not "post it now". So nothing is lost and nothing auto-sends.
 */
function backPath(ret: string): string {
  const path = inAppPath(ret);
  try {
    const u = new URL(path, location.origin);
    u.searchParams.delete("send");
    return u.pathname + u.search;
  } catch {
    return path;
  }
}
