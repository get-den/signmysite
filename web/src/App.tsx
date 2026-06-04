import { useEffect } from "react";
import { Route, Routes } from "react-router-dom";
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";
import { Protected, Loading } from "./ui";
import { useViewer } from "./providers";
import { Home } from "./pages/Home";
import { Messages } from "./pages/Messages";
import { Edit } from "./pages/Edit";
import { Compose } from "./pages/Compose";
import { Reacted } from "./pages/Reacted";
import { Troubleshoot } from "./pages/Troubleshoot";
import { Auth } from "./pages/Auth";
import { Note } from "./pages/Note";
import { Verify } from "./pages/Verify";

export function App() {
  return (
    <>
      <Header />
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
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
          <Route path="/note/:id" element={<Note />} />
          <Route path="/troubleshoot" element={<Troubleshoot />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
      <Footer />
    </>
  );
}

/** The dedicated notes page is retired — comments live on your own profile now, and a
 *  notification bell covers messages. This bounces any lingering /notes link (e.g. from
 *  the home dashboard) to your profile, or home when signed out. */
function NotesRedirect() {
  const { viewer, loading } = useViewer();
  useEffect(() => {
    if (!loading) window.location.replace(viewer?.handle ? `/@${viewer.handle}` : "/");
  }, [viewer, loading]);
  return <Loading />;
}
