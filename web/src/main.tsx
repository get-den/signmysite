import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { App } from "./App";
import { ViewerProvider } from "./providers";
import "../../site/app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <ViewerProvider>
        <App />
      </ViewerProvider>
      <Toaster
        position="bottom-center"
        toastOptions={{
          duration: 1800,
          style: {
            background: "#0a0a0a",
            color: "#ffffff",
            fontWeight: 600,
            fontSize: "14px",
            fontFamily: "'Sohne', system-ui, sans-serif",
            borderRadius: "999px",
            padding: "11px 18px",
            boxShadow: "0 8px 30px rgba(20, 20, 20, 0.18)",
          },
        }}
      />
    </HashRouter>
  </StrictMode>
);
