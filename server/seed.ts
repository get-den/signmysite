/*
 * Seed a deterministic demo graph for local dev.
 *   npm run seed     (wipes existing data first)
 *
 * The roster is REAL personal sites, with their real og:image as the live thumbnail
 * and a favicon as the avatar — so the feed + pinned-site UIs show genuine previews
 * and the demo looks like the actual web. Two signmysite-native accounts anchor it:
 * `you` (the dev sign-in) and `maya` (the demo page's owner + widget webring).
 */
import * as db from "./db.ts";

const palette = [
  ["#f7d6e0", "#f2b5d4", "#111111"],
  ["#c9f2e6", "#7bd4bd", "#101820"],
  ["#dbeafe", "#93c5fd", "#0f172a"],
  ["#fde68a", "#fb923c", "#111827"],
  ["#e9d5ff", "#a78bfa", "#171717"],
  ["#cffafe", "#22d3ee", "#0f172a"],
  ["#fee2e2", "#f97316", "#111111"],
  ["#dcfce7", "#86efac", "#052e16"],
];
const svgData = (svg: string) => "data:image/svg+xml;utf8," + encodeURIComponent(svg);

function avatar(name: string, index: number): string {
  const [bg, accent, ink] = palette[index % palette.length];
  const initials = name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return svgData(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">
    <rect width="160" height="160" rx="80" fill="${bg}"/>
    <circle cx="112" cy="44" r="30" fill="${accent}" opacity=".9"/>
    <circle cx="48" cy="116" r="36" fill="${accent}" opacity=".55"/>
    <text x="80" y="94" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="52" font-weight="800" fill="${ink}">${initials}</text>
  </svg>`);
}
// A generated 1200×630 site preview for the .example accounts (you/maya), so even
// the fake sites lead the feed with a real-looking og:image instead of the placeholder.
function siteCard(name: string, index: number): string {
  const [bg, accent, ink] = palette[index % palette.length];
  return svgData(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">
    <rect width="1200" height="630" fill="${bg}"/>
    <circle cx="1010" cy="150" r="150" fill="${accent}" opacity=".7"/>
    <circle cx="240" cy="520" r="190" fill="${accent}" opacity=".4"/>
    <text x="90" y="350" font-family="Inter,Arial,sans-serif" font-size="92" font-weight="800" fill="${ink}">${name}</text>
  </svg>`);
}

// A site's favicon, via Google's resolver — a short, always-200, cacheable URL.
const favicon = (host: string) => `https://www.google.com/s2/favicons?domain=${host}&sz=128`;
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();

// Stable ids (signmysite:<16 hex>). `you` + `maya` keep their well-known ids (the demo
// page loads maya by hers); the rest are the real sites.
const ID = {
  you: "signmysite:you0000000000000",
  maya: "signmysite:7f3a9c2e8b1d4f6a",
  maggie: "signmysite:a9b1c0d2e3f40511",
  josh: "signmysite:b7c8d9e0f1a20622",
  lynn: "signmysite:c5d6e7f8a9b00733",
  lee: "signmysite:d3e4f5a6b7c80844",
  swyx: "signmysite:e1f2a3b4c5d60955",
  robin: "signmysite:f9a0b1c2d3e40a66",
  pg: "signmysite:0a1b2c3d4e5f0b77",
  dan: "signmysite:1b2c3d4e5f600c88",
  cassidy: "signmysite:2c3d4e5f60710d99",
  // The starter recommendation set — classic personal sites every fresh feed leads with.
  patrick: "signmysite:3d4e5f6071820eaa",
  notboring: "signmysite:4e5f60718293afbb",
  waitbutwhy: "signmysite:5f6071829304b0cc",
};

type Seed = {
  id: string; handle: string; name: string;
  email?: string; google_sub?: string; url: string;
  avatar?: string; thumb?: string | null;  // omit ⇒ generated fallback
};

