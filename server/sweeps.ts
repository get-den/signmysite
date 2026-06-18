/*
 * Periodic background sweeps — the time-based emails that no single request can
 * trigger. Today: the activation nudge (signed up, but the widget never went live)
 * and the weekly views digest ("N people viewed your site last week").
 *
 * Off by default. Set SIGNMYSITE_SWEEP_HOURS to enable (e.g. 24). Like the crawler, this
 * is a lazy floor — the precise paths (verify, prefs) are instant.
 */
import * as db from "./db.ts";
import { notifyActivation, notifyViewsDigest } from "./mail.ts";

const ACTIVATION_AGE_HOURS = 24; // give a fresh signup a day before nudging

export function startSweeps(): void {
  const hours = Number(process.env.SIGNMYSITE_SWEEP_HOURS || 0);
  if (!hours) return;
  const everyMs = Math.max(1, hours) * 3600 * 1000;
  console.log(`  sweeps → every ${hours}h (activation nudges, weekly views digest)`);
  // Stagger the first run so boot stays fast.
  setTimeout(function tick() {
    sweepActivation().catch((e) => console.warn("[sweep] activation failed", e));
    sweepViewsDigest().catch((e) => console.warn("[sweep] views digest failed", e));
    setTimeout(tick, everyMs);
  }, 30_000);
}

// One pass: nudge each un-activated member exactly once. markNotified is the guard,
// claimed BEFORE sending so a slow/duplicated pass can't double-email anyone.
export async function sweepActivation(): Promise<number> {
  const before = new Date(Date.now() - ACTIVATION_AGE_HOURS * 3600 * 1000).toISOString();
  const members = await db.listUnactivated(before);
  let sent = 0;
  for (const m of members) {
    if (await db.markNotified(m.id, "activation")) { await notifyActivation(m); sent++; }
  }
  if (members.length) console.log(`[sweep] activation: ${sent}/${members.length} nudged`);
  return sent;
}

// The calendar key that makes the digest at-most-weekly: viewsDigest:<Monday of the
// current week, UTC>. Every sweep tick tries, but markNotified on this key lets only
// the first attempt in a given week actually send — the email goes out on the week's
// first tick, then the key blocks repeats until Monday rolls the key over.
const digestWeekKey = (at = new Date()): string => {
  const d = new Date(at);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // back to Monday
  return `viewsDigest:${d.toISOString().slice(0, 10)}`;
};

// One pass: the weekly views recap, for members whose site was actually viewed in
// the trailing week. The no-spam ledger — each rule and where it's enforced:
//   · only sites with ≥1 real view (listViewedSince; self-views never reach page_views)
//   · at most one email per calendar week (markNotified on digestWeekKey, claimed
//     BEFORE sending — same exactly-once shape as the activation nudge)
//   · prefs-gated + one-click unsubscribe (notifyViewsDigest / its List-Unsubscribe)
export async function sweepViewsDigest(): Promise<number> {
  const key = digestWeekKey();
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const members = await db.listViewedSince(since, key);
  let sent = 0;
  for (const m of members) {
    if (!db.wantsNotify(m, "viewsDigest")) continue;
    if (!(await db.markNotified(m.id, key))) continue;
    const digest = await db.analytics(m.id, "week");
    if (!digest.visitors) continue; // raced to zero since the list query — stay silent
    await notifyViewsDigest(m, digest);
    sent++;
  }
  if (members.length) console.log(`[sweep] views digest: ${sent}/${members.length} sent`);
  return sent;
}
