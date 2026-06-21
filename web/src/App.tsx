import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { Protected, Loading } from "./ui";
import { profilePath, ownProfilePath } from "./lib";
import { useViewer } from "./providers";
import { LiveProvider, LiveSwitcher, LiveTicker, LiveToasts } from "./live";
import { Home } from "./pages/Home";
import { Saved } from "./pages/Saved";
import { Profile } from "./pages/Profile";
import { Messages } from "./pages/Messages";
import { Edit } from "./pages/Edit";
import { Compose } from "./pages/Compose";
import { Reacted } from "./pages/Reacted";
import { Troubleshoot } from "./pages/Troubleshoot";
import { Auth } from "./pages/Auth";
import { Verify } from "./pages/Verify";
import { Embed } from "./pages/Embed";

export function App() {
  return (
    <LiveProvider>
    <AppShell>
      <TitleSync />
      <Routes>
          <Route path="/" element={<Home />} />
          <Route
            path="/saved"
            element={
              <Protected>
                <Saved />
              </Protected>
            }
          />
          <Route
            path="/profile"
            element={
              <Protected>
                <OwnProfile />
              </Protected>
            }
          />
          {/* Anyone's profile — /@<handle>, THE profile URL (emails, the widget, and
              identity chips all point here), in the feed shell. Your own handle
              renders the owner view when signed in; logged-out visitors see the
              public profile and member actions route them to sign in. A dynamic
              segment can't carry a static @ prefix, so AtRoute peels it off. */}
          <Route path="/:at" element={<AtRoute />} />
          <Route
            path="/messages"
            element={
              <Protected>
                <Messages />
              </Protected>
            }
          />
          <Route
            path="/messages/:id"
            element={
              <Protected>
                <Messages />
              </Protected>
            }
          />
          <Route path="/notes" element={<NotesRedirect />} />
          <Route
            path="/edit"
            element={
              <Protected>
                <Edit />
              </Protected>
            }
          />
          <Route
            path="/verify"
            element={
              // Reachable mid-signup: "Add to my site" sends new members here
              // before they've picked a username, so don't require onboarding.
              <Protected requireOnboarded={false}>
                <Verify />
              </Protected>
            }
          />
          <Route
            path="/embed"
            element={
              // "All the ways to embed" — reachable mid-signup like /verify.
              <Protected requireOnboarded={false}>
                <Embed />
              </Protected>
            }
          />
          <Route path="/auth" element={<Auth />} />
          <Route path="/compose" element={<Compose />} />
          <Route path="/reacted" element={<Reacted />} />
          <Route path="/troubleshoot" element={<Troubleshoot />} />
          <Route path="*" element={<Home />} />
      </Routes>
    </AppShell>
    {/* Live activity overlays (fixed-position; each renders only as the selected
        variant) + the floating variant switcher. Outside the shell so the page
        layout rules (.shell-page > *) never touch them. */}
    <LiveToasts />
    <LiveTicker />
    <LiveSwitcher />
    </LiveProvider>
  );
}

/** Keep the tab title in step with client-side navigation. The server injects a
 *  member's full-name title into the shell it serves at /@<handle> (for link
 *  unfurls); this takes over once the user navigates within the app. */
function TitleSync() {
  const { pathname } = useLocation();
  useEffect(() => {
    const at = pathname.match(/^\/@([^/]+)$/);
    document.title = at
      ? `@${decodeURIComponent(at[1])} · signmysite`
      : "signmysite: your corner of the internet, connected";
  }, [pathname]);
  return null;
}

/** /@<handle> → the profile; any other single-segment unknown falls back to Home,
 *  matching the catch-all. (react-router params must span a whole segment.) */
function AtRoute() {
  const { at = "" } = useParams();
  return at.startsWith("@") ? <Profile handle={at.slice(1)} /> : <Home />;
}

/** /profile is your own profile, but the URL you'd share is /@<handle>. Bounce there so
 *  the address bar always shows a copy-and-send link — and so every flow that points at
 *  /profile (the nav, the avatar menu, post-save) lands on the slug. Handle-less accounts
 *  (pre-onboarding) have no slug yet, so they get the owner view in place. */
function OwnProfile() {
  const { viewer } = useViewer();
  const slug = profilePath(viewer ?? {});
  return slug ? <Navigate to={slug} replace /> : <Profile />;
}

/** The dedicated notes page is retired — comments live on your own profile now. This
 *  bounces any lingering /notes link to your shareable profile, or home when signed out. */
function NotesRedirect() {
  const { viewer, loading } = useViewer();
  if (loading) return <Loading />;
  return <Navigate to={viewer ? ownProfilePath(viewer) : "/"} replace />;
}