const members: Seed[] = [
  { id: ID.you, handle: "you", name: "You Example", email: "you@example.com", google_sub: "stub:you@example.com", url: "https://you.example" },
  { id: ID.maya, handle: "maya", name: "Maya Chen", url: "https://maya.example" },
  { id: ID.maggie, handle: "maggie", name: "Maggie Appleton", url: "https://maggieappleton.com", avatar: favicon("maggieappleton.com"), thumb: "https://maggieappleton.com/og.png?title=Maggie+Appleton" },
  { id: ID.josh, handle: "josh", name: "Josh W. Comeau", url: "https://www.joshwcomeau.com", avatar: favicon("joshwcomeau.com"), thumb: "https://www.joshwcomeau.com/opengraph-image.png?cac0cc658da9fd03" },
  { id: ID.lynn, handle: "lynn", name: "Lynn Fisher", url: "https://lynnandtonic.com", avatar: favicon("lynnandtonic.com"), thumb: "https://lynnandtonic.com/assets/images/OG/vXIX.jpg" },
  { id: ID.lee, handle: "leerob", name: "Lee Robinson", url: "https://leerob.com", avatar: favicon("leerob.com"), thumb: "https://leerob.com/opengraph-image.png?opengraph-image.e50fc1a6.png" },
  { id: ID.swyx, handle: "swyx", name: "swyx", url: "https://www.swyx.io", avatar: favicon("swyx.io"), thumb: "https://www.swyx.io/swyx-ski.jpeg" },
  { id: ID.robin, handle: "robin", name: "Robin Sloan", url: "https://www.robinsloan.com", avatar: favicon("robinsloan.com"), thumb: "https://www.robinsloan.com/img/moonbound-top-crop-v2.jpg" },
  { id: ID.dan, handle: "dan", name: "Dan Abramov", url: "https://overreacted.io", avatar: favicon("overreacted.io"), thumb: "https://overreacted.io/opengraph-image?7c3850b1702447d4" },
  { id: ID.cassidy, handle: "cassidy", name: "Cassidy Williams", url: "https://cassidoo.co", avatar: favicon("cassidoo.co"), thumb: "https://cassidoo.co/base-card.png" },
  // paulgraham.com has no og:image — falls back to the neutral placeholder, a
  // truthful demo of that case (and the canonical minimalist personal site).
  { id: ID.pg, handle: "pg", name: "Paul Graham", url: "https://paulgraham.com", thumb: null },
  // The starter recommendation set (generated preview cards — we don't have their
  // real og:images on hand). "Patrick Coulson" read as Patrick Collison.
  { id: ID.patrick, handle: "patrick", name: "Patrick Collison", url: "https://patrickcollison.com", avatar: favicon("patrickcollison.com"), thumb: siteCard("Patrick Collison", 4) },
  { id: ID.notboring, handle: "notboring", name: "Not Boring", url: "https://www.notboring.co", avatar: favicon("notboring.co"), thumb: siteCard("Not Boring", 3) },
  { id: ID.waitbutwhy, handle: "waitbutwhy", name: "Wait But Why", url: "https://waitbutwhy.com", avatar: favicon("waitbutwhy.com"), thumb: siteCard("Wait But Why", 5) },
];

// Blanket recommendations (for_id NULL) — the curated starter set, so even a brand-new
// account's feed has something. Real per-member ranking comes later.
const recommendations: Array<[string, string]> = [
  [ID.pg, "Essays on startups, work, and how to think clearly."],
  [ID.patrick, "Reading lists and big open questions, from Stripe's cofounder."],
  [ID.notboring, "Business strategy, made genuinely fun. by Packy McCormick."],
  [ID.waitbutwhy, "Long, illustrated deep-dives by Tim Urban."],
];

// Public pins = a member's curated webring (max 3). Maya's three drive the widget demo.
const pins: [string, string][] = [
  [ID.maya, ID.maggie], [ID.maya, ID.josh], [ID.maya, ID.lynn],
  [ID.you, ID.lee], [ID.you, ID.swyx], [ID.you, ID.robin],
  [ID.maggie, ID.lynn], [ID.maggie, ID.robin],
  [ID.swyx, ID.lee], [ID.swyx, ID.dan], [ID.swyx, ID.cassidy],
];

