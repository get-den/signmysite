import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { App } from "./App";
import { ToastProvider, ViewerProvider } from "./providers";
import "../../site/app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <ToastProvider>
        <ViewerProvider>
          <App />
        </ViewerProvider>
      </ToastProvider>
    </HashRouter>
  </StrictMode>
);
