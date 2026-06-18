import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { App } from "./App";
import { legacyHashPath } from "./lib";
import { ViewerProvider } from "./providers";
import { TooltipProvider } from "./ui";
import "../../site/app.css";
import "./home/home.css";

// The app routed by hash (/#/u/justin, /#/edit) until mid-2026; those links live
// on in sent emails and bookmarks. Translate them to real paths before the router
// mounts. (#comment-<id> deep links don't start with "#/" and pass through.)
if (location.hash.startsWith("#/")) {
  history.replaceState(null, "", legacyHashPath(location.hash));
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <TooltipProvider delayDuration={150}>
        <ViewerProvider>
          <App />
        </ViewerProvider>
      </TooltipProvider>
      <Toaster
        position="bottom-center"
        toastOptions={{
          style: {
            background: "#ffffff",
            color: "#0a0a0a",
            border: "1px solid #ececec",
            fontFamily: "'Sohne', system-ui, sans-serif",
            fontWeight: 600,
            fontSize: "14px",
            lineHeight: "1.2",
            borderRadius: "999px",
            padding: "10px 18px",
            boxShadow: "0 8px 30px rgba(20, 20, 20, 0.12)",
          },
        }}
      />
    </BrowserRouter>
  </StrictMode>
);
