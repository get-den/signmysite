/*
 * The three-pane frame for the feed experience (Home, Saved): a fixed-width nav rail,
 * a fluid center column, and an optional fixed-width right rail. It lives inside the
 * app's single scroll container, so the rails just pin with `position: sticky` — they
 * never scroll on their own. Below the 3-pane breakpoint the rails fall away: the nav
 * becomes a bottom tab bar and the right rail (if any) stacks atop the column, so the
 * same content reflows to one hand with no duplicate markup.
 */
import type { ReactNode } from "react";
import type { Member } from "../api";
import { MobileTabs, NavRail } from "./LeftNav";
import { useMediaQuery } from "./hooks";

export const WIDE = "(min-width: 1080px)";

export function FeedLayout({
  viewer, children, rail,
}: {
  viewer: Member;
  children: ReactNode;
  rail?: ReactNode;
}) {
  const wide = useMediaQuery(WIDE);
  return (
    <div className="feed-layout">
      {wide && (
        <aside className="rail-side rail-left">
          <NavRail viewer={viewer} />
        </aside>
      )}

      <main className="feed-main">
        {!wide && rail && <div className="rail-inline">{rail}</div>}
        {children}
      </main>

      {wide && rail && (
        <aside className="rail-side rail-right">
          <div className="rail-sticky">{rail}</div>
        </aside>
      )}

      {!wide && <MobileTabs viewer={viewer} />}
    </div>
  );
}
