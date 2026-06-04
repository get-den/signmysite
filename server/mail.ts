/*
 * Email via Resend — magic-link sign-in plus best-effort activity notifications.
 *
 * Plain fetch against Resend's REST API, no SDK (keeps the zero-dep ethos). Every
 * message is built from ONE shared layout() + a handful of content helpers, so they
 * all wear the same Den styling — the tokens come from ./theme.ts, which mirrors the
 * React app (site/app.css) and the widget. Inline styles only: email clients strip
 * <style> and external CSS.
 *
 * Env:
 *   RESEND_API_KEY   — your Resend key (re_...). Absent ⇒ email disabled (logged).
 *   DEN_EMAIL_FROM   — verified sender, e.g. "Den <noreply@signmysite.com>".
 */
import { wantsNotify, listFollowersWithEmail, type Member, type NotifyKind, type Snapshot } from "./db.ts";
import { escapeHtml, notifyToken } from "./util.ts";
import { theme } from "./theme.ts";
import { BASE } from "./config.ts";

// The fields every notification needs from a recipient: who to reach + their prefs.
type Recipient = Pick<Member, "id" | "email" | "name" | "handle" | "notify">;

const API_KEY = process.env.RESEND_API_KEY || "";
const FROM = process.env.DEN_EMAIL_FROM || "Den <noreply@signmysite.com>";

export const MAIL_LIVE = !!API_KEY;

const hostOf = (u: string) => { try { return new URL(u).host; } catch { return u; } };

