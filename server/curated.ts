/*
 * The curated starter set — hand-picked recommended sites shown in every fresh feed,
 * plus the pure helpers that render their preview cards. No db import (kept pure), so
 * it is the single source of truth shared by the dev seed (server/seed.ts) and the
 * boot-time baseline (db.seedCurated, which upserts these on every deploy). Add a site
 * here and it appears for everyone — that is the whole "recommendations" surface for
 * now; a real per-member engine later just writes rows with for_id set.
 */

const svgData = (svg: string) => "data:image/svg+xml;utf8," + encodeURIComponent(svg);

// Soft card palettes: [background, accent, ink].
const palette: [string, string, string][] = [
  ["#f7d6e0", "#f2b5d4", "#111111"],
  ["#c9f2e6", "#7bd4bd", "#101820"],
  ["#dbeafe", "#93c5fd", "#0f172a"],
  ["#fde68a", "#fb923c", "#111827"],
  ["#e9d5ff", "#a78bfa", "#171717"],
  ["#cffafe", "#22d3ee", "#0f172a"],
  ["#fee2e2", "#f97316", "#111111"],
  ["#dcfce7", "#86efac", "#052e16"],
];

// A generated 1200×630 preview card — used when we don't have a site's real og:image.
export function siteCard(name: string, index: number): string {
  const [bg, accent, ink] = palette[index % palette.length];
  return svgData(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">
    <rect width="1200" height="630" fill="${bg}"/>
    <circle cx="1010" cy="150" r="150" fill="${accent}" opacity=".7"/>
    <circle cx="240" cy="520" r="190" fill="${accent}" opacity=".4"/>
    <text x="90" y="350" font-family="Inter,Arial,sans-serif" font-size="92" font-weight="800" fill="${ink}">${name}</text>
  </svg>`);
}

// A generated round avatar (initials over soft shapes) — for members with no real one.
export function initialsAvatar(name: string, index: number): string {
  const [bg, accent, ink] = palette[index % palette.length];
  const initials = name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return svgData(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">
    <rect width="160" height="160" rx="80" fill="${bg}"/>
    <circle cx="112" cy="44" r="30" fill="${accent}" opacity=".9"/>
    <circle cx="48" cy="116" r="36" fill="${accent}" opacity=".55"/>
    <text x="80" y="94" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="52" font-weight="800" fill="${ink}">${initials}</text>
  </svg>`);
}

// A site's favicon via Google's resolver — a short, always-200, cacheable URL.
export const favicon = (host: string) => `https://www.google.com/s2/favicons?domain=${host}&sz=128`;

export type Curated = {
  id: string; handle: string; name: string; url: string;
  avatar: string; thumbnail: string | null; reason: string;
};

// A live 1200×630 screenshot of a site, as a short cacheable URL. Most of these personal
// homepages expose no og:image, so a real screenshot is the truest preview (and beats the
// old generated name-card); thum.io renders + caches them server-side. Swap this one line
// to change the provider.
const SHOT = (url: string): string =>
  `https://image.thum.io/get/width/1200/crop/630/noanimate/${url}`;

// A real, stable, cacheable profile photo via GitHub — better than a site favicon for an
// individual. (Publications keep their brand favicon; folks with no GitHub use initials.)
const gh = (user: string): string => `https://github.com/${user}.png?size=200`;