// Follows (no rel — a follow is a follow). `you` follows maya/maggie/josh/lynn/lee/pg,
// so their activity fills `you`'s feed; and many notable accounts follow maya, filling
// her "Followed by" facepile (several are mutuals with `you`).
const edges: [string, string][] = [
  [ID.you, ID.maya], [ID.maya, ID.you],
  [ID.you, ID.maggie], [ID.you, ID.josh], [ID.you, ID.lynn], [ID.you, ID.lee], [ID.you, ID.pg],
  [ID.maya, ID.maggie], [ID.maya, ID.josh], [ID.maya, ID.lynn], [ID.maya, ID.dan], [ID.maya, ID.pg],
  [ID.maggie, ID.lynn], [ID.maggie, ID.robin],
  [ID.lee, ID.swyx], [ID.swyx, ID.lee], [ID.swyx, ID.dan],
  [ID.josh, ID.dan], [ID.cassidy, ID.swyx],
  [ID.pg, ID.maya], [ID.dan, ID.maya], [ID.swyx, ID.maya],
  [ID.lee, ID.maya], [ID.robin, ID.maya], [ID.cassidy, ID.maya], [ID.maggie, ID.maya],
  // A few accounts follow `you` that you don't follow back — the "Follow back" rail.
  [ID.cassidy, ID.you], [ID.dan, ID.you], [ID.robin, ID.you], [ID.swyx, ID.you],
];

// Manual fame tiers: 2 = famous, 1 = notable. pg + dan are famous despite modest
// seeded views, so they lead a facepile — proof the flag overrides the view heuristic.
const prominence: Array<[string, number]> = [
  [ID.pg, 2], [ID.dan, 2],
  [ID.swyx, 1], [ID.lee, 1], [ID.maggie, 1],
  [ID.lynn, 1], [ID.josh, 1], [ID.cassidy, 1], [ID.robin, 1],
];

// The activity that fills `you`'s feed: saves, notes and emoji reactions by the
// people `you` follow, plus notes left on `you`'s site — spread over a few days so
// the feed reads as a real timeline. A single-emoji note renders as a reaction.
type Act =
  | { kind: "save"; by: string; on: string; h: number }
  | { kind: "note"; by: string; on: string; body: string; h: number; vis?: "private" };
const activity: Act[] = [
  { kind: "note", by: ID.maya, on: ID.josh, body: "the little animations taught me so much.", h: 1 },
  { kind: "note", by: ID.lynn, on: ID.maya, body: "the lava-jump game is genuinely hard, i love it.", h: 2 },
  { kind: "note", by: ID.josh, on: ID.dan, body: "🔥", h: 3 },
  { kind: "save", by: ID.maggie, on: ID.robin, h: 4 },
  { kind: "note", by: ID.maggie, on: ID.maya, body: "your dinosaurs are wonderful. keep going!", h: 5 },
  { kind: "save", by: ID.maya, on: ID.maggie, h: 7 },
  { kind: "note", by: ID.lee, on: ID.swyx, body: "❤️", h: 9 },
  { kind: "note", by: ID.maya, on: ID.lynn, body: "i reload this every year just to see what it turns into.", h: 12 },
  { kind: "save", by: ID.josh, on: ID.dan, h: 15 },
  { kind: "note", by: ID.maggie, on: ID.robin, body: "✨", h: 18 },
  { kind: "note", by: ID.lynn, on: ID.josh, body: "this redesign is so clean, the typography especially.", h: 22 },
  { kind: "save", by: ID.lee, on: ID.swyx, h: 26 },
  { kind: "note", by: ID.maya, on: ID.maggie, body: "her illustrated essays made me start sketching my own ideas.", h: 31 },
  { kind: "note", by: ID.lee, on: ID.robin, body: "👏", h: 36 },
  { kind: "save", by: ID.maya, on: ID.dan, h: 40 },
  { kind: "save", by: ID.maggie, on: ID.lynn, h: 46 },
  { kind: "note", by: ID.josh, on: ID.lee, body: "the new writing is great. subscribed.", h: 52 },
  // On `you`'s own site (your feed shows these as "… on your site"):
  { kind: "note", by: ID.maggie, on: ID.you, body: "love what you're building here.", h: 6 },
  { kind: "note", by: ID.dan, on: ID.you, body: "🙌", h: 14 },
  { kind: "note", by: ID.cassidy, on: ID.you, body: "private: let's collab on something.", h: 20, vis: "private" },
];

// A short DM thread between `you` and Maya — demos the inbox + thread. Maya's land
// unread (read defaults false), so her conversation shows an unread badge.
type Dm = { id: string; from: string; to: string; body: string };
const messages: Dm[] = [
  { id: "msg_seed_0", from: ID.you, to: ID.maya, body: "Maya! Loved the dinosaur sketches on your site." },
  { id: "msg_seed_1", from: ID.maya, to: ID.you, body: "thank you!! that means a lot 🦕" },
  { id: "msg_seed_2", from: ID.maya, to: ID.you, body: "are you still adding signmysite to your site? happy to help." },
  { id: "msg_seed_3", from: ID.you, to: ID.maya, body: "yes! pasting the one line now. want to swap webrings?" },
  { id: "msg_seed_4", from: ID.maya, to: ID.you, body: "always. send me your three and I'll pin one ✨" },
];

