import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import toast from "react-hot-toast";
import { getViewer, type Member } from "./api";

/* ---- viewer (the signed-in member) -------------------------------------- */

type ViewerCtx = {
  viewer: Member | null;
  loading: boolean;
  setViewer: (m: Member | null) => void;
  /** Re-fetch the signed-in member from the server (e.g. to pick up verification
   *  that was auto-detected once their widget loaded). No-op-safe on failure. */
  refreshViewer: () => Promise<void>;
};

const ViewerContext = createContext<ViewerCtx | null>(null);

export function ViewerProvider({ children }: { children: ReactNode }) {
  const [viewer, setViewer] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    getViewer()
      .then((m) => alive && setViewer(m))
      .catch(() => alive && setViewer(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const refreshViewer = useCallback(async () => {
    try { setViewer(await getViewer()); } catch { /* keep what we have */ }
  }, []);

  return (
    <ViewerContext.Provider value={{ viewer, loading, setViewer, refreshViewer }}>{children}</ViewerContext.Provider>
  );
}

export function useViewer(): ViewerCtx {
  const ctx = useContext(ViewerContext);
  if (!ctx) throw new Error("useViewer must be used within ViewerProvider");
  return ctx;
}

/* ---- toast (react-hot-toast) -------------------------------------------- */
// The <Toaster/> lives in main.tsx; call sites stay `useToast()("Saved")`.

export function useToast(): (msg: string) => void {
  return toast;
}