// The blanket recommendation set (for_id NULL — everyone sees these). Each carries a real
// site preview (SHOT) + a favicon avatar. Stable ids so the boot baseline upserts (never
// duplicates) across deploys; db.seedCurated refreshes an unclaimed placeholder's preview
// when these change, but never overwrites a real owner who has claimed the site. Add a row
// here and it's recommended to everyone.
export const CURATED: Curated[] = [
  {
    id: "signmysite:0a1b2c3d4e5f0b77", handle: "pg", name: "Paul Graham", url: "https://paulgraham.com",
    avatar: initialsAvatar("Paul Graham", 0), thumbnail: SHOT("https://paulgraham.com"),
    reason: "Essays on startups, work, and how to think clearly.",
  },
  {
    id: "signmysite:3d4e5f6071820eaa", handle: "patrick", name: "Patrick Collison", url: "https://patrickcollison.com",
    avatar: initialsAvatar("Patrick Collison", 4), thumbnail: SHOT("https://patrickcollison.com"),
    reason: "Reading lists and big open questions, from Stripe's cofounder.",
  },
  {
    id: "signmysite:4e5f60718293afbb", handle: "notboring", name: "Not Boring", url: "https://www.notboring.co",
    avatar: favicon("notboring.co"),
    // Substack blocks headless capture (the screenshot comes back black), so use its real og:image.
    thumbnail: "https://substackcdn.com/image/fetch/$s_!Boeq!,f_auto,q_auto:best,fl_progressive:steep/https%3A%2F%2Fnotboring.substack.com%2Ftwitter%2Fsubscribe-card.jpg%3Fv%3D808001550%26version%3D9",
    reason: "Business strategy, made genuinely fun, by Packy McCormick.",
  },
  {
    id: "signmysite:5f6071829304b0cc", handle: "waitbutwhy", name: "Wait But Why", url: "https://waitbutwhy.com",
    avatar: favicon("waitbutwhy.com"), thumbnail: SHOT("https://waitbutwhy.com"),
    reason: "Long, illustrated deep-dives by Tim Urban.",
  },
  {
    id: "signmysite:60718293a4b5c1dd", handle: "thesephist", name: "Linus Lee", url: "https://thesephist.com",
    avatar: gh("thesephist"), thumbnail: SHOT("https://thesephist.com"),
    reason: "Experiments in tools for thought and AI interfaces, by Linus Lee.",
  },
  {
    id: "signmysite:718293a4b5c6d2ee", handle: "simonw", name: "Simon Willison", url: "https://simonwillison.net",
    avatar: gh("simonw"), thumbnail: SHOT("https://simonwillison.net"),
    reason: "Daily field notes on LLMs, Python, and building in the open.",
  },
  {
    id: "signmysite:8293a4b5c6d7e3ff", handle: "karpathy", name: "Andrej Karpathy", url: "https://karpathy.ai",
    avatar: gh("karpathy"), thumbnail: SHOT("https://karpathy.ai"),
    reason: "Neural nets built from scratch, and clear-eyed essays on AI.",
  },
  {
    id: "signmysite:93a4b5c6d7e8f400", handle: "ciechanowski", name: "Bartosz Ciechanowski", url: "https://ciechanow.ski",
    avatar: gh("ciechanowski"), thumbnail: SHOT("https://ciechanow.ski"),
    reason: "Mesmerizing interactive explainers of how the world works.",
  },
  {
    id: "signmysite:a4b5c6d7e8f90511", handle: "geoffreylitt", name: "Geoffrey Litt", url: "https://www.geoffreylitt.com",
    avatar: gh("geoffreylitt"), thumbnail: SHOT("https://www.geoffreylitt.com"),
    reason: "Malleable software and end-user programming as a tool for thought.",
  },
  {
    id: "signmysite:b5c6d7e8f9a01622", handle: "alanagoyal", name: "Alana Goyal", url: "https://www.alanagoyal.com",
    avatar: gh("alanagoyal"),
    // A JS desktop sim that screenshots blank, so use her own (perfectly on-brand) og:image.
    thumbnail: "https://alanagoyal.com/notes/api/og/?title=about%20me&emoji=%F0%9F%91%8B%F0%9F%8F%BC",
    reason: "Seed-stage investing, on a personal site lovingly rebuilt as iMessage.",
  },
  {
    id: "signmysite:c6d7e8f9a0b12733", handle: "wattenberger", name: "Amelia Wattenberger", url: "https://wattenberger.com",
    avatar: gh("wattenberger"), thumbnail: SHOT("https://wattenberger.com"),
    reason: "Playful, gorgeous interactive essays on design and thinking with software.",
  },
  {
    id: "signmysite:d7e8f9a0b1c23844", handle: "rauno", name: "Rauno Freiberg", url: "https://rauno.me",
    avatar: gh("raunofreiberg"), thumbnail: SHOT("https://rauno.me"),
    reason: "Interface design and the craft of small details, done exceptionally well.",
  },
  {
    id: "signmysite:e8f9a0b1c2d34955", handle: "andymatuschak", name: "Andy Matuschak", url: "https://andymatuschak.org",
    avatar: gh("andymatuschak"), thumbnail: SHOT("https://andymatuschak.org"),
    reason: "Working notes on memory, learning, and tools for thought.",
  },
  {
    id: "signmysite:f9a0b1c2d3e45a66", handle: "robinrendle", name: "Robin Rendle", url: "https://robinrendle.com",
    avatar: gh("robinrendle"), thumbnail: SHOT("https://robinrendle.com"),
    reason: "A designer and writer on typography, the web, and the joy of newsletters.",
  },
  {
    id: "signmysite:1a2b3c4d5e6f7a8b", handle: "christinacacioppo", name: "Christina Cacioppo", url: "https://www.christinacacioppo.com",
    // Minimal site: no og:image, screenshots blank, no favicon, no reliable photo — so a
    // clean generated card + initials. (When she signs up + verifies the site,
    // claimPlaceholderByUrl folds this placeholder into her real account — see db.ts.)
    avatar: initialsAvatar("Christina Cacioppo", 1), thumbnail: siteCard("Christina Cacioppo", 6),
    reason: "First-principles essays on building companies and hiring, from Vanta's founder.",
  },
];
