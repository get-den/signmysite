/*
 * Email via Resend — used for magic-link sign-in.
 *
 * Plain fetch against Resend's REST API, no SDK (keeps the zero-dep ethos).
 * Configured by env:
 *   RESEND_API_KEY   — your Resend key (re_...). Absent ⇒ email disabled.
 *   DEN_EMAIL_FROM   — verified sender, e.g. "Den <login@agentcommune.com>".
 *                      Defaults to onboarding@resend.dev (works without a
 *                      verified domain, but only sends to your own address).
 */
import type { Member, Snapshot } from "./db.ts";

const API_KEY = process.env.RESEND_API_KEY || "";
const FROM = process.env.DEN_EMAIL_FROM || "Den <onboarding@resend.dev>";
const BASE = (process.env.DEN_BASE_URL || "").replace(/\/$/, "");

export const MAIL_LIVE = !!API_KEY;

const hostOf = (u: string) => { try { return new URL(u).host; } catch { return u; } };

export async function sendMagicLink(to: string, link: string): Promise<void> {
  if (!API_KEY) throw new Error("RESEND_API_KEY not set");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: "Bearer " + API_KEY, "content-type": "application/json" },
    body: JSON.stringify({
      from: FROM,
      to: [to],
      subject: "Your Den sign-in link",
      html: html(link),
      text: `Sign in to Den:\n${link}\n\nThis link expires in 15 minutes. If you didn't request it, ignore this email.`,
    }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new Error(`resend ${r.status}: ${detail.slice(0, 200)}`);
  }
}

// "Den noticed yoursite.com updated ✓" — the quiet trust signal that we picked up
// a change, especially for owners who wired nothing and can't otherwise tell it's
// working. Best-effort and fire-and-forget: only emails members with an address,
// never throws (a failed notification must never break a crawl or a ping).
export async function notifySiteUpdated(
  member: Pick<Member, "email" | "name" | "handle" | "url">,
  snap: Snapshot,
): Promise<void> {
  if (!member.email) return; // only claimed members have somewhere to notify
  const label = member.url ? hostOf(member.url) : (member.name || "your site");
  const subject = `Den noticed ${label} updated`;
  const profile = BASE && member.handle ? `${BASE}/@${member.handle}` : "";
  if (!API_KEY) {
    console.log(`[notify] ${member.email} ← ${subject}`); // dev: no mailer configured
    return;
  }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: "Bearer " + API_KEY, "content-type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to: [member.email],
        subject,
        html: updatedHtml(label, snap, profile),
        text: `Den detected a new version of ${label} — your followers will see it as new.${profile ? `\n\n${profile}` : ""}`,
      }),
    });
    if (!r.ok) console.warn(`[notify] resend ${r.status}`);
  } catch (e: any) {
    console.warn("[notify] send failed:", String(e?.message || e));
  }
}

function updatedHtml(label: string, snap: Snapshot, profile: string): string {
  const shot = snap.thumbnail
    ? `<img src="${snap.thumbnail}" alt="" width="356" style="width:356px;max-width:100%;border-radius:10px;border:1px solid #ececef;margin:18px 0 0">`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#f6f6f7;padding:32px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" style="max-width:420px;background:#fff;border:1px solid #ececef;border-radius:14px;padding:32px">
      <tr><td>
        <div style="font-weight:800;font-size:20px;letter-spacing:-.02em;color:#0b0b0c">den</div>
        <h1 style="font-size:20px;font-weight:600;color:#282a30;margin:20px 0 8px">${label} updated ✓</h1>
        <p style="font-size:15px;line-height:1.5;color:#6c6a63;margin:0">We picked up a new version of your site. Anyone following you will see it flagged as new.</p>
        ${shot}
        ${profile ? `<p style="margin:22px 0 0"><a href="${profile}" style="display:inline-block;background:#6f79d9;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:11px 22px;border-radius:10px">View your Den profile</a></p>` : ""}
        <p style="font-size:13px;line-height:1.5;color:#918e87;margin:24px 0 0">You're getting this because your site is on Den.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

function html(link: string): string {
  // Inline styles only — email clients strip <style>/external CSS.
  return `<!doctype html><html><body style="margin:0;background:#f6f6f7;padding:32px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" style="max-width:420px;background:#fff;border:1px solid #ececef;border-radius:14px;padding:32px">
      <tr><td>
        <div style="font-weight:800;font-size:20px;letter-spacing:-.02em;color:#0b0b0c">den</div>
        <h1 style="font-size:20px;font-weight:600;color:#282a30;margin:20px 0 8px">Sign in to Den</h1>
        <p style="font-size:15px;line-height:1.5;color:#6c6a63;margin:0 0 24px">Click the button below to sign in. This link expires in 15 minutes.</p>
        <a href="${link}" style="display:inline-block;background:#6f79d9;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:11px 22px;border-radius:10px">Sign in</a>
        <p style="font-size:13px;line-height:1.5;color:#918e87;margin:24px 0 0">If you didn't request this, you can safely ignore it.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}
