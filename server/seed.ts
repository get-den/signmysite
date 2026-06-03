/*
 * Seed a deterministic demo graph for local dev.
 *   npm run seed     (wipes existing data first)
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

const members = [
  { id: "den:you0000000000000", handle: "you", name: "You Example", email: "you@example.com", google_sub: "stub:you@example.com", bio: "curating quiet corners, sharp tools, and websites with taste.", url: "https://you.example" },
  { id: "den:7f3a9c2e8b1d4f6a", handle: "maya", name: "Maya Chen", bio: "tiny games, dinosaur sketches, and cheerful CSS experiments.", url: "https://maya.example" },
  { id: "den:1a2b3c4d5e6f7a8b", handle: "leo", name: "Leo Park", bio: "skateboards + stop-motion. currently obsessed with paper shadows.", url: "https://leo.example" },
  { id: "den:9f8e7d6c5b4a3210", handle: "priya", name: "Priya Nair", bio: "i make weird little synths and browser instruments.", url: "https://priya.example" },
  { id: "den:abcdef0123456789", handle: "rivera", name: "Mr. Rivera", bio: "7th grade art teacher. i reply to your zines.", url: "https://rivera.example" },
  { id: "den:aeon000000000001", handle: "aeon", name: "Aeon Atlas", bio: "visual notes on cities, signage, and gentle interfaces.", url: "https://aeon.example" },
  { id: "den:orbit0000000002", handle: "orbit", name: "Orbit Garden", bio: "a tiny directory of plants, poems, and field recordings.", url: "https://orbit.example" },
  { id: "den:pixel0000000003", handle: "pixel", name: "Pixel Pantry", bio: "recipes as zines. food photos with a grid habit.", url: "https://pixel.example" },
  { id: "den:soft00000000004", handle: "softspace", name: "Soft Space", bio: "calm productivity templates and beautiful blank pages.", url: "https://softspace.example" },
  { id: "den:noon00000000005", handle: "noon", name: "Noon Studio", bio: "one-page portfolio experiments for type lovers.", url: "https://noon.example" },
  { id: "den:glow00000000006", handle: "glowlog", name: "Glowlog", bio: "daily screenshots from delightful tools and websites.", url: "https://glowlog.example" },
  { id: "den:fern00000000007", handle: "fern", name: "Fern Club", bio: "garden notes, neighborhood maps, and old web energy.", url: "https://fern.example" },
];

const edges: [string, string, string][] = [
  ["den:you0000000000000", "den:7f3a9c2e8b1d4f6a", "friend"],
  ["den:you0000000000000", "den:1a2b3c4d5e6f7a8b", "follow"],
  ["den:you0000000000000", "den:9f8e7d6c5b4a3210", "follow"],
  ["den:you0000000000000", "den:aeon000000000001", "follow"],
  ["den:7f3a9c2e8b1d4f6a", "den:you0000000000000", "friend"],
  ["den:7f3a9c2e8b1d4f6a", "den:orbit0000000002", "follow"],
  ["den:7f3a9c2e8b1d4f6a", "den:pixel0000000003", "follow"],
  ["den:1a2b3c4d5e6f7a8b", "den:you0000000000000", "friend"],
  ["den:1a2b3c4d5e6f7a8b", "den:soft00000000004", "follow"],
  ["den:1a2b3c4d5e6f7a8b", "den:noon00000000005", "follow"],
  ["den:9f8e7d6c5b4a3210", "den:you0000000000000", "friend"],
  ["den:9f8e7d6c5b4a3210", "den:orbit0000000002", "follow"],
  ["den:aeon000000000001", "den:you0000000000000", "follow"],
  ["den:aeon000000000001", "den:glow00000000006", "follow"],
  ["den:orbit0000000002", "den:fern00000000007", "friend"],
  ["den:pixel0000000003", "den:glow00000000006", "follow"],
  ["den:noon00000000005", "den:soft00000000004", "follow"],
];

const saves: [string, string][] = [
  ["den:you0000000000000", "den:orbit0000000002"],
  ["den:you0000000000000", "den:pixel0000000003"],
  ["den:you0000000000000", "den:soft00000000004"],
  ["den:7f3a9c2e8b1d4f6a", "den:orbit0000000002"],
  ["den:7f3a9c2e8b1d4f6a", "den:pixel0000000003"],
  ["den:1a2b3c4d5e6f7a8b", "den:noon00000000005"],
  ["den:1a2b3c4d5e6f7a8b", "den:soft00000000004"],
  ["den:9f8e7d6c5b4a3210", "den:orbit0000000002"],
  ["den:9f8e7d6c5b4a3210", "den:glow00000000006"],
  ["den:aeon000000000001", "den:glow00000000006"],
  ["den:orbit0000000002", "den:fern00000000007"],
  ["den:pixel0000000003", "den:soft00000000004"],
  ["den:noon00000000005", "den:orbit0000000002"],
];

const comments = [
  { target_id: "den:you0000000000000", author_id: "den:7f3a9c2e8b1d4f6a", body: "Your link page feels like a tiny gallery wall.", visibility: "public" as const },
  { target_id: "den:you0000000000000", author_id: "den:1a2b3c4d5e6f7a8b", body: "The rounded cards are extremely snackable.", visibility: "public" as const },
  { target_id: "den:you0000000000000", author_id: "den:9f8e7d6c5b4a3210", body: "Private note: saved this for my next redesign.", visibility: "private" as const },
  { target_id: "den:orbit0000000002", author_id: "den:you0000000000000", body: "The field recording archive is beautiful.", visibility: "public" as const },
  { target_id: "den:pixel0000000003", author_id: "den:you0000000000000", body: "Recipe zines as a grid is such a good format.", visibility: "public" as const },
  { target_id: "den:soft00000000004", author_id: "den:you0000000000000", body: "Quiet, useful, and gorgeous.", visibility: "private" as const },
];

await db.reset();
for (const [index, member] of members.entries()) {
  const created = await db.createMember({
    ...member,
    avatar: avatar(member.name, index),
  });
  await db.updateMember(created.id, {
    views: 900 + index * 1370,
    thumbnail: thumb(member.name, index),
    last_edited: new Date(Date.now() - index * 36 * 60 * 60 * 1000).toISOString(),
  });
}
for (const [follower, target, rel] of edges) await db.setEdge(follower, target, rel);
for (const [member, target] of saves) await db.setSave(member, target);
for (const [index, comment] of comments.entries()) await db.addComment({ id: `c_seed_${index}`, ...comment });

console.log(`seeded ${members.length} members, ${edges.length} follows, ${saves.length} saves`);
console.log("  dev sign-in → you@example.com");
process.exit(0);
