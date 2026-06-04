/*
 * The shell every page lives in: a viewport-locked column whose only scroll happens
 * in one inner container. The header sits above that container (so it never scrolls),
 * and each page's content is centered to the shared shell width inside it. Because the
 * header is outside the scroller, the feed's sticky rails pin exactly beneath it with
 * no magic-number offsets. The SearchProvider sits here so the header field and the
 * pages below it share one query.
 */
import type { ReactNode } from "react";
import { SearchProvider } from "../providers";
import { TopBar } from "./TopBar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SearchProvider>
      <div className="shell">
        <TopBar />
        <div className="shell-scroll">
          <div className="shell-page">{children}</div>
        </div>
      </div>
    </SearchProvider>
  );
}
