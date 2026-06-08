/*
 * The public demo — "Maya's site", the page the widget tag on /widget/demo.html loads
 * (/w/7f3a9c2e8b1d4f6a.js).
 *
 * It's a fixed, hand-built fixture rather than database rows, for two reasons: the demo
 * then looks IDENTICAL everywhere — local and prod, with no seed step — and it can never
 * depend on data production doesn't have. The card mirrors what the dev seed
 * (server/seed.ts) builds for Maya — the same roster, pins, followers and notes — so the
 * seeded local graph and this fixture never drift in feel.
 *
 * Because there's no real Maya record behind it, the card is flagged `demo: true`, which
 * tells the widget to render in click-safe demo mode: every internal link or action just
 * returns the visitor to the page, instead of opening a signmysite profile/route that has
 * nothing behind it. See widget.js (demoBounce). Real pins (other people's sites) still
 * open normally — that's the webring working.
 */
import { BASE } from "./config.ts";
import { favicon, siteCard, initialsAvatar } from "./curated.ts";

// Maya's well-known id — the one /widget/demo.html embeds.
export const DEMO_ID = "signmysite:7f3a9c2e8b1d4f6a";
export const isDemo = (id: string): boolean => id === DEMO_ID;

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();

type Person = { id: string; handle: string; name: string; url: string; avatar: string; thumbnail?: string };

// The (real) personal sites Maya's card references — her pins, her commenters, and the
// notable people who follow her. Avatars are the sites' favicons (a real photo for PG),
// thumbnails are their real og:images — exactly the sources the seed uses, so the demo
// is the genuine web, not mockups.
const P: Record<string, Person> = {
  maggie: { id: "signmysite:a9b1c0d2e3f40511", handle: "maggie", name: "Maggie Appleton", url: "https://maggieappleton.com", avatar: favicon("maggieappleton.com"), thumbnail: "https://maggieappleton.com/og.png?title=Maggie+Appleton" },
  josh: { id: "signmysite:b7c8d9e0f1a20622", handle: "josh", name: "Josh W. Comeau", url: "https://www.joshwcomeau.com", avatar: favicon("joshwcomeau.com"), thumbnail: "https://www.joshwcomeau.com/opengraph-image.png?cac0cc658da9fd03" },
  lynn: { id: "signmysite:c5d6e7f8a9b00733", handle: "lynn", name: "Lynn Fisher", url: "https://lynnandtonic.com", avatar: favicon("lynnandtonic.com"), thumbnail: "https://lynnandtonic.com/assets/images/OG/vXIX.jpg" },
  lee: { id: "signmysite:d3e4f5a6b7c80844", handle: "leerob", name: "Lee Robinson", url: "https://leerob.com", avatar: favicon("leerob.com") },
  swyx: { id: "signmysite:e1f2a3b4c5d60955", handle: "swyx", name: "swyx", url: "https://www.swyx.io", avatar: favicon("swyx.io") },
  pg: { id: "signmysite:0a1b2c3d4e5f0b77", handle: "pg", name: "Paul Graham", url: "https://paulgraham.com", avatar: "https://upload.wikimedia.org/wikipedia/commons/e/e3/Paulgraham_240x320.jpg" },
  dan: { id: "signmysite:1b2c3d4e5f600c88", handle: "dan", name: "Dan Abramov", url: "https://overreacted.io", avatar: favicon("overreacted.io") },
  cassidy: { id: "signmysite:2c3d4e5f60710d99", handle: "cassidy", name: "Cassidy Williams", url: "https://cassidoo.co", avatar: favicon("cassidoo.co") },
};

// The compact identity shape the widget's facepiles + comment authors expect.
const face = (p: Person) => ({ id: p.id, name: p.name, handle: p.handle, avatar: p.avatar, url: p.url });

// The exact payload GET /api/profile/:id/card returns for a guest — so the demo widget's
// single fetch behaves identically on prod and local. Timestamps are computed per request
// so the activity always reads as recent ("2h", "5h"), never going stale.
export function demoCard() {
  return {
    profile: {
      id: DEMO_ID, handle: "maya", name: "Maya Chen", url: "https://maya.example",
      avatar: initialsAvatar("Maya Chen", 1), links: [] as string[],
      views: 2650, thumbnail: siteCard("Maya Chen", 1), lastEdited: hoursAgo(30),
    },
    stats: { views: 2650, followers: 8, following: 6, saved: 2, pinned: 3, viewerFollows: false, viewerSaved: false, viewerPinned: false },
    viewer: null,
    auth: null,
    demo: true, // render in click-safe demo mode (see widget.js)
    // Notes left ON Maya's site (newest is shown first by the widget).
    comments: [
      { id: "c_demo_0", body: "your dinosaurs are wonderful. keep going!", visibility: "public", created: hoursAgo(5), redacted: false, author: face(P.maggie) },
      { id: "c_demo_1", body: "the lava-jump game is genuinely hard, i love it.", visibility: "public", created: hoursAgo(2), redacted: false, author: face(P.lynn) },
    ],
    // Maya's pinned webring (maggie · josh · lynn), each with her own note bubble.
    pinned: [
      { ...face(P.maggie), thumbnail: P.maggie.thumbnail, notes: [{ id: "n_demo_0", body: "her illustrated essays made me start sketching my own ideas.", created: hoursAgo(31) }] },
      { ...face(P.josh), thumbnail: P.josh.thumbnail, notes: [{ id: "n_demo_1", body: "the little animations taught me so much.", created: hoursAgo(1) }] },
      { ...face(P.lynn), thumbnail: P.lynn.thumbnail, notes: [{ id: "n_demo_2", body: "i reload this every year just to see what it turns into.", created: hoursAgo(12) }] },
    ],
    // "Followed by Paul Graham, Dan Abramov +6" — notable followers lead the facepile.
    followedBy: { faces: [face(P.pg), face(P.dan), face(P.cassidy), face(P.swyx), face(P.lee)], total: 8 },
    mutuals: { faces: [] as ReturnType<typeof face>[], total: 0 },
    script: `${BASE}/w/${DEMO_ID.replace(/^signmysite:/, "")}.js`,
  };
}
