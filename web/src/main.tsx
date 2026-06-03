import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { App } from "./App";
import { ViewerProvider } from "./providers";
import { TooltipProvider } from "./ui";
import "../../site/app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
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
    </HashRouter>
  </StrictMode>
);
