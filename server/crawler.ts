/*
 * The zero-setup freshness floor.
 *
 * A kid who pastes the widget and does nothing else still gets "new" badges and
 * a thumbnail: this periodically re-fetches each known site, hashes its content,
 * and bumps last_edited only when the content actually changed (so a static page
 * doesn't look "edited" on every pass). It also refreshes the og:image thumbnail.
 *
 * Off by default. Set DEN_CRAWL_MINUTES to enable (e.g. 60). Pings and me.json
 * `updated` are the precise, instant path; this is the lazy catch-all beneath them.
 */
import * as db from "./db.ts";
import { inspectSite } from "./preview.ts";

export function startCrawler(): void {
  const minutes = Number(process.env.DEN_CRAWL_MINUTES || 0);
  if (!minutes) return;
  const everyMs = Math.max(1, minutes) * 60 * 1000;
  console.log(`  crawl → every ${minutes}m (freshness + thumbnails)`);
  // Stagger the first run so boot stays fast.
  setTimeout(function tick() {
    crawlOnce().catch((e) => console.warn("[crawl] failed", e));
    setTimeout(tick, everyMs);
  }, 10_000);
}

// One pass over every site that has a URL. Sequential + gentle on purpose —
// this is a background floor, not a race.
export async function crawlOnce(): Promise<{ checked: number; changed: number }> {
  const sites = await db.listCrawlable();
  let changed = 0;
  for (const s of sites) {
    if (!s.url) continue;
    const p = await inspectSite(s.url);
    if (!p) continue;
    if (p.thumbnail) await db.setThumbnail(s.id, p.thumbnail);
    if (await db.noteContentHash(s.id, p.hash)) changed++; // bumps last_edited on real change
  }
  if (sites.length) console.log(`[crawl] checked ${sites.length}, changed ${changed}`);
  return { checked: sites.length, changed };
}
