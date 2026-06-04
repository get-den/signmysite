/*
 * The public profile page (den.com/@handle) — server-rendered so it's shareable
 * and crawlable. Built from small render components below.
 *
 * One page, two audiences:
 *   - a visitor sees Follow / Save and the member's pinned blogs;
 *   - the owner (you, signed in, looking at your own profile) sees Edit profile
 *     and "Your widget" instead. The server picks the variant from the session,
 *     so crawlers (no cookie) always get the public one.
 */
import { escapeHtml, isReaction, relTime } from "./util.ts";
import type { Member, PinnedSite, Stats, Visibility } from "./db.ts";

type CommentRow = {
  id: string; body: string; visibility: Visibility; created: string;
  author_id: string | null; author_name: string | null; author_handle: string | null;
  author_avatar: string | null; author_url: string | null;
};
type Identity = { avatar: string | null; name: string; handle: string | null };

/* ---- thumbnails ---------------------------------------------------------- */

// Placeholder site thumbnails to cycle through when a member has no real one.
const PLACEHOLDER_THUMBS = ["andrew", "ilayda", "james", "justin"].map((n) => `/site/thumbnails/${n}.png`);

// Stable per-site pick: a given site always lands on the same placeholder (no
// flicker between loads), while different sites spread across the set.
export function placeholderThumb(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(h, 31) + seed.charCodeAt(i)) >>> 0;
  return PLACEHOLDER_THUMBS[h % PLACEHOLDER_THUMBS.length];
}

// The thumbnail a site preview shows: its real one, else a cycled placeholder.
export function siteThumb(site: { id: string; thumbnail?: string | null }): string {
  return site.thumbnail || placeholderThumb(site.id);
}

/* ---- small helpers ------------------------------------------------------- */

const num = (n: number) =>
  n < 1000 ? String(n)
    : n < 1e6 ? (n / 1e3).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, "") + "k"
      : (n / 1e6).toFixed(1).replace(/\.0$/, "") + "m";
const hostOf = (u: string) => { try { return new URL(u).host; } catch { return u; } };
const bgUrl = (u: string) => `background-image:url(${escapeHtml(JSON.stringify(u))})`;

// A handful of well-known platforms get a friendly label on the profile; every
// other URL falls back to its bare host. Presentation only — the stored value is
// always just the URL, so a new platform is a one-line addition, never a migration.
// (Mirrored in web/src/lib.ts for the editor; keep the two lists in sync.)
const SOCIALS: Array<[string, string]> = [
  ["instagram.com", "Instagram"], ["x.com", "X"], ["twitter.com", "X"],
  ["linkedin.com", "LinkedIn"], ["github.com", "GitHub"], ["youtube.com", "YouTube"],
  ["tiktok.com", "TikTok"], ["facebook.com", "Facebook"], ["threads.net", "Threads"],
  ["threads.com", "Threads"], ["bsky.app", "Bluesky"], ["mastodon.social", "Mastodon"],
  ["substack.com", "Substack"], ["medium.com", "Medium"], ["twitch.tv", "Twitch"],
  ["dribbble.com", "Dribbble"], ["behance.net", "Behance"], ["soundcloud.com", "SoundCloud"],
  ["spotify.com", "Spotify"], ["bandcamp.com", "Bandcamp"], ["t.me", "Telegram"],
  ["reddit.com", "Reddit"], ["pinterest.com", "Pinterest"], ["patreon.com", "Patreon"],
  ["ko-fi.com", "Ko-fi"], ["goodreads.com", "Goodreads"], ["letterboxd.com", "Letterboxd"],
];
function socialLabel(url: string): string {
  let host: string;
  try { host = new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return url; }
  for (const [d, label] of SOCIALS) if (host === d || host.endsWith("." + d)) return label;
  return host;
}
// The member's social links as a row of pills under their name. rel="me" marks
// them as the same person's other profiles (a nice identity hint for crawlers).
function socialLinks(m: Member): string {
  const links = Array.isArray(m.links) ? m.links : [];
  if (!links.length) return "";
  const pills = links
    .map((u) => `<a class="plink" href="${escapeHtml(u)}" target="_blank" rel="me noopener">${escapeHtml(socialLabel(u))}</a>`)
    .join("");
  return `<div class="plinks">${pills}</div>`;
}

