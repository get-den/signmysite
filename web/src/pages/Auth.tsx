import { useEffect } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { legacyHashPath } from "../lib";
import { useViewer } from "../providers";
import { IconButton, Loading } from "../ui";
import { SignIn } from "../components/SignIn";
import { ProfileMock } from "../components/ProfileMock";

/**
 * The focused sign-in page (in-app /auth). Anywhere that needs a signed-in
 * member (the landing "Join now", Compose's signed-out Send, the header) sends
 * them here with ?return=, then back once they're in — so the original action
 * resumes. Continue with Google leads, magic-link email underneath; the link
 * doubles as sign-up, so one page covers join + log in.
 */
export function Auth() {
  const { viewer, loading } = useViewer();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const ret = params.get("return") || "/";
  const dest = inAppPath(ret);
  // /join/<code> is server-rendered — a client-side Navigate would hit the SPA's
  // catch-all instead of the invite page, so resume it with a full load.
  const serverPage = dest.startsWith("/join/");
  useEffect(() => {
    if (!loading && viewer && serverPage) location.replace(dest);
  }, [loading, viewer, serverPage, dest]);

  if (loading) return <Loading />;
  // Already signed in: skip the page and resume wherever we were headed.
  if (viewer) return serverPage ? <Loading /> : <Navigate to={dest} replace />;

  return (
    <div className="auth">
      <div className="auth-form">
        <IconButton icon="back" className="auth-back" onClick={() => navigate(backPath(ret))} />
        <h1 className="auth-title">Join signmysite</h1>
        <SignIn returnTo={ret} />
      </div>
      <aside className="auth-art" aria-hidden="true">
        <ProfileMock />
      </aside>
    </div>
  );
}

/** A same-origin return URL (maybe absolute, maybe a HashRouter-era #/ link) → a router path. */
function inAppPath(ret: string): string {
  try {
    const u = new URL(ret, location.origin);
    if (u.origin !== location.origin) return "/";
    if (u.hash.startsWith("#/")) return legacyHashPath(u.hash);
    return u.pathname + u.search + u.hash;
  } catch {
    return "/";
  }
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
