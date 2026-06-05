import { useEffect } from "react";
import { Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { Protected, Loading } from "./ui";
import { useViewer } from "./providers";
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

export function App() {
  return (
    <AppShell>
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
                <Profile />
              </Protected>
            }
          />
          {/* Anyone's profile, in the feed shell (the Twitter layout). Your own handle
              renders the owner view; the public, server-rendered /@handle stays for
              logged-out visitors + crawlers. */}
          <Route
            path="/u/:handle"
            element={
              <Protected>
                <Profile />
              </Protected>
            }
          />
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
          <Route path="/auth" element={<Auth />} />
          <Route path="/compose" element={<Compose />} />
          <Route path="/reacted" element={<Reacted />} />
          <Route path="/troubleshoot" element={<Troubleshoot />} />
          <Route path="*" element={<Home />} />
      </Routes>
    </AppShell>
  );
}

/** The dedicated notes page is retired — comments live on your own profile now. This
 *  bounces any lingering /notes link to your in-app profile, or home when signed out. */
function NotesRedirect() {
  const { viewer, loading } = useViewer();
  useEffect(() => {
    if (!loading) window.location.replace(viewer ? "/#/profile" : "/");
  }, [viewer, loading]);
  return <Loading />;
}