function avatar(x: Identity, cls = ""): string {
  return x.avatar
    ? `<div class="avatar ${cls}" style="${bgUrl(x.avatar)}"></div>`
    : `<div class="avatar ${cls}">${escapeHtml((x.name || x.handle || "?").charAt(0).toUpperCase())}</div>`;
}

// Bookmark icon for the Save control — the same Lucide glyph the widget uses,
// inlined so the server-rendered page needs no icon runtime. Saving just fills
// it in (.psave-btn.on svg{fill}) — no icon swap.
const BOOKMARK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`;

/* ---- components ---------------------------------------------------------- */

function header(m: Member, isOwner: boolean): string {
  // Right side: a visitor gets the widget-style round Save button + Follow; the
  // owner gets Edit profile. (You can't save your own site — as in the widget.)
  const actions = isOwner
    ? `<a class="btn primary pfollow" href="/#/edit">Edit profile</a>`
    : `<button id="psave" class="psave-btn" type="button" aria-label="Save this site">${BOOKMARK_SVG}</button>` +
      `<a class="btn pmessage" href="/#/messages/${escapeHtml(m.id)}">Message</a>` +
      `<button id="pfollow" class="btn primary pfollow" type="button">Follow</button>`;
  // A linked-but-unverified site is flagged so a claim can't be taken at face
  // value. Verified sites get no badge — verification is the quiet default.
  const unverified = m.url && !m.verified ? ` <span class="unverified">(unverified)</span>` : "";
  const sub = m.url
    ? `<div class="purl"><a href="${escapeHtml(m.url)}" target="_blank" rel="noopener">${escapeHtml(hostOf(m.url))}</a>${unverified}</div>`
    : `<div class="phandle">@${escapeHtml(m.handle || "")}</div>`;
  return `<div class="phero">
    <div class="pid">
      ${avatar(m)}
      <div><div class="pname">${escapeHtml(m.name)}</div>${sub}${socialLinks(m)}</div>
    </div>
    <div class="phero-actions">${actions}</div>
  </div>`;
}

function preview(m: Member): string {
  const href = m.url ? escapeHtml(m.url) : "#";
  const ext = m.url ? ' target="_blank" rel="noopener"' : "";
  return `<a class="psite-wrap" href="${href}"${ext} aria-label="View ${escapeHtml(m.name)}'s site">
    <span class="psite" style="${bgUrl(siteThumb(m))}"></span>
  </a>`;
}

function actions(m: Member, s: Stats): string {
  const view = m.url ? `<a class="btn pink" href="${escapeHtml(m.url)}" target="_blank" rel="noopener">View site ↗</a>` : "";
  return `<div class="pactions">${view}
    <span id="pcounts" class="pcounts">${num(s.views)} views</span>
  </div>`;
}

function widgetPanel(m: Member, base: string): string {
  const tag = escapeHtml(`<script src="${base}/w/${m.id.replace(/^den:/, "")}.js"></script>`);
  return `<div class="card dash-widget pwidget">
    <div class="card-head"><h3>Your widget</h3></div>
    <p>One line — works on any site builder.</p>
    <div class="snippet" id="wsnippet">${tag}</div>
    <button class="btn sm pink" id="wcopy" type="button">Copy script</button>
  </div>`;
}

function pinnedSection(pinned: PinnedSite[], heading: string): string {
  const cards = pinned.map((b) => `<a class="pin" href="${b.url ? escapeHtml(b.url) : "/@" + escapeHtml(b.handle || "")}"${b.url ? ' target="_blank" rel="noopener"' : ""}>
      ${avatar(b)}
      <div class="meta"><div class="bn">${escapeHtml(b.name || "—")}</div>
      <div class="bh">${escapeHtml(b.url ? hostOf(b.url) : "@" + (b.handle || ""))}</div></div>
      ${b.notes.length ? `<div class="pin-notes">${b.notes.map((n) => `<span class="pin-bubble">${escapeHtml(n.body)}</span>`).join("")}</div>` : ""}
    </a>`).join("");
  return `<h2 class="pside-head">${escapeHtml(heading)}</h2>
    ${pinned.length ? `<div class="pins pins-col">${cards}</div>` : `<div class="empty">No pinned blogs yet.</div>`}`;
}

function commentsSection(rows: CommentRow[]): string {
  // Public + crawlable, so only public notes appear here. Rendered to mirror the
  // embeddable widget's notes list exactly (.cmt in app.css): a round avatar, a
  // name + relative-time line, and the body beneath — no surrounding card/border.
  const pub = rows.filter((cm) => cm.visibility === "public");
  const rowsHtml = pub.map((cm) => {
    const name = escapeHtml(cm.author_name || "Someone");
    const ident: Identity = { avatar: cm.author_avatar, name: cm.author_name || "", handle: cm.author_handle };
    const ts = relTime(cm.created);
    const time = ts ? `<time class="cmt-time">${ts}</time>` : "";
    // A single-emoji note renders as a "reacted with ✨" line (no body), like the widget.
    const reaction = isReaction(cm.body) ? cm.body.trim() : "";
    const meta = reaction
      ? `<div class="cmt-line"><span class="who">${name}</span><span class="act"> reacted with </span><span class="react-emoji">${escapeHtml(reaction)}</span>${time}</div>`
      : `<div class="cmt-line"><span class="who">${name}</span>${time}</div><div class="body">${escapeHtml(cm.body)}</div>`;
    const inner = `${avatar(ident)}<div class="meta">${meta}</div>`;
    // Link the row to the commenter — their Den profile if we know it, else their site.
    const href = cm.author_handle ? `/@${escapeHtml(cm.author_handle)}` : cm.author_url ? escapeHtml(cm.author_url) : "";
    const ext = !cm.author_handle && cm.author_url ? ` target="_blank" rel="noopener"` : "";
    return href ? `<a class="cmt" href="${href}"${ext}>${inner}</a>` : `<div class="cmt">${inner}</div>`;
  }).join("");
  return `<section class="pcomments"><h2 class="pside-head">Comments</h2>
    <div class="cmt-list">${pub.length ? rowsHtml : `<div class="empty">No notes yet.</div>`}</div>
  </section>`;
}

/* ---- page assembly ------------------------------------------------------- */

const signOutBtn = `<button class="btn sm naked" data-signout>Sign out</button>`;
// /api/logout returns JSON (no redirect), so end the session via fetch, then go home.
const signOutScript = `<script>document.addEventListener("click",function(e){if(e.target.closest("[data-signout]")){e.preventDefault();fetch("/api/logout",{method:"POST"}).then(function(){location.href="/"});}});</script>`;

/*
 * The standard site header, server-rendered to mirror the React app's <Header>
 * so a profile wears the same chrome instead of a lone back arrow. It's
 * viewer-aware (the server already knows the session): signed-out visitors get
 * "Sign in"; a half-finished signup gets just "Sign out"; everyone else gets the
 * full nav. `here` is the current URL (the post-sign-in return target), and
 * `ownProfile` highlights "Your site" when you're looking at yourself.
 */
export function siteHeader(
  viewer: { handle: string | null; onboarded: boolean } | null | undefined,
  here: string,
  ownProfile = false,
): string {
  const nav = !viewer
    ? `<a class="btn sm primary" href="/auth?return=${encodeURIComponent(here)}">Sign in</a>`
    : !viewer.onboarded
      ? signOutBtn
      : `<a class="navlink" href="/">Home</a>` +
        `<a class="navlink${ownProfile ? " active" : ""}" href="/@${escapeHtml(viewer.handle || "")}">Your site</a>` +
        `<a class="navlink" href="/#/messages">Messages</a>` +
        `<a class="navlink" href="/#/notes">Notes</a>` +
        signOutBtn;
  return (
    `<header class="top"><a class="brand" href="/">den</a><nav>${nav}</nav></header>` +
    (viewer ? signOutScript : "")
  );
}

export function renderProfileInner(opts: {
  m: Member; s: Stats; pinned: PinnedSite[]; comments: CommentRow[]; isOwner: boolean; base: string;
}): string {
  const { m, s, pinned, comments, isOwner, base } = opts;
  const side = isOwner
    ? widgetPanel(m, base)
    : pinnedSection(pinned, `${m.name}'s pinned blogs`);
  return `
  <div class="profile">
    ${header(m, isOwner)}
    <div class="pgrid">
      <div class="pcol-main">
        ${preview(m)}
        ${actions(m, s)}
        ${commentsSection(comments)}
      </div>
      <aside class="pcol-side">${side}</aside>
    </div>
  </div>
  <script>${profileScript(m.id, isOwner)}</script>`;
}

