/*
 * The zero-setup freshness floor.
 *
 * A kid who pastes the widget and does nothing else still gets "new" badges and
 * a thumbnail: this periodically re-fetches each known site and appends a snapshot
 * only when the content actually changed (so a static page doesn't grow a no-op
 * version on every pass). Each snapshot captures that version's thumbnail/title.
 *
 * Off by default. Set SIGNMYSITE_CRAWL_MINUTES to enable (e.g. 60). Pings and me.json
 * `updated` are the precise, instant path; this is the lazy catch-all beneath them.
 */
import * as db from "./db.ts";
import { inspectSite } from "./preview.ts";
import { notifySiteUpdated } from "./mail.ts";

export function startCrawler(): void {
  const minutes = Number(process.env.SIGNMYSITE_CRAWL_MINUTES || 0);
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
    // Refresh the live preview only on a real content change (bumps last_edited too).
    const change = await db.recordSiteContent(s.id, { hash: p.hash, thumbnail: p.thumbnail, title: p.title, excerpt: p.excerpt });
    if (change) {
      changed++;
      // Don't email on a site's very first capture — that's just initial indexing.
      if (!change.isFirst) notifySiteUpdated(change.site).catch(() => {});
    }
  }
  if (sites.length) console.log(`[crawl] checked ${sites.length}, changed ${changed}`);
  return { checked: sites.length, changed };
}
