/*
 * One hook that backs every home layout. The four layouts are different *views*
 * of the same graph, so the data + the actions live here once and each layout
 * just arranges them. Loads in parallel on mount, keeps a mock fallback so a
 * brand-new den never looks empty, and exposes optimistic actions (follow back,
 * pin, make a crew) the layouts call directly.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError, createCohort, follow, getAnalytics, getCohorts, getDiscovery,
  getFollowing, getInbox, getPinned, getStats, orEmpty, togglePin,
  type Analytics, type Cohort, type Discovery, type InboxNote, type Member,
  type PinnedSite, type Site, type Stats, type ViewerVisit,
} from "../api";
import { mockDiscovery, mockFollowing } from "../mockData";
import { useToast } from "../providers";

export const PIN_LIMIT = 3;

/** The unified activity model behind the Stream layout: every meaningful thing
 *  that happened around your site, collapsed to one shape so it sorts into a
 *  single timeline. */
export type HomeEvent =
  | { kind: "read"; at: string; who: ViewerVisit }
  | { kind: "note"; at: string; note: InboxNote }
  | { kind: "update"; at: string; site: Site };

export type HomeData = {
  viewer: Member;
  stats: Stats | null;
  analytics: Analytics | null;
  notes: InboxNote[];
  following: Site[];
  discovery: Discovery;
  pinned: PinnedSite[];
  crews: Cohort[] | null;

  /** Ids the viewer has pinned (for the gallery's pin toggles). */
  pinnedIds: Set<string>;
  /** Followed + discovered sites, de-duplicated — the gallery's "everything" set. */
  allSites: Site[];
  /** Den members who read you and you don't follow back yet — the recurring hero. */
  unfollowedReaders: ViewerVisit[];
  /** Sites you follow that changed since you last looked. */
  freshFollows: Site[];
  /** The single reverse-chron activity timeline. */
  events: HomeEvent[];

  followBack: (v: Pick<ViewerVisit, "id" | "name" | "handle">) => Promise<void>;
  togglePinSite: (site: Site) => Promise<void>;
  makeCrew: (name: string) => Promise<Cohort | null>;
};

function dedupe(sites: Site[]): Site[] {
  const seen = new Set<string>();
  return sites.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
}

export function useHomeData(viewer: Member): HomeData {
  const [stats, setStats] = useState<Stats | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [notes, setNotes] = useState<InboxNote[]>([]);
  const [following, setFollowing] = useState<Site[]>(mockFollowing);
  const [discovery, setDiscovery] = useState<Discovery>(mockDiscovery);
  const [pinned, setPinned] = useState<PinnedSite[]>([]);
  const [crews, setCrews] = useState<Cohort[] | null>(null);
  const toast = useToast();

  useEffect(() => {
    let alive = true;
    const keep = <T,>(fn: (v: T) => void) => (v: T) => { if (alive) fn(v); };
    getStats(viewer.id).then(keep(setStats)).catch(() => {});
    getAnalytics().then(keep(setAnalytics)).catch(() => {});
    orEmpty(getInbox()).then(keep(setNotes));
    orEmpty(getFollowing()).then((s) => alive && setFollowing(s.length ? s : mockFollowing));
    getDiscovery().then(keep(setDiscovery)).catch(() => {});
    orEmpty(getPinned()).then(keep(setPinned));
    orEmpty(getCohorts()).then(keep(setCrews));
    return () => { alive = false; };
  }, [viewer.id]);

  // Flip the reader's row to "Following" everywhere it shows, then confirm; on
  // failure, roll the row back. One source (analytics.recent) feeds Brief, Stream
  // and Orbit, so a single update keeps all three honest.
  const followBack = useCallback(async (v: Pick<ViewerVisit, "id" | "name" | "handle">) => {
    const flip = (on: boolean) =>
      setAnalytics((a) => a && { ...a, recent: a.recent.map((r) => r.id === v.id ? { ...r, viewerFollows: on } : r) });
    flip(true);
    try {
      await follow(v.id);
      toast(`Following ${v.name || (v.handle ? "@" + v.handle : "them")}`);
    } catch {
      flip(false);
      toast("Couldn't follow. Try again.");
    }
  }, [toast]);

  // Toggle a pin, then re-sync from the server (authoritative order + limit). A
  // rejected 4th pin (409) becomes a gentle nudge rather than a silent no-op.
  const togglePinSite = useCallback(async (site: Site) => {
    try {
      await togglePin(site.id);
      setPinned(await getPinned());
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) toast(`Pin up to ${PIN_LIMIT}. Unpin one first.`);
      else toast("Couldn't update pin.");
    }
  }, [toast]);

  const makeCrew = useCallback(async (name: string): Promise<Cohort | null> => {
    const n = name.trim();
    if (!n) return null;
    try {
      const crew = await createCohort(n);
      setCrews((cur) => [crew, ...(cur ?? [])]);
      toast("Crew created. Share the invite link.");
      return crew;
    } catch {
      toast("Couldn't create the crew. Try again.");
      return null;
    }
  }, [toast]);

  const pinnedIds = useMemo(() => new Set(pinned.map((p) => p.id)), [pinned]);
  const allSites = useMemo(
    () => dedupe([...pinned, ...following, ...discovery.recommended, ...discovery.mostSaved, ...discovery.saved]),
    [pinned, following, discovery],
  );
  const unfollowedReaders = useMemo(
    () => (analytics?.recent ?? []).filter((v) => !v.viewerFollows),
    [analytics],
  );
  const freshFollows = useMemo(() => following.filter((s) => s.isNew), [following]);

  // The timeline: reads + notes + follow-updates, newest first. Each carries the
  // timestamp the layout shows ("3h"), so sorting and display read from one field.
  const events = useMemo<HomeEvent[]>(() => {
    const out: HomeEvent[] = [];
    for (const who of analytics?.recent ?? []) out.push({ kind: "read", at: who.lastSeen, who });
    for (const note of notes) out.push({ kind: "note", at: note.created, note });
    for (const site of following) if (site.isNew) out.push({ kind: "update", at: site.lastEdited || "", site });
    return out.sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
  }, [analytics, notes, following]);

  return {
    viewer, stats, analytics, notes, following, discovery, pinned, crews,
    pinnedIds, allSites, unfollowedReaders, freshFollows, events,
    followBack, togglePinSite, makeCrew,
  };
}

/** First name for greetings ("Good morning, Ben."). Falls back to the handle. */
export function firstName(viewer: Member): string {
  const n = (viewer.name || "").trim().split(/\s+/)[0];
  return n || viewer.handle || "you";
}