// Client glue. The owner gets the widget "Copy script" button; a visitor gets
// live Follow / Save toggles that hydrate the current state and counts. (The
// server already rendered the correct buttons; this just wires them.)
function profileScript(id: string, isOwner: boolean): string {
  if (isOwner) {
    return `
(function(){
  var btn=document.getElementById('wcopy'),snip=document.getElementById('wsnippet');
  if(!btn||!snip)return;
  btn.addEventListener('click',function(){
    var t=snip.textContent;
    (navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).then(function(){
      btn.textContent='Copied';setTimeout(function(){btn.textContent='Copy script';},1400);
    }).catch(function(){});
  });
})();`;
  }
  return `
(function(){
  var id=${JSON.stringify(id)};
  var followBtn=document.getElementById('pfollow');
  var saveBtn=document.getElementById('psave');
  var counts=document.getElementById('pcounts');
  function num(n){n=Number(n)||0;return n<1000?String(n):n<1e6?(n/1e3).toFixed(n<1e4?1:0).replace(/\\.0$/,'')+'k':(n/1e6).toFixed(1).replace(/\\.0$/,'')+'m';}
  function renderCounts(s){if(counts)counts.textContent=num(s.views)+' views';}
  function setFollow(on){if(followBtn){followBtn.innerHTML=on?'<span class="lbl">Following</span>':'Follow';followBtn.classList.toggle('following',!!on);followBtn.classList.toggle('primary',!on);}}
  function setSave(on){if(saveBtn){saveBtn.classList.toggle('on',!!on);saveBtn.setAttribute('aria-label',on?'Saved':'Save this site');}}
  function signin(){location.href='/api/auth/google?return='+encodeURIComponent(location.href);}
  function toggle(path,apply){
    fetch(path,{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({id:id})})
      .then(function(r){if(r.status===401){signin();return null;}return r.json();})
      .then(function(s){if(!s)return;apply(s);renderCounts(s);});
  }
  if(followBtn)followBtn.addEventListener('click',function(){
    // Suppress red "Unfollow"-on-hover for one hover cycle after the click, so the
    // button doesn't snap to red under a cursor still resting on it post-click.
    followBtn.classList.add('just');
    followBtn.addEventListener('mouseleave',function off(){followBtn.classList.remove('just');followBtn.removeEventListener('mouseleave',off);});
    toggle('/api/follow',function(s){setFollow(s.viewerFollows);});
  });
  if(saveBtn)saveBtn.addEventListener('click',function(){toggle('/api/save',function(s){setSave(s.viewerSaved);});});
  fetch('/api/profile/'+encodeURIComponent(id)+'/stats',{credentials:'include'})
    .then(function(r){return r.json();}).catch(function(){return null;})
    .then(function(s){if(s){setFollow(s.viewerFollows);setSave(s.viewerSaved);renderCounts(s);}});
})();`;
}
