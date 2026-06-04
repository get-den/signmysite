/*
 * The data + interaction layer behind the home. One hook (useHome) loads the
 * three things the screen needs — the activity feed, your own-site analytics, and
 * who to follow — and owns the one piece of shared mutable state across all three
 * panes: the set of people you follow. The feed's read rows, the right rail's
 * "Follow back", and "Who to follow" all reflect a single follow the moment you
 * make it. Built on the feed + ranged-analytics endpoints; mock fallbacks keep a
 * brand-new account from ever looking empty.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  follow as apiFollow, getAnalytics, getDiscovery, getFeed, getFollowing, getThreads, orEmpty,
  type Analytics, type AnalyticsRange, type FeedItem, type FeedPage, type Member, type Site,
} from "../api";
import { mockDiscovery } from "../mockData";
import { useToast, useViewer } from "../providers";

/** Subscribe to a CSS media query — drives the one wide/narrow layout switch so
 *  the rail can move into the column on small screens with no DOM duplication. */
export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() =>
    typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}

export type HomeStore = {
  viewer: Member;
  // feed
  items: FeedItem[];
  digest: FeedPage["digest"] | null;
  feedLoading: boolean;
  loadMore: () => void;
  loadingMore: boolean;
  done: boolean;
  // own-site analytics (right rail), windowed by range
  analytics: Analytics | null;
  range: AnalyticsRange;
  setRange: (r: AnalyticsRange) => void;
  // who to follow
  recommended: Site[];
  // the shared follow graph
  followedIds: Set<string>;
  isFollowing: (id: string) => boolean;
  follow: (m: { id: string; name?: string | null; handle?: string | null }) => void;
};

export function useHome(viewer: Member): HomeStore {
  const toast = useToast();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [digest, setDigest] = useState<FeedPage["digest"] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [feedLoading, setFeedLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [done, setDone] = useState(false);

  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [range, setRange] = useState<AnalyticsRange>("all");

  const [recommended, setRecommended] = useState<Site[]>([]);
  const [followedIds, setFollowedIds] = useState<Set<string>>(new Set());

  // First page of the feed + the people you already follow (so read rows know
  // whether to offer "Follow back").
  useEffect(() => {
    let alive = true;
    setFeedLoading(true);
    getFeed()
      .then((page) => {
        if (!alive) return;
        setItems(page.items);
        setDigest(page.digest ?? null);
        setCursor(page.cursor);
        setDone(!page.cursor);
      })
      .catch(() => alive && setDone(true))
      .finally(() => alive && setFeedLoading(false));
    orEmpty(getFollowing()).then((sites) => alive && setFollowedIds(new Set(sites.map((s) => s.id))));
    getDiscovery()
      .then((d) => alive && setRecommended(d.recommended.length ? d.recommended : mockDiscovery.recommended))
      .catch(() => alive && setRecommended(mockDiscovery.recommended));
    return () => { alive = false; };
  }, [viewer.id]);

  // Analytics, refetched whenever the range toggle changes. Only your own verified
  // site has anything to show; before that the rail shows a setup CTA instead.
  useEffect(() => {
    if (!viewer.verified) return;
    let alive = true;
    getAnalytics(range).then((a) => alive && setAnalytics(a)).catch(() => {});
    return () => { alive = false; };
  }, [viewer.verified, range]);

  const loadMore = useCallback(() => {
    if (loadingMore || done || !cursor) return;
    setLoadingMore(true);
    getFeed(cursor)
      .then((page) => {
        setItems((cur) => cur.concat(page.items));
        setCursor(page.cursor);
        if (!page.cursor) setDone(true);
      })
      .catch(() => setDone(true))
      .finally(() => setLoadingMore(false));
  }, [cursor, loadingMore, done]);

  const follow = useCallback((m: { id: string; name?: string | null; handle?: string | null }) => {
    setFollowedIds((cur) => (cur.has(m.id) ? cur : new Set(cur).add(m.id)));
    apiFollow(m.id)
      .then(() => toast(`Following ${m.name || (m.handle ? "@" + m.handle : "them")}`))
      .catch(() => {
        setFollowedIds((cur) => { const next = new Set(cur); next.delete(m.id); return next; });
        toast("Couldn't follow. Try again.");
      });
  }, [toast]);

  const isFollowing = useCallback((id: string) => followedIds.has(id), [followedIds]);

  return {
    viewer,
    items, digest, feedLoading, loadMore, loadingMore, done,
    analytics, range, setRange,
    recommended,
    followedIds, isFollowing, follow,
  };
}

/** While a linked site is unverified, re-check the viewer whenever the tab regains
 *  focus. The widget flips the member verified the moment it loads on their site
 *  (same-origin proof), so a member who tabs out to install it returns to a rail
 *  that's already become their analytics — no button, no polling. */
export function useAutoReverify(viewer: Member): void {
  const { refreshViewer } = useViewer();
  const pending = !!viewer.url && !viewer.verified;
  useEffect(() => {
    if (!pending) return;
    const recheck = () => { if (document.visibilityState === "visible") refreshViewer(); };
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [pending, refreshViewer]);
}

/** Total unread direct messages — the badge on the Chat nav item. Refreshes on
 *  mount, on route change, and on a gentle interval (mirrors the notification bell). */
export function useUnreadCount(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      getThreads().then((cs) => alive && setN(cs.reduce((a, c) => a + c.unread, 0)), () => {});
    load();
    const timer = setInterval(() => document.visibilityState === "visible" && load(), 30000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  return n;
}

/** Auto-load the next feed page when a sentinel scrolls into the viewport. Returns
 *  a ref to put on the sentinel element at the end of the list. */
export function useInfiniteScroll(onMore: () => void, enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onMore);
  cb.current = onMore;
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const io = new IntersectionObserver(
      (entries) => entries[0]?.isIntersecting && cb.current(),
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [enabled]);
  return ref;
}

/** A loose set of feed items filtered by a free-text query (name / handle / body).
 *  Empty query returns everything. Powers the header search over the feed. */
export function filterFeed(items: FeedItem[], q: string): FeedItem[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((it) =>
    [it.actor?.name, it.actor?.handle, it.target?.name, it.target?.handle, it.body]
      .some((s) => (s || "").toLowerCase().includes(needle)));
}
