/*
 * Seed a small, deterministic demo graph for local dev.
 *   npm run seed     (wipes existing data first)
 *
 * A handful of real members with reciprocal links, so the graph is actually
 * traversable in both directions and follower counts are real.
 */
import * as db from "./db.ts";

const members = [
  { id: "den:7f3a9c2e8b1d4f6a", handle: "maya", name: "Maya", bio: "13. i draw dinosaurs and build little games.", url: "https://maya.example" },
  { id: "den:1a2b3c4d5e6f7a8b", handle: "leo", name: "Leo", bio: "skateboards + stop-motion.", url: "https://leo.example" },
  { id: "den:9f8e7d6c5b4a3210", handle: "priya", name: "Priya", bio: "i make weird little synths.", url: "https://priya.example" },
  { id: "den:abcdef0123456789", handle: "mr-rivera", name: "Mr. Rivera", bio: "7th grade art. i reply to your zines.", url: "https://rivera.example" },
];

// [follower, target, rel]
const edges: [string, string, string][] = [
  ["den:7f3a9c2e8b1d4f6a", "den:1a2b3c4d5e6f7a8b", "friend"],  // maya -> leo
  ["den:7f3a9c2e8b1d4f6a", "den:9f8e7d6c5b4a3210", "friend"],  // maya -> priya
  ["den:7f3a9c2e8b1d4f6a", "den:abcdef0123456789", "follow"],  // maya -> mr-rivera
  ["den:1a2b3c4d5e6f7a8b", "den:7f3a9c2e8b1d4f6a", "friend"],  // leo  -> maya
  ["den:9f8e7d6c5b4a3210", "den:7f3a9c2e8b1d4f6a", "friend"],  // priya-> maya
];

await db.reset();
for (const m of members) await db.createMember(m);
for (const [f, t, rel] of edges) await db.setEdge(f, t, rel);

console.log(`seeded ${members.length} members, ${edges.length} edges`);
console.log("  maya → following 3, followers 2");
process.exit(0);
