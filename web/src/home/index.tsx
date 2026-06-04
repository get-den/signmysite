/*
 * The logged-in home. One data hook (useHomeData) feeds four interchangeable
 * layouts, each a different answer to "what is this page for": Brief (a daily
 * check-in), Stream (a thread to triage), Orbit (your place in the graph), Gallery
 * (a wall of sites to browse). The choice persists, and "Surprise me" hands you a
 * different one. The verify nudge sits above the switcher so it's never lost in a
 * particular layout.
 */
import { useEffect, useState, type ComponentType } from "react";
import type { Member } from "../api";
import { useHomeData, type HomeData } from "./data";
import { VerifyNotice } from "./parts";
import { Switcher } from "./Switcher";
import { Console } from "./Console";
import { Spotlight } from "./Spotlight";
import { Brief } from "./Brief";
import { Stream } from "./Stream";
import { Orbit } from "./Orbit";
import { Gallery } from "./Gallery";

export type LayoutId = "console" | "spotlight" | "brief" | "stream" | "orbit" | "gallery";
export type LayoutMeta = { id: LayoutId; label: string; blurb: string };

const LAYOUTS: Array<LayoutMeta & { Component: ComponentType<{ data: HomeData }> }> = [
  { id: "console", label: "Console", blurb: "Your site at a glance. Views, visitors this week, new comments and saves — or a prompt to add your site.", Component: Console },
  { id: "spotlight", label: "Spotlight", blurb: "The same numbers, staged around one dominant figure: your total reach.", Component: Spotlight },
  { id: "brief", label: "Brief", blurb: "Today, in one calm column. The single thing worth doing, then your numbers.", Component: Brief },
  { id: "stream", label: "Stream", blurb: "Every signal around your site as one thread. Read it top to bottom, clear it.", Component: Stream },
  { id: "orbit", label: "Orbit", blurb: "Your place in the graph. You at the center, your people in rings around you.", Component: Orbit },
  { id: "gallery", label: "Gallery", blurb: "Just the sites. A wall of personal pages to browse, pin and collect.", Component: Gallery },
];

const STORE_KEY = "signmysite:home-layout";

function readStored(): LayoutId {
  try {
    const v = localStorage.getItem(STORE_KEY) as LayoutId | null;
    if (v && LAYOUTS.some((l) => l.id === v)) return v;
  } catch { /* private mode / no storage — fall through */ }
  return "console";
}

export function HomeExperience({ viewer }: { viewer: Member }) {
  const data = useHomeData(viewer);
  const [layout, setLayout] = useState<LayoutId>(readStored);

  useEffect(() => {
    try { localStorage.setItem(STORE_KEY, layout); } catch { /* ignore */ }
  }, [layout]);

  const current = LAYOUTS.find((l) => l.id === layout) ?? LAYOUTS[0];
  const Active = current.Component;

  // Hand the user a layout they're not already on.
  const shuffle = () => {
    const others = LAYOUTS.filter((l) => l.id !== layout);
    setLayout(others[Math.floor(Math.random() * others.length)].id);
  };

  return (
    <div className="home">
      <VerifyNotice viewer={viewer} />
      <Switcher layouts={LAYOUTS} value={layout} blurb={current.blurb} onChange={setLayout} onShuffle={shuffle} />
      {/* key re-mounts on switch so each layout plays its own entrance. */}
      <div className="home-stage" key={layout}>
        <Active data={data} />
      </div>
    </div>
  );
}
