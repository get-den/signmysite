import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { getViewer, type Member } from "./api";

/* ---- viewer (the signed-in member) -------------------------------------- */

type ViewerCtx = {
  viewer: Member | null;
  loading: boolean;
  setViewer: (m: Member | null) => void;
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

  return (
    <ViewerContext.Provider value={{ viewer, loading, setViewer }}>{children}</ViewerContext.Provider>
  );
}

export function useViewer(): ViewerCtx {
  const ctx = useContext(ViewerContext);
  if (!ctx) throw new Error("useViewer must be used within ViewerProvider");
  return ctx;
}

/* ---- toast -------------------------------------------------------------- */

const ToastContext = createContext<(msg: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [text, setText] = useState("");
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const toast = useCallback((msg: string) => {
    setText(msg);
    setShow(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShow(false), 1600);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className={"toast" + (show ? " show" : "")} role="status" aria-live="polite">
        {text}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): (msg: string) => void {
  return useContext(ToastContext);
}