// ---- transport -----------------------------------------------------------
// The one place we hit Resend. Returns true on a successful send; false — logged,
// never thrown — when mail is off or the API rejects, so a fire-and-forget
// notification can never break the request that triggered it.
async function send(msg: { to: string; subject: string; html: string; text: string; headers?: Record<string, string> }): Promise<boolean> {
  if (!API_KEY) {
    console.log(`[mail] (no RESEND_API_KEY) would send → ${msg.to}: ${msg.subject}`);
    return false;
  }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: "Bearer " + API_KEY, "content-type": "application/json" },
      body: JSON.stringify({
        from: FROM, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text,
        ...(msg.headers && Object.keys(msg.headers).length ? { headers: msg.headers } : {}),
      }),
    });
    if (!r.ok) {
      console.warn(`[mail] resend ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (e: any) {
    console.warn("[mail] send failed:", String(e?.message || e));
    return false;
  }
}

// ---- shared layout + content helpers -------------------------------------
// Every Den email is this shell: a recessed page, one white rounded card, the den
// wordmark, then `inner` (assembled from the helpers below). The per-email footnote
// lives inside `inner`, so this stays generic across sign-in and notifications.
function layout(inner: string): string {
  return `<!doctype html><html><body style="margin:0;background:${theme.pageBg};padding:32px 16px;font-family:${theme.font};-webkit-font-smoothing:antialiased">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:440px;background:${theme.surface};border:1px solid ${theme.line};border-radius:${theme.radius}">
      <tr><td style="padding:28px 28px 30px">
        <div style="display:inline-block;width:40px;height:40px;border-radius:50%;background:${theme.ink};color:#fff;text-align:center;line-height:40px;font-size:14px;font-weight:600">den</div>
        ${inner}
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

function heading(text: string): string {
  return `<h1 style="margin:22px 0 8px;font-size:20px;font-weight:600;letter-spacing:-.02em;color:${theme.ink}">${escapeHtml(text)}</h1>`;
}
function paragraph(text: string): string {
  return `<p style="margin:0;font-size:15px;line-height:1.55;color:${theme.text}">${escapeHtml(text)}</p>`;
}
// A pill button in the brand accent — the same shape + color as the app/widget.
function button(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0"><tr>
    <td style="border-radius:999px;background:${theme.accent}"><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:600;line-height:1;color:${theme.accentInk};text-decoration:none">${escapeHtml(label)}</a></td>
  </tr></table>`;
}
// A small muted footnote. `html` is trusted (we build it) so a managed link can ride along.
function footnote(html: string): string {
  return `<p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:${theme.muted}">${html}</p>`;
}
// A site preview / thumbnail.
function image(src: string): string {
  return `<img src="${escapeHtml(src)}" alt="" width="384" style="width:100%;max-width:384px;border-radius:${theme.radiusSm};border:1px solid ${theme.line};margin:18px 0 0;display:block">`;
}
// A quoted note (written comments). User text — escaped.
function quote(text: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 0"><tr>
    <td style="padding:14px 16px;background:${theme.surface3};border:1px solid ${theme.line};border-radius:${theme.radiusSm};font-size:15px;line-height:1.5;color:${theme.text}">${escapeHtml(text)}</td>
  </tr></table>`;
}
// A monospace code block (the widget tag in the activation email). User-free, escaped.
function code(text: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 0"><tr>
    <td style="padding:13px 15px;background:${theme.surface3};border:1px solid ${theme.line};border-radius:${theme.radiusSm};font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:${theme.ink};word-break:break-all">${escapeHtml(text)}</td>
  </tr></table>`;
}
// The tokenized "manage notifications" link — works from email with no sign-in.
const manageUrl = (id: string): string => BASE ? `${BASE}/notify?m=${encodeURIComponent(id)}&t=${notifyToken(id)}` : "#";
// One-click unsubscribe (RFC 8058). `kind` names the stream this email belongs to
// (absent ⇒ everything). Backs BOTH the footer link and the List-Unsubscribe header,
// so Gmail/Yahoo's native Unsubscribe button works and the mail stays out of spam.
const unsubUrl = (id: string, kind?: NotifyKind): string =>
  BASE ? `${BASE}/unsubscribe?m=${encodeURIComponent(id)}&t=${notifyToken(id)}${kind ? `&k=${kind}` : ""}` : "#";
function unsubHeaders(id: string, kind?: NotifyKind): Record<string, string> {
  if (!BASE) return {};
  return { "List-Unsubscribe": `<${unsubUrl(id, kind)}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
}
// The standard footer: why you got this, plus how to tune it OR leave entirely.
function manageFootnote(id: string, reason: string, kind?: NotifyKind): string {
  if (!BASE) return footnote(escapeHtml(reason));
  const s = `color:${theme.muted};text-decoration:underline`;
  return footnote(`${escapeHtml(reason)} <a href="${manageUrl(id)}" style="${s}">Manage notifications</a> · <a href="${unsubUrl(id, kind)}" style="${s}">Unsubscribe</a>.`);
}

// The actor line: avatar (external image, else an initial tile) + "<b>Name</b> verb".
function actorLine(name: string, avatar: string | null, verb: string): string {
  const safe = escapeHtml(name || "Someone");
  const pic = avatar && /^https?:\/\//.test(avatar)
    ? `<img src="${escapeHtml(avatar)}" width="44" height="44" alt="" style="width:44px;height:44px;border-radius:50%;object-fit:cover;display:block;border:0">`
    : `<div style="width:44px;height:44px;border-radius:50%;background:${theme.surface3};border:1px solid ${theme.line};text-align:center;line-height:42px;font-size:17px;font-weight:600;color:${theme.ink}">${escapeHtml((name || "?").trim().charAt(0).toUpperCase() || "?")}</div>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0"><tr>
    <td valign="middle" style="padding-right:13px">${pic}</td>
    <td valign="middle" style="font-size:16px;line-height:1.45;color:${theme.text}"><b style="color:${theme.ink};font-weight:600">${safe}</b> ${escapeHtml(verb)}</td>
  </tr></table>`;
}

// ---- magic-link sign-in --------------------------------------------------
export async function sendMagicLink(to: string, link: string): Promise<void> {
  if (!API_KEY) throw new Error("RESEND_API_KEY not set");
  const ok = await send({
    to,
    subject: "Your Den sign-in link",
    html: layout(
      heading("Sign in to Den") +
      paragraph("Click below to sign in. This link expires in 15 minutes.") +
      button("Sign in", link) +
      footnote("If you didn't request this, you can safely ignore it."),
    ),
    text: `Sign in to Den:\n${link}\n\nThis link expires in 15 minutes. If you didn't request it, ignore this email.`,
  });
  if (!ok) throw new Error("magic-link send failed");
}

// ---- "your site updated" -------------------------------------------------
// The quiet trust signal that we picked up a change. Best-effort, fire-and-forget:
// only emails members with an address, never throws (a failed notification must
// never break a crawl or a ping).
export async function notifySiteUpdated(
  member: Recipient & Pick<Member, "url">,
  snap: Snapshot,
): Promise<void> {
  if (!member.email || !wantsNotify(member, "siteUpdated")) return; // claimed + opted-in only
  const label = member.url ? hostOf(member.url) : (member.name || "your site");
  const profile = BASE && member.handle ? `${BASE}/@${member.handle}` : "";
  await send({
    to: member.email,
    subject: `Den noticed ${label} updated`,
    html: layout(
      heading(`${label} updated`) +
      paragraph("We picked up a new version of your site. Anyone following you will see it flagged as new.") +
      (snap.thumbnail ? image(snap.thumbnail) : "") +
      (profile ? button("View your Den profile", profile) : "") +
      manageFootnote(member.id, "You're getting this because your site is on Den.", "siteUpdated"),
    ),
    text: `Den detected a new version of ${label}. Your followers will see it as new.${profile ? `\n\n${profile}` : ""}`,
    headers: unsubHeaders(member.id, "siteUpdated"),
  });
}

// ---- "a site you follow just updated" ------------------------------------
// The follow-graph payoff for the READER: when a site they follow posts a new
// version, bring them back to look. Best-effort, fire-and-forget, prefs-gated.
export async function notifyFollowedUpdate(
  follower: Recipient,
  source: Pick<Member, "name" | "handle" | "url" | "avatar">,
  snap: Snapshot,
): Promise<void> {
  if (!follower.email || !wantsNotify(follower, "followedUpdate")) return;
  const who = source.name || (source.url ? hostOf(source.url) : "A site you follow");
  const profile = BASE && source.handle ? `${BASE}/@${source.handle}` : (source.url || BASE || "#");
  await send({
    to: follower.email,
    subject: `${who} just updated`,
    html: layout(
      actorLine(who, source.avatar, "posted a new version of their site.") +
      (snap.thumbnail ? image(snap.thumbnail) : "") +
      button(`View ${who}`, profile) +
      manageFootnote(follower.id, `You follow ${who} on Den.`, "followedUpdate"),
    ),
    text: `${who} just posted a new version of their site.\n\n${profile}`,
    headers: unsubHeaders(follower.id, "followedUpdate"),
  });
}

// The whole "site updated" fan-out in one call: tell the OWNER, then each FOLLOWER.
// Used by both the live path (ping / me.json refresh) and the crawler, so the two
// can't drift. Fully best-effort — each recipient's prefs are checked downstream.
export async function notifyUpdate(owner: Member, snap: Snapshot): Promise<void> {
  await notifySiteUpdated(owner, snap);
  for (const f of await listFollowersWithEmail(owner.id)) {
    await notifyFollowedUpdate(f, owner, snap);
  }
}

// ---- activation nudge ----------------------------------------------------
// Signed up but the widget isn't live yet (verified = false). One line to go.
export async function notifyActivation(member: Recipient & Pick<Member, "url">): Promise<void> {
  if (!member.email) return;
  const tag = `<script src="${BASE}/w/${member.id.replace(/^den:/, "")}.js"></script>`;
  const host = member.url ? hostOf(member.url) : "";
  const editUrl = BASE ? `${BASE}/#/edit` : "#";
  const intro = host
    ? `You linked ${host}, but Den can't see the widget on it yet. Add this one line and your profile, followers, reactions, and analytics all switch on.`
    : "Your Den profile is ready, but it isn't live yet. Add this one line to your personal site to connect it — followers, reactions, and analytics switch on.";
  await send({
    to: member.email,
    subject: "One line to finish setting up your Den",
    html: layout(
      heading("Add the widget to go live") +
      paragraph(intro) +
      code(tag) +
      button("Finish setup", editUrl) +
      manageFootnote(member.id, "You're getting this because you started a Den profile."),
    ),
    text: `Add this line to your site to go live on Den:\n\n${tag}\n\n${editUrl}`,
    headers: unsubHeaders(member.id),
  });
}

// ---- milestones ----------------------------------------------------------
export async function notifyMilestone(
  member: Recipient,
  metric: "views" | "followers",
  count: number,
): Promise<void> {
  if (!member.email || !wantsNotify(member, "milestone")) return;
  const profile = BASE && member.handle ? `${BASE}/@${member.handle}` : (BASE || "#");
  const headline = metric === "views"
    ? `Your site passed ${count.toLocaleString()} views`
    : `You reached ${count} ${count === 1 ? "follower" : "followers"}`;
  const note = metric === "views"
    ? "People keep finding your corner of the web."
    : "Your updates now reach more people across Den.";
  await send({
    to: member.email,
    subject: `🎉 ${headline}`,
    html: layout(
      `<div style="margin:22px 0 0;font-size:40px;line-height:1">🎉</div>` +
      heading(headline) +
      paragraph(note) +
      button("See your profile", profile) +
      manageFootnote(member.id, "You're getting this because you hit a milestone on Den.", "milestone"),
    ),
    text: `${headline} on Den.\n\n${profile}`,
    headers: unsubHeaders(member.id, "milestone"),
  });
}

// ---- activity: follow / save / reaction / note ---------------------------
export type ActivityKind = "follow" | "save" | "comment" | "reaction";
export type Actor = { id: string; name: string; handle: string | null; avatar: string | null; url: string | null };

// One template for every "someone did X to your site" email. Best-effort and
// fire-and-forget — the caller drops self-actions and owners with no email, and
// this never throws. `body` carries the note text (comment) or the emoji (reaction).
export async function notifyActivity(opts: {
  owner: Recipient;
  actor: Actor;
  kind: ActivityKind;
  body?: string;
}): Promise<void> {
  const { owner, actor, kind, body } = opts;
  if (!owner.email || !wantsNotify(owner, kind)) return;
  const who = actor.name || "Someone";
  const note = (body || "").trim();

  // Where each kind points: follows/saves → the actor's profile (so you can follow
  // back — the relational hook); reactions → your profile (where they show); notes →
  // your inbox (to read + reply).
  const actorUrl = BASE && actor.handle ? `${BASE}/@${actor.handle}` : (actor.url || BASE || "#");
  const ownerProfile = BASE && owner.handle ? `${BASE}/@${owner.handle}` : (BASE || "#");

  const plan = {
    follow:   { verb: "followed your site.",        subject: `${who} followed you on Den`, cta: ["View their profile", actorUrl], extra: "",            text: `${who} followed your site.` },
    save:     { verb: "saved your site.",           subject: `${who} saved your site`,     cta: ["View their profile", actorUrl], extra: "",            text: `${who} saved your site.` },
    reaction: { verb: "reacted to your site:",      subject: `${who} reacted ${note}`.trim(), cta: ["See it on your profile", ownerProfile], extra: `<div style="margin:12px 0 0;font-size:40px;line-height:1">${escapeHtml(note)}</div>`, text: `${who} reacted ${note} to your site.` },
    comment:  { verb: "left a note on your site:",  subject: `${who} left you a note`,      cta: ["See it on your profile", ownerProfile], extra: quote(note),   text: `${who} left a note on your site:\n\n${note}` },
  }[kind];

  await send({
    to: owner.email,
    subject: plan.subject,
    html: layout(
      actorLine(who, actor.avatar, plan.verb) +
      plan.extra +
      button(plan.cta[0], plan.cta[1]) +
      manageFootnote(owner.id, "You're getting this because someone interacted with your site on Den.", kind),
    ),
    text: `${plan.text}${BASE ? `\n\n${plan.cta[1]}` : ""}`,
    headers: unsubHeaders(owner.id, kind),
  });
}

// ---- direct messages -----------------------------------------------------
// Tell a member someone sent them a DM. Best-effort + prefs-gated. The API calls
// this only on the FIRST unread message in a thread, so a back-and-forth is one
// email, not one per line.
export async function notifyMessage(recipient: Recipient, sender: Actor, body: string): Promise<void> {
  if (!recipient.email || !wantsNotify(recipient, "message")) return;
  const who = sender.name || "Someone";
  const reply = BASE ? `${BASE}/#/messages/${sender.id}` : "#";
  await send({
    to: recipient.email,
    subject: `${who} messaged you on Den`,
    html: layout(
      actorLine(who, sender.avatar, "sent you a message:") +
      quote(body) +
      button("Reply", reply) +
      manageFootnote(recipient.id, `You're getting this because ${who} messaged you on Den.`, "message"),
    ),
    text: `${who} sent you a message on Den:\n\n${body}\n\n${reply}`,
    headers: unsubHeaders(recipient.id, "message"),
  });
}
