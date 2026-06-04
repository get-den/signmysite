/*
 * Seed a deterministic demo graph for local dev.
 *   npm run seed     (wipes existing data first)
 *
 * The roster is REAL personal sites, with their real og:image as the live
 * thumbnail and a favicon as the avatar — so the pinned-site UIs (the widget's
 * webring) show genuine previews, and the demo looks like the actual web. Two
 * Den-native accounts anchor it: `you` (the dev sign-in) and `maya` (the demo
 * page's owner, whose widget shows her pinned webring).
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

function svgData(svg: string): string {
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

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

function thumb(title: string, index: number): string {
  const [bg, accent, ink] = palette[index % palette.length];
  const shape = index % 3;
  return svgData(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 640">
    <rect width="960" height="640" rx="44" fill="${bg}"/>
    <rect x="52" y="52" width="856" height="536" rx="36" fill="#ffffff" opacity=".5"/>
    ${shape === 0 ? `<circle cx="704" cy="210" r="134" fill="${accent}"/><rect x="104" y="340" width="448" height="56" rx="28" fill="${ink}"/><rect x="104" y="424" width="304" height="34" rx="17" fill="${ink}" opacity=".52"/>` : ""}
    ${shape === 1 ? `<rect x="120" y="116" width="336" height="336" rx="60" fill="${accent}"/><rect x="512" y="154" width="276" height="46" rx="23" fill="${ink}"/><rect x="512" y="238" width="348" height="32" rx="16" fill="${ink}" opacity=".45"/><rect x="512" y="298" width="250" height="32" rx="16" fill="${ink}" opacity=".3"/>` : ""}
    ${shape === 2 ? `<path d="M154 442C278 194 408 172 542 300s204 90 300-122v312H154z" fill="${accent}"/><circle cx="232" cy="156" r="74" fill="${ink}" opacity=".85"/>` : ""}
    <text x="104" y="552" font-family="Inter,Arial,sans-serif" font-size="38" font-weight="800" fill="${ink}">${title}</text>
  </svg>`);
}

// A site's favicon, via Google's resolver — a short, always-200, cacheable URL.
const favicon = (host: string) => `https://www.google.com/s2/favicons?domain=${host}&sz=128`;

// Stable ids (den:<16 hex>). `you` + `maya` keep their well-known ids (the demo
// page loads maya by hers); the rest are the real sites.
const ID = {
  you: "den:you0000000000000",
  maya: "den:7f3a9c2e8b1d4f6a",
  maggie: "den:a9b1c0d2e3f40511",
  josh: "den:b7c8d9e0f1a20622",
  lynn: "den:c5d6e7f8a9b00733",
  lee: "den:d3e4f5a6b7c80844",
  swyx: "den:e1f2a3b4c5d60955",
  robin: "den:f9a0b1c2d3e40a66",
  pg: "den:0a1b2c3d4e5f0b77",
  dan: "den:1b2c3d4e5f600c88",
  cassidy: "den:2c3d4e5f60710d99",
};

type Seed = {
  id: string; handle: string; name: string;
  email?: string; google_sub?: string; url: string;
  // Real avatar + og:image. Omitted ⇒ a generated SVG fallback (you/maya), or for
  // a site that genuinely has no og:image (paulgraham.com), the placeholder.
  avatar?: string; thumb?: string | null;
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
  // paulgraham.com has no og:image — left to fall back to the neutral placeholder,
  // a truthful demo of that case (and the canonical minimalist personal site). No
  // avatar either, so the generated "PG" tile leads his (prominent) facepile face.
  { id: ID.pg, handle: "pg", name: "Paul Graham", url: "https://paulgraham.com", thumb: null },
];

// Public pins = a member's curated webring (max 3). Maya's three drive the widget
// demo, so they're the most visual real og:images; `you` and a couple of others
// pin too, so every profile's showcase has something.
const pins: [string, string][] = [
  [ID.maya, ID.maggie], [ID.maya, ID.josh], [ID.maya, ID.lynn],
  [ID.you, ID.lee], [ID.you, ID.swyx], [ID.you, ID.robin],
  [ID.maggie, ID.lynn], [ID.maggie, ID.robin],
  [ID.swyx, ID.lee], [ID.swyx, ID.dan], [ID.swyx, ID.cassidy],
];

const edges: [string, string, string][] = [
  [ID.you, ID.maya, "friend"], [ID.maya, ID.you, "friend"],
  [ID.you, ID.maggie, "follow"], [ID.you, ID.josh, "follow"], [ID.you, ID.lynn, "follow"], [ID.you, ID.lee, "follow"], [ID.you, ID.pg, "follow"],
  [ID.maya, ID.maggie, "follow"], [ID.maya, ID.josh, "follow"], [ID.maya, ID.lynn, "follow"], [ID.maya, ID.dan, "follow"], [ID.maya, ID.pg, "follow"],
  [ID.maggie, ID.lynn, "friend"], [ID.maggie, ID.robin, "follow"],
  [ID.lee, ID.swyx, "follow"], [ID.swyx, ID.lee, "follow"], [ID.swyx, ID.dan, "follow"],
  [ID.josh, ID.dan, "follow"], [ID.cassidy, ID.swyx, "follow"],
  // Notable accounts following Maya — fills her "Followed by" facepile. Several
  // (pg, lee, maggie) are people `you` also follow, so the signed-in view of her
  // card additionally shows the "… you follow" mutuals row.
  [ID.pg, ID.maya, "follow"], [ID.dan, ID.maya, "follow"], [ID.swyx, ID.maya, "follow"],
  [ID.lee, ID.maya, "follow"], [ID.robin, ID.maya, "follow"], [ID.cassidy, ID.maya, "follow"], [ID.maggie, ID.maya, "follow"],
];

// Manual fame tiers (the prominence enum) — what ranks the "Followed by" facepile.
// pg + dan are 'famous' despite modest seeded views, so they lead the pile: a clean
// demo that the flag overrides the page-view heuristic. Set by hand in real life,
// e.g. UPDATE members SET prominence='famous' WHERE handle='pg'.
const prominence: Array<[string, "notable" | "famous"]> = [
  [ID.pg, "famous"], [ID.dan, "famous"],
  [ID.swyx, "notable"], [ID.lee, "notable"], [ID.maggie, "notable"],
  [ID.lynn, "notable"], [ID.josh, "notable"], [ID.cassidy, "notable"], [ID.robin, "notable"],
];

const saves: [string, string][] = [
  [ID.you, ID.lee], [ID.you, ID.swyx], [ID.you, ID.robin], [ID.you, ID.dan],
  [ID.maya, ID.maggie], [ID.maya, ID.lynn], [ID.maya, ID.dan],
  [ID.maggie, ID.robin], [ID.swyx, ID.cassidy], [ID.josh, ID.dan],
];

type Comment = { target_id: string; author_id: string; body: string; visibility: "public" | "private" };
const comments: Comment[] = [
  // Maya's own public notes on her pinned sites — the bubble shown under each pin
  // on her public profile (the widget keeps its pins clean and omits these).
  { target_id: ID.maggie, author_id: ID.maya, body: "her illustrated essays made me start sketching my own ideas.", visibility: "public" },
  { target_id: ID.lynn, author_id: ID.maya, body: "i reload this every year just to see what it turns into.", visibility: "public" },
  { target_id: ID.josh, author_id: ID.maya, body: "the little animations taught me so much.", visibility: "public" },
  // A few notes left ON Maya's site (her widget's feed, under the webring).
  { target_id: ID.maya, author_id: ID.maggie, body: "your dinosaurs are wonderful. keep going!", visibility: "public" },
  { target_id: ID.maya, author_id: ID.you, body: "🔥", visibility: "public" },
  { target_id: ID.maya, author_id: ID.lynn, body: "the lava-jump game is genuinely hard, i love it.", visibility: "public" },
  { target_id: ID.maya, author_id: ID.dan, body: "private note: saving this for inspiration.", visibility: "private" },
];

// A short DM back-and-forth between `you` and Maya — demos the messages inbox +
// thread. Maya's land unread (the `read` flag defaults false), so her conversation
// shows an unread badge until `you` open it.
type Dm = { id: string; from: string; to: string; body: string };
const messages: Dm[] = [
  { id: "msg_seed_0", from: ID.you, to: ID.maya, body: "Maya! Loved the dinosaur sketches on your site." },
  { id: "msg_seed_1", from: ID.maya, to: ID.you, body: "thank you!! that means a lot 🦕" },
  { id: "msg_seed_2", from: ID.maya, to: ID.you, body: "are you still adding Den to your site? happy to help." },
  { id: "msg_seed_3", from: ID.you, to: ID.maya, body: "yes — pasting the one line now. want to swap webrings?" },
  { id: "msg_seed_4", from: ID.maya, to: ID.you, body: "always. send me your three and I'll pin one ✨" },
];

await db.reset();
for (const [index, member] of members.entries()) {
  const { thumb: ogImage, avatar: realAvatar, ...rest } = member;
  const created = await db.createMember({ ...rest, avatar: realAvatar ?? avatar(member.name, index) });
  await db.updateMember(created.id, { views: 1200 + index * 1450 });
  // Seed an initial version: sets the live thumbnail + last_edited (staggered so
  // the "freshest" sites sort to the top of the demo feed). A real og:image when
  // we have one, else the generated tile (or, for `thumb: null`, no thumbnail —
  // the UI falls back to its placeholder).
  const capturedAt = new Date(Date.now() - index * 30 * 60 * 60 * 1000).toISOString();
  await db.recordSnapshot(created.id, {
    hash: "seed-" + created.id,
    thumbnail: ogImage === undefined ? thumb(member.name, index) : ogImage,
    title: member.name,
    excerpt: null,
  }, capturedAt);
}
for (const [follower, target, rel] of edges) await db.setEdge(follower, target, rel);
for (const [id, tier] of prominence) await db.updateMember(id, { prominence: tier });
for (const [member, target] of saves) await db.setSave(member, target);
for (const [member, target] of pins) await db.setPin(member, target);
for (const [index, comment] of comments.entries()) await db.addComment({ id: `c_seed_${index}`, ...comment });
for (const m of messages) await db.sendMessage({ id: m.id, sender_id: m.from, recipient_id: m.to, body: m.body });
await db.toggleMessageReaction("msg_seed_1", ID.you, "❤️"); // `you` ❤️ Maya's thank-you — shows a reaction chip on load

// A demo crew (a closed group): `you` + a few classmates, reachable at /join/demo
// with a fixed, memorable code. createCohort seats `you` as owner; the rest join
// as members. (They already follow each other via the seeded edges above, so no
// extra wiring is needed for the demo.)
const CREW = "coh_demo000000000000";
await db.createCohort({ id: CREW, name: "Hill Valley Middle", code: "demo", ownerId: ID.you });
for (const member of [ID.maya, ID.maggie, ID.josh]) await db.addCohortMember(CREW, member);

// Page views OF "you", to populate the relational analytics demo: named Den members
// (some you already follow, some you don't — the "follow back" nudge) mixed with
// anonymous readers, each with an engaged-time estimate and a recent timestamp.
const YOU = ID.you;
const pageViews: Array<{ viewer: string | null; daysAgo: number; sec: number; ref?: string }> = [
  { viewer: ID.maggie, daysAgo: 0.2, sec: 142 }, // Maggie — you follow
  { viewer: ID.swyx, daysAgo: 0.5, sec: 210 },   // swyx — you DON'T follow back
  { viewer: ID.dan, daysAgo: 1.1, sec: 38 },     // Dan — you DON'T follow back
  { viewer: ID.lee, daysAgo: 2.3, sec: 167 },    // Lee — you follow
  { viewer: ID.cassidy, daysAgo: 3.4, sec: 76 }, // Cassidy — you DON'T follow back
  { viewer: ID.robin, daysAgo: 4.7, sec: 51 },   // Robin — you DON'T follow back
  { viewer: ID.josh, daysAgo: 5.2, sec: 188 },   // Josh — you follow
  { viewer: null, daysAgo: 0.1, sec: 64, ref: "news.ycombinator.com" },
  { viewer: null, daysAgo: 0.8, sec: 23 },
  { viewer: null, daysAgo: 1.9, sec: 119, ref: "google.com" },
  { viewer: null, daysAgo: 8.0, sec: 12 },
];
for (const [i, v] of pageViews.entries()) {
  await db.importView({
    target: YOU,
    viewer: v.viewer,
    session: `seed-${v.viewer || "anon"}-${i}`,
    path: "/",
    referrer: v.ref ?? null,
    durationMs: v.sec * 1000,
    at: new Date(Date.now() - v.daysAgo * 864e5).toISOString(),
  });
}

console.log(`seeded ${members.length} members, ${edges.length} follows, ${saves.length} saves, ${pins.length} pins, ${pageViews.length} views`);
console.log("  dev sign-in → you@example.com");
console.log("  widget demo → maya's webring (maggie · josh · lynn)");
console.log("  crew invite → /join/demo (Hill Valley Middle · 4 sites)");
process.exit(0);
