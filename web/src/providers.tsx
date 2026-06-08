import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
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

/* ---- search (header field → current view) ------------------------------- */
// One shared query string the header writes and the feed / saved gallery read, so
// the prominent search bar filters whatever you're looking at. Deliberately tiny —
// there's no search endpoint; it narrows the items already on screen.

type SearchCtx = { q: string; setQ: (q: string) => void };
const SearchContext = createContext<SearchCtx | null>(null);

export function SearchProvider({ children }: { children: ReactNode }) {
  const [q, setQ] = useState("");
  const value = useMemo(() => ({ q, setQ }), [q]);
  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>;
}

export function useSearch(): SearchCtx {
  const ctx = useContext(SearchContext);
  if (!ctx) throw new Error("useSearch must be used within SearchProvider");
  return ctx;
}

/* ---- toast (react-hot-toast) -------------------------------------------- */
// The <Toaster/> lives in main.tsx; call sites stay `useToast()("Saved")`.
// We give every toast a leading emoji, chosen from the message itself, so a
// "Saved" reads ✅ and a failure reads ⚠️ — no call site has to pass an icon.

const TOAST_EMOJI: [RegExp, string][] = [
  [/couldn'?t|error|fail|try again|wrong|taken|too|can'?t/i, "⚠️"],
  [/photo|image/i, "📸"],
  [/follow/i, "👋"],
  [/hidden|not interested|won'?t show/i, "🙈"],
  [/sav|updat|verif|done|linked|pinned/i, "✅"],
];

function toastEmoji(msg: string): string {
  for (const [re, emoji] of TOAST_EMOJI) if (re.test(msg)) return emoji;
  return "✨";
}

export function useToast(): (msg: string) => void {
  return useCallback((msg: string) => { toast(msg, { icon: toastEmoji(msg) }); }, []);
}
