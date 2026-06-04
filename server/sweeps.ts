/*
 * Periodic background sweeps — the time-based emails that no single request can
 * trigger. Today: the activation nudge (signed up, but the widget never went live).
 * The weekly digest will land here too (see memory: email-digest-todo).
 *
 * Off by default. Set SIGNMYSITE_SWEEP_HOURS to enable (e.g. 24). Like the crawler, this
 * is a lazy floor — the precise paths (verify, prefs) are instant.
 */
import * as db from "./db.ts";
import { notifyActivation } from "./mail.ts";

const ACTIVATION_AGE_HOURS = 24; // give a fresh signup a day before nudging

export function startSweeps(): void {
  const hours = Number(process.env.SIGNMYSITE_SWEEP_HOURS || 0);
  if (!hours) return;
  const everyMs = Math.max(1, hours) * 3600 * 1000;
  console.log(`  sweeps → every ${hours}h (activation nudges)`);
  // Stagger the first run so boot stays fast.
  setTimeout(function tick() {
    sweepActivation().catch((e) => console.warn("[sweep] activation failed", e));
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