await db.reset();
for (const [index, member] of members.entries()) {
  const { thumb, avatar: realAvatar, ...rest } = member;
  const created = await db.createMember({ ...rest, avatar: realAvatar ?? avatar(member.name, index) });
  // The demo roster is established, verified sites (real signups with the widget live).
  await db.updateMember(created.id, { views: 1200 + index * 1450, onboarded: true, verified: true });
  // Set the live thumbnail + a freshness clock (staggered so the freshest sites lead
  // the feed). Real og:image when we have one; a generated card for the .example
  // accounts; null (placeholder) for the one site that genuinely has no og:image.
  const generated = member.url.endsWith(".example") ? siteCard(member.name, index) : null;
  await db.recordSiteContent(
    created.id,
    { hash: "seed-" + created.id, thumbnail: thumb === undefined ? generated : thumb },
    hoursAgo(index * 30),
  );
}
for (const [follower, target] of edges) await db.setEdge(follower, target);
for (const [id, tier] of prominence) await db.updateMember(id, { prominence: tier });
for (const [member, target] of pins) await db.setPin(member, target);
for (const [target, reason] of recommendations) await db.addRecommendation(target, reason);
let n = 0;
for (const a of activity) {
  if (a.kind === "save") await db.setSave(a.by, a.on, hoursAgo(a.h));
  else await db.addComment({ id: `c_seed_${n++}`, target_id: a.on, author_id: a.by, body: a.body, visibility: a.vis ?? "public", created: hoursAgo(a.h) });
}
// `you`'s own saved library — the Saved gallery. (Your own saves never show in your
// own feed; this is the private collection.)
for (const t of [ID.lee, ID.swyx, ID.robin, ID.dan, ID.maggie, ID.lynn]) await db.setSave(ID.you, t);

for (const m of messages) await db.sendMessage({ id: m.id, sender_id: m.from, recipient_id: m.to, body: m.body });
await db.toggleMessageReaction("msg_seed_1", ID.you, "❤️");

// A demo crew (closed group): `you` + a few classmates, at /join/demo.
const CREW = "coh_demo000000000000";
await db.createCohort({ id: CREW, name: "Hill Valley Middle", code: "demo", ownerId: ID.you });
for (const member of [ID.maya, ID.maggie, ID.josh]) await db.addCohortMember(CREW, member);

// Page views OF `you` — the relational-analytics demo: named members (some you
// follow, some you don't) mixed with anonymous readers, each with engaged time.
const pageViews: Array<{ viewer: string | null; daysAgo: number; sec: number; ref?: string }> = [
  { viewer: ID.maggie, daysAgo: 0.2, sec: 142 },
  { viewer: ID.swyx, daysAgo: 0.5, sec: 210 },
  { viewer: ID.dan, daysAgo: 1.1, sec: 38 },
  { viewer: ID.lee, daysAgo: 2.3, sec: 167 },
  { viewer: ID.cassidy, daysAgo: 3.4, sec: 76 },
  { viewer: ID.robin, daysAgo: 4.7, sec: 51 },
  { viewer: ID.josh, daysAgo: 5.2, sec: 188 },
  { viewer: null, daysAgo: 0.1, sec: 64, ref: "news.ycombinator.com" },
  { viewer: null, daysAgo: 0.8, sec: 23 },
  { viewer: null, daysAgo: 1.9, sec: 119, ref: "google.com" },
  { viewer: null, daysAgo: 8.0, sec: 12 },
];
for (const [i, v] of pageViews.entries()) {
  await db.importView({
    target: ID.you, viewer: v.viewer, session: `seed-${v.viewer || "anon"}-${i}`,
    path: "/", referrer: v.ref ?? null, durationMs: v.sec * 1000,
    at: new Date(Date.now() - v.daysAgo * 864e5).toISOString(),
  });
}

console.log(`seeded ${members.length} members, ${edges.length} follows, ${activity.length} feed events, ${pins.length} pins`);
console.log("  dev sign-in → you@example.com");
console.log("  widget demo → maya's webring (maggie · josh · lynn)");
process.exit(0);
