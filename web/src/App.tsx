import { Route, Routes } from "react-router-dom";
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";
import { Protected } from "./ui";
import { Home } from "./pages/Home";
import { Edit } from "./pages/Edit";
import { Embed } from "./pages/Embed";
import { Inbox } from "./pages/Inbox";

export function App() {
  return (
    <>
      <Header />
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route
            path="/edit"
            element={
              <Protected>
                <Edit />
              </Protected>
            }
          />
          <Route
            path="/embed"
            element={
              <Protected>
                <Embed />
              </Protected>
            }
          />
          <Route
            path="/inbox"
            element={
              <Protected>
                <Inbox />
              </Protected>
            }
          />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
      <Footer />
    </>
  );
}
