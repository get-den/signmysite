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
import { escapeHtml } from "./util.ts";
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
    : n < 1e6 ? (n / 1e3).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, "") + "K"
      : (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
const hostOf = (u: string) => { try { return new URL(u).host; } catch { return u; } };
const bgUrl = (u: string) => `background-image:url(${escapeHtml(JSON.stringify(u))})`;

function avatar(x: Identity, cls = ""): string {
  return x.avatar
    ? `<div class="avatar ${cls}" style="${bgUrl(x.avatar)}"></div>`
    : `<div class="avatar ${cls}">${escapeHtml((x.name || x.handle || "?").charAt(0).toUpperCase())}</div>`;
}

/* ---- components ---------------------------------------------------------- */

function header(m: Member, isOwner: boolean): string {
  const action = isOwner
    ? `<a class="btn primary pfollow" href="/#/edit">Edit profile</a>`
    : `<button id="pfollow" class="btn primary pfollow" type="button">Follow</button>`;
  const sub = m.url
    ? `<div class="purl"><a href="${escapeHtml(m.url)}" target="_blank" rel="noopener">${escapeHtml(hostOf(m.url))}</a></div>`
    : `<div class="phandle">@${escapeHtml(m.handle || "")}</div>`;
  return `<div class="phero">
    <div class="pid">
      ${avatar(m)}
      <div><div class="pname">${escapeHtml(m.name)}</div>${sub}</div>
    </div>
    ${action}
  </div>`;
}

function preview(m: Member): string {
  const href = m.url ? escapeHtml(m.url) : "#";
  const ext = m.url ? ' target="_blank" rel="noopener"' : "";
  return `<a class="psite-wrap" href="${href}"${ext} aria-label="View ${escapeHtml(m.name)}'s site">
    <span class="psite" style="${bgUrl(siteThumb(m))}"></span>
  </a>`;
}

function actions(m: Member, s: Stats, isOwner: boolean): string {
  const view = m.url ? `<a class="btn pview" href="${escapeHtml(m.url)}" target="_blank" rel="noopener">View site ↗</a>` : "";
  const save = isOwner ? "" : `<button id="psave" class="btn psave" type="button">Save</button>`;
  return `<div class="pactions">${view}${save}
    <span id="pcounts" class="pcounts">${num(s.views)} views · ${num(s.saved)} saved</span>
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
  // Public + crawlable, so only public notes appear here.
  const pub = rows.filter((cm) => cm.visibility === "public");
  const body = pub.length
    ? pub.map((cm) => `<div class="blog" style="border:0;padding:6px 0">
        ${avatar({ avatar: cm.author_avatar, name: cm.author_name || "", handle: cm.author_handle })}
        <div class="meta"><div class="bn">${escapeHtml(cm.author_name || "Someone")}${cm.author_url ? ` <a class="bh" href="${escapeHtml(cm.author_url)}" target="_blank" rel="noopener">(${escapeHtml(hostOf(cm.author_url))})</a>` : ""}</div>
        <div>${escapeHtml(cm.body)}</div></div></div>`).join("")
    : `<div class="empty">No notes yet.</div>`;
  return `<div class="section pcomments"><h2>Comments</h2>${body}</div>`;
}

/* ---- page assembly ------------------------------------------------------- */

export const profileBackHeader = `<header class="top pback-bar"><a class="pback" href="/">(back)</a></header>`;

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
        ${actions(m, s, isOwner)}
        ${m.bio ? `<p class="pbio">${escapeHtml(m.bio)}</p>` : ""}
      </div>
      <aside class="pcol-side">${side}</aside>
    </div>
    ${commentsSection(comments)}
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
  function num(n){n=Number(n)||0;return n<1000?String(n):n<1e6?(n/1e3).toFixed(n<1e4?1:0).replace(/\\.0$/,'')+'K':(n/1e6).toFixed(1).replace(/\\.0$/,'')+'M';}
  function renderCounts(s){if(counts)counts.textContent=num(s.views)+' views · '+num(s.saved)+' saved';}
  function setFollow(on){if(followBtn){followBtn.textContent=on?'Following':'Follow';followBtn.classList.toggle('on',!!on);}}
  function setSave(on){if(saveBtn){saveBtn.textContent=on?'Saved':'Save';saveBtn.classList.toggle('on',!!on);}}
  function signin(){location.href='/api/auth/google?return='+encodeURIComponent(location.href);}
  function toggle(path,apply){
    fetch(path,{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({id:id})})
      .then(function(r){if(r.status===401){signin();return null;}return r.json();})
      .then(function(s){if(!s)return;apply(s);renderCounts(s);});
  }
  if(followBtn)followBtn.addEventListener('click',function(){toggle('/api/follow',function(s){setFollow(s.viewerFollows);});});
  if(saveBtn)saveBtn.addEventListener('click',function(){toggle('/api/save',function(s){setSave(s.viewerSaved);});});
  fetch('/api/profile/'+encodeURIComponent(id)+'/stats',{credentials:'include'})
    .then(function(r){return r.json();}).catch(function(){return null;})
    .then(function(s){if(s){setFollow(s.viewerFollows);setSave(s.viewerSaved);renderCounts(s);}});
})();`;
}
