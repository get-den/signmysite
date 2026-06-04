/*
 * The logged-in home: a Twitter-style feed in a three-pane frame. One store
 * (useHome) feeds all three panes — the nav rail (left), the activity feed (center),
 * and the modular, state-aware rail (right) — and owns the single shared follow graph
 * so an action in any pane is reflected in the others at once. While a site is linked
 * but unverified, useAutoReverify quietly promotes the rail to analytics the moment
 * the widget is detected.
 */
import type { Member } from "../api";
import { FeedLayout } from "./FeedLayout";
import { Feed } from "./Feed";
import { RightRail } from "./RightRail";
import { useAutoReverify, useHome } from "./hooks";

export function HomeFeed({ viewer }: { viewer: Member }) {
  const store = useHome(viewer);
  useAutoReverify(viewer);
  return (
    <FeedLayout viewer={viewer} rail={<RightRail store={store} />}>
      <Feed store={store} />
    </FeedLayout>
  );
}
