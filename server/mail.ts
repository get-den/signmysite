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
const API_KEY = process.env.RESEND_API_KEY || "";
const FROM = process.env.DEN_EMAIL_FROM || "Den <onboarding@resend.dev>";

export const MAIL_LIVE = !!API_KEY;

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
