import { Route, Routes } from "react-router-dom";
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";
import { Protected } from "./ui";
import { Home } from "./pages/Home";
import { YourSite } from "./pages/YourSite";
import { Messages } from "./pages/Messages";
import { Edit } from "./pages/Edit";

export function App() {
  return (
    <>
      <Header />
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route
            path="/site"
            element={
              <Protected>
                <YourSite />
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
            path="/edit"
            element={
              <Protected>
                <Edit />
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
