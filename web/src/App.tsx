import { Route, Routes } from "react-router-dom";
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";
import { Protected } from "./ui";
import { Home } from "./pages/Home";
import { Messages } from "./pages/Messages";
import { Notes } from "./pages/Notes";
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
          <Route
            path="/notes"
            element={
              <Protected>
                <Notes />
              </Protected>
            }
          />
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
              <Protected>
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
