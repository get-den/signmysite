(function () {
  "use strict";

  if (window.__denWidget) return;
  window.__denWidget = true;

  var script = document.currentScript || document.querySelector('script[src*="/w/"],script[data-id]');
  if (!script) return;

  var origin = "";
  try { origin = new URL(script.src).origin; } catch (_) {}

  var cfg = {
    id: idOf(script),
    api: (script.getAttribute("data-api") || origin || "https://den.com").replace(/\/$/, ""),
    theme: script.getAttribute("data-theme") || "light",
    position: script.getAttribute("data-position") || "bottom-right",
    launcher: script.getAttribute("data-launcher") || "circle",
    collapsed: script.getAttribute("data-collapsed") === "true",
  };
  cfg.generic = !cfg.id;

  // Views/followers are hidden for now — flip to true to bring the stats row back.
  var SHOW_STATS = false;

  var host, card, ui, busy = false, viewed = false;
  var draftKey = "den_draft_" + cfg.id;
  var tokenKey = "den_token";

  // The faces offered in the reaction tray. Every reaction is public.
  var REACTIONS = ["❤️", "🔥", "😂", "👏", "🎉", "✨", "👀", "🙌"];

  ready(start);

  function start() {
    host = document.createElement("div");
    var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
    host.setAttribute("data-den-widget", "");
    document.body.appendChild(host);
    root.innerHTML = style() + html(cfg);
    ui = map(root);

    ui.open.onclick = function () { open(!ui.wrap.classList.contains("open")); };
    ui.follow.onclick = function () { act("/api/follow", "viewerFollows"); };
    ui.save.onclick = function () { act("/api/save", "viewerSaved"); };
    ui.react.onclick = function () { toggleTray(); };
    ui.send.onclick = submit;
    ui.obCopy.onclick = copyTag;
    ui.input.oninput = function () { store(draftKey, ui.input.value.trim()); paintSend(); };
    ui.input.onkeydown = function (e) { if (e.key === "Enter") { e.preventDefault(); submit(); } };
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") { toggleTray(false); open(false); } });
    document.addEventListener("click", function (e) {
      if (ui.wrap.classList.contains("open") && e.composedPath && e.composedPath().indexOf(host) === -1) open(false);
    });
    window.addEventListener("message", function (e) {
      if (e.data && e.data.den === "signed-in") {
        store(tokenKey, e.data.token || "");
        load();
      }
    });

    buildTray();

    if (ui.stats) ui.stats.hidden = !SHOW_STATS;
    restoreDraft();
    paintSend();
    open(!cfg.collapsed);
    load();
  }

  async function load() {
    try {
      card = cfg.id
        ? await api("/api/profile/" + enc(cfg.id) + "/card")
        : await api("/api/sites/resolve", { url: location.origin, name: document.title || "" });
    } catch (e) {
      if (e.status !== 404) return fail();
      if (!cfg.id) return fail();
      try {
        await api("/api/sites/claim", { id: cfg.id, url: location.origin, name: document.title || "" });
        card = await api("/api/profile/" + enc(cfg.id) + "/card");
      } catch (_) { return fail(); }
    }
    cfg.id = (card.profile && card.profile.id) || cfg.id;
    paint();
    if (cfg.id && !viewed) {
      viewed = true;
      api("/api/profile/" + enc(cfg.id) + "/view", {}).catch(function () {});
    }
  }

  // Follow / save. Flip the button's state immediately (optimistic) so the click
  // always gives instant feedback, then reconcile with the server — reverting if
  // the request fails.
  async function act(path, flag) {
    if (busy) return;
    if (!cfg.id || !card) return signIn();
    card.stats = card.stats || {};
    var prev = !!card.stats[flag];
    card.stats[flag] = !prev;
    paintActions();
    busy = true;
    try {
      card.stats = await api(path, { id: cfg.id });
      ui.status.textContent = "";
      if (SHOW_STATS) paintStats();
      paintActions();
    } catch (e) {
      card.stats[flag] = prev;
      paintActions();
      if (e.status === 401) signIn();
    } finally { busy = false; }
  }

  // A written note isn't posted from here — the visitor almost never has a
  // session on someone else's site, and we'd have to send them to Den to sign in
  // anyway. So pressing Enter carries the draft to a full-page "postcard"
  // composer on the main site, where they pick public/private and sign in to
  // send. With no text yet, the same key opens the emoji tray instead.
  function submit() {
    var text = ui.input.value.trim();
    if (!text) return toggleTray();
    if (!cfg.id) return signIn();
    openTab(mainUrl("/compose", { to: cfg.id, site: siteName(), body: text }));
  }

  // A reaction is public and needs no account: post it immediately (attributed
  // to the viewer if one is signed in, else anonymous), then hand off to a
  // confirmation page that celebrates it and nudges sign-up / follow.
  function react(emoji) {
    if (busy || !cfg.id) return;
    toggleTray(false);
    // Open the confirmation tab synchronously, inside the click gesture, so it's
    // never swallowed by a popup blocker. The reaction posts in the background —
    // the confirmation page only needs to celebrate it, not wait on the write.
    openTab(mainUrl("/reacted", { to: cfg.id, site: siteName(), emoji: emoji }));
    api("/api/profile/" + enc(cfg.id) + "/react", { emoji: emoji }).catch(function () {});
  }

  function buildTray() {
    if (!ui.tray) return;
    REACTIONS.forEach(function (e) {
      var b = node("button", "emoji");
      b.type = "button";
      b.textContent = e;
      b.setAttribute("aria-label", "React with " + e);
      b.onclick = function () { react(e); };
      ui.tray.append(b);
    });
  }
  function toggleTray(on) {
    if (!ui.tray) return;
    var show = on === undefined ? ui.tray.hidden : on;
    ui.tray.hidden = !show;
    ui.react.classList.toggle("on", show);
  }

  function paint() {
    var p = card.profile || {};
    var signedIn = !!card.viewer;
    var owner = signedIn && card.viewer.id === cfg.id;

    // Launcher branding is shown in every state.
    if (ui.pillName) ui.pillName.textContent = p.name || p.handle || "Den";
    avatar(ui.pillAvatar, p);

    // The generic /w.js tag is the front door: when the site is unclaimed (no
    // profile id) or has just been claimed by the person signing in, the card
    // becomes a self-contained onboarding flow instead of a profile view.
    var onboarding = cfg.generic && (!p.id || (signedIn && card.viewer.id === p.id));
    ui.panel.classList.toggle("onboarding", onboarding);
    if (onboarding) { paintOnboard(signedIn, p); return; }

    // Always the Den profile — never the visitor's own personal site.
    var prof = profileUrl(p);

    ui.name.textContent = p.name || p.handle || "Someone";
    ui.name.href = prof;
    ui.name.target = "_blank";
    ui.name.rel = "noopener";
    if (ui.avatar.tagName === "A") { ui.avatar.href = prof; ui.avatar.target = "_blank"; ui.avatar.rel = "noopener"; }
    avatar(ui.avatar, p);
    ui.follow.hidden = owner;
    ui.save.hidden = owner;
    // The generic-tag messaging now lives in the onboarding view (see paintOnboard).
    ui.status.textContent = "";
    if (ui.stats) ui.stats.hidden = !SHOW_STATS;
    if (SHOW_STATS) paintStats();
    paintActions();
    paintPins();
    paintNotes();
    paintCount();
  }

  // The profile owner's pinned sites — a simple row of avatar + name chips, each
  // a doorway to that site (its own URL if any, else its Den profile). Read-only
  // here; pinning is managed from the dashboard.
  function paintPins() {
    if (!ui.pins) return;
    var items = (card && card.pinned) || [];
    ui.pins.textContent = "";
    ui.pins.hidden = !items.length;
    items.forEach(function (p) {
      var chip = node("a", "pin");
      chip.href = p.url || profileUrl(p);
      chip.target = "_blank";
      chip.rel = "noopener";
      var av = node("span", "pin-av");
      avatar(av, p);
      chip.append(av, node("span", "pin-name", p.name || p.handle || "Site"));
      ui.pins.append(chip);
    });
  }

  // Numeric stats (views/followers). Hidden for now via SHOW_STATS, but kept whole
  // so re-enabling is a one-line flip.
  function paintStats() {
    var s = card.stats || {};
    ui.views.textContent = compact(s.views);
    ui.followers.textContent = compact(s.followers);
    var base = profileUrl(card.profile || {});
    ui.viewsLink.href = base + "#views";
    ui.followersLink.href = base + "#followers";
    ui.viewsLink.target = ui.followersLink.target = "_blank";
    ui.viewsLink.rel = ui.followersLink.rel = "noopener";
  }

  // Follow + save button state. Save flips to a tick when saved; follow reads
  // "Following" with a tick — both change instantly on click.
  function paintActions() {
    var s = (card && card.stats) || {};
    var following = !!s.viewerFollows;
    ui.follow.classList.toggle("on", following);
    ui.follow.innerHTML = following ? icon("check") + "<span>Following</span>" : "<span>Follow</span>";
    ui.save.classList.toggle("on", !!s.viewerSaved);
    ui.save.innerHTML = icon(s.viewerSaved ? "check" : "bookmark");
    ui.save.setAttribute("aria-label", s.viewerSaved ? "Saved" : "Save this site");
  }

  function paintNotes() {
    ui.notes.textContent = "";
    var all = card.comments || [];
    var items = all.slice(-3).reverse();
    paintCount();
    if (!items.length) return;
    items.forEach(function (n) { ui.notes.append(note(n)); });
    // More than fits here → a tappable link to the full profile on Den.
    if (all.length > 3) {
      var more = node("a", "see-all", "See all " + compact(all.length));
      more.href = profileUrl(card.profile || {});
      more.target = "_blank";
      more.rel = "noopener";
      ui.notes.append(more);
    }
  }

  function paintCount() {
    if (ui.count) {
      var n = (card && card.comments && card.comments.length) || 0;
      ui.count.textContent = compact(n);
      ui.count.hidden = !n;
    }
  }

  function note(n) {
    var a = n.redacted ? {} : n.author || {};
    var reaction = !n.redacted && isReaction(n.body) ? n.body.trim() : "";
    var row = node("div", "note");
    var av = node("span", "note-av" + (n.redacted ? " private-av" : ""));
    var copy = node("div", "note-copy");
    var line = node("div", "note-line");

    if (n.redacted) av.append(badge("mail-badge", icon("mail")));
    else { avatar(av, a); if (reaction) av.append(badge("react-badge", reaction)); }

    line.append(n.redacted ? node("b", "", "Someone") : author(a));
    if (n.redacted) line.append(document.createTextNode(" left a private note"));
    else if (!reaction && n.visibility === "private") line.append(node("span", "badge", "private"));
    copy.append(line);
    if (!n.redacted && !reaction && n.body) copy.append(node("p", "", n.body));
    row.append(av, copy);
    return row;
  }

  function author(a) {
    if (!a.url) return node("b", "", a.name || "Someone");
    var link = node("a", "author", a.name || "Someone");
    link.href = a.url;
    link.target = "_blank";
    link.rel = "noopener";
    return link;
  }

  // The /w.js onboarding view. Two states share one layout:
  //  • signed out → explain Den, with a button that opens the auth popup. Sign-in
  //    IS sign-up here (a new Google/email account is created on the spot), so a
  //    visitor goes from "never heard of Den" to a live account without leaving.
  //  • signed in  → success + the permanent /w/<id>.js tag to copy, so the owner
  //    (or their agent) can swap the generic line for their stable one.
  function paintOnboard(signedIn, p) {
    toggleTray(false);
    if (signedIn) {
      ui.obTitle.textContent = "You're on Den" + (p.name ? ", " + firstName(p.name) : "") + " 🎉";
      ui.obBody.textContent = "Your account is live and this site is now yours. To lock it in, replace the line on your site with your permanent tag — it keeps your followers attached even if your domain ever changes.";
      ui.obCta.textContent = "Open your dashboard";
      ui.obCta.onclick = function () { openTab(cfg.api + "/"); };
      ui.obAlt.hidden = true;
      ui.obCode.textContent = tagLine(card.script);
      ui.obTag.hidden = false;
    } else {
      ui.obTitle.textContent = "Welcome to Den";
      ui.obBody.textContent = "Den connects personal sites into one network — followers, notes, and a profile that's yours. This widget is now live here. Create your account to claim this site.";
      ui.obCta.textContent = "Create your account";
      ui.obCta.onclick = signIn;
      ui.obAlt.textContent = "I already have an account";
      ui.obAlt.onclick = signIn;
      ui.obAlt.hidden = false;
      ui.obTag.hidden = true;
    }
  }
  // Copy the full <script> line (not just the URL) so it can be pasted as-is.
  function copyTag() {
    var text = tagLine(card && card.script);
    try { if (navigator.clipboard) navigator.clipboard.writeText(text).catch(function () {}); } catch (_) {}
    var old = ui.obCopy.textContent;
    ui.obCopy.textContent = "Copied";
    setTimeout(function () { ui.obCopy.textContent = old; }, 1400);
  }
  // Split "script" so the string is inert even if the widget is ever inlined.
  function tagLine(src) { return '<scr' + 'ipt src="' + (src || cfg.api + "/w.js") + '"></scr' + 'ipt>'; }
  function firstName(n) { return String(n).trim().split(/\s+/)[0]; }

  function paintSend() {
    ui.send.classList.toggle("ready", !!ui.input.value.trim());
  }

  function restoreDraft() {
    ui.input.value = store(draftKey) || "";
    paintSend();
  }

  function signIn() {
    window.open(cfg.api + "/auth?popup=1&return=" + encodeURIComponent(location.href), "den-auth", "width=420,height=560");
  }

  // The display name we hand the compose / confirmation pages, so they can greet
  // the visitor with whose site they're writing on before the card even loads.
  function siteName() {
    return (card && card.profile && (card.profile.name || card.profile.handle)) || document.title || "this site";
  }
  // A deep link into the main Den app (a hash route — the SPA reads the query
  // off the hash). Absolute, so it works from any host site.
  function mainUrl(path, params) {
    var q = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
    }).join("&");
    return cfg.api + "/#" + path + (q ? "?" + q : "");
  }
  // Everything the widget opens goes to a NEW TAB — it lives on someone else's
  // page and must never navigate the host site away.
  function openTab(url) {
    window.open(url, "_blank", "noopener");
  }
  function fail() {
    ui.status.textContent = "Couldn’t load Den.";
  }
  function open(on) {
    var w = ui.wrap;
    if (on) {
      w.classList.remove("closing");
      w.classList.add("open");
    } else if (w.classList.contains("open")) {
      // Play the open animation in reverse, then fully hide on completion.
      w.classList.remove("open");
      w.classList.add("closing");
      var t;
      var done = function () { clearTimeout(t); w.classList.remove("closing"); ui.panel.removeEventListener("animationend", done); };
      t = setTimeout(done, 320); // fallback if animationend never fires (e.g. reduced motion)
      ui.panel.addEventListener("animationend", done);
    }
    ui.open.setAttribute("aria-expanded", String(!!on));
  }

  function api(path, body) {
    var headers = {};
    var token = store(tokenKey);
    if (token) headers.authorization = "Bearer " + token;
    if (body) headers["content-type"] = "application/json";
    return fetch(cfg.api + path, {
      method: body ? "POST" : "GET",
      headers: headers,
      credentials: "include",
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      if (!r.ok) throw Object.assign(new Error(r.status), { status: r.status });
      return r.json();
    });
  }

  function html(c) {
    return '<div class="den ' + c.position + ' ' + c.theme + ' launcher-' + c.launcher + '">' +
      '<section class="card" role="dialog" aria-label="Den profile card">' +
        '<header class="top">' +
          '<a class="avatar" aria-label="View profile"></a>' +
          '<div class="actions">' +
            '<button class="save" aria-label="Save this site">' + icon("bookmark") + '</button>' +
            '<button class="follow">Follow</button>' +
          '</div>' +
        '</header>' +
        '<a class="name"></a>' +
        '<nav class="stats">' + stat("views", "Views") + stat("followers", "Followers") + '</nav>' +
        '<div class="notes"></div><div class="status"></div>' +
        '<div class="tray" role="group" aria-label="Send a reaction" hidden></div>' +
        '<div class="composer">' +
          '<input class="input" aria-label="Leave a note" placeholder="Leave a note…">' +
          '<button class="react" aria-label="React with an emoji">' + icon("smile-plus") + '</button>' +
          '<button class="send" aria-label="Write a note">' + icon("arrow-up") + '</button>' +
        '</div>' +
        '<div class="onboard">' +
          '<div class="ob-mark"><span class="logo">den</span></div>' +
          '<h2 class="ob-title"></h2>' +
          '<p class="ob-body"></p>' +
          '<button class="ob-cta"></button>' +
          '<button class="ob-alt" hidden></button>' +
          '<div class="ob-tag" hidden><code class="ob-code"></code><button class="ob-copy">Copy</button></div>' +
        '</div>' +
      "</section>" + launcher(c.launcher) + "</div>";
  }
  function launcher(kind) {
    var avatar = '<span class="pill-avatar"></span>';
    var name = '<span class="pill-name">Den</span>';
    var logo = '<span class="logo">den</span>';
    var star = '<span class="logo">✦</span>';
    var inner = {
      avatar: avatar,
      circle: avatar,
      logo: logo,
      mark: star,
      glass: avatar + name,
      neon: avatar + name,
      halo: avatar,
      slab: logo + name,
      pill: avatar + name,
    }[kind] || avatar + name;
    return '<button class="launcher" aria-label="Toggle Den card" aria-expanded="false">' + inner + '<span class="notif" hidden>0</span></button>';
  }
  function stat(key, label) {
    return '<a class="' + key + '-link stat"><b class="' + key + '">–</b><span>' + label + "</span></a>";
  }
  function map(root) {
    var q = function (s) { return root.querySelector(s); };
    return {
      wrap: q(".den"), panel: q(".card"), open: q(".launcher"), avatar: q(".avatar"), pillAvatar: q(".pill-avatar"),
      pillName: q(".pill-name"), count: q(".notif"), save: q(".save"), follow: q(".follow"), name: q(".name"),
      pins: q(".pins"), notes: q(".notes"), status: q(".status"), input: q(".input"),
      react: q(".react"), send: q(".send"), tray: q(".tray"),
      stats: q(".stats"), views: q(".views"), followers: q(".followers"),
      viewsLink: q(".views-link"), followersLink: q(".followers-link"),
      onboard: q(".onboard"), obTitle: q(".ob-title"), obBody: q(".ob-body"),
      obCta: q(".ob-cta"), obAlt: q(".ob-alt"), obTag: q(".ob-tag"),
      obCode: q(".ob-code"), obCopy: q(".ob-copy"),
    };
  }

  // Lucide icons (https://lucide.dev), inlined so the widget stays a single
  // dependency-free file inside its shadow root.
  function icon(name) {
    var p = {
      bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
      check: '<path d="M20 6 9 17l-5-5"/>',
      x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
      "smile-plus": '<path d="M22 11v1a10 10 0 1 1-9-10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" x2="9.01" y1="9" y2="9"/><line x1="15" x2="15.01" y1="9" y2="9"/><path d="M16 5h6"/><path d="M19 2v6"/>',
      "arrow-up": '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
      mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
    }[name] || "";
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + "</svg>";
  }
  function badge(cls, content) {
    var b = node("span", cls);
    if (/[<]/.test(content)) b.innerHTML = content; else b.textContent = content;
    return b;
  }
  // A note is a "reaction" when its body is just one or a few emoji — it then
  // renders as a small badge on the author's avatar instead of a text line.
  function isReaction(s) {
    s = (s || "").trim();
    if (!s) return false;
    try {
      if (Array.from(s).length > 4) return false;
      return /^(?:\p{Extended_Pictographic}|️|‍|[\u{1F3FB}-\u{1F3FF}])+$/u.test(s);
    } catch (_) {
      return s.length <= 4 && /^[^\w\s.,!?'"()\-]+$/.test(s);
    }
  }

  function style() {
    return "<style>" +
      ':host{all:initial}.den,.den *{box-sizing:border-box}' +
      '.den{position:fixed;z-index:2147483000;display:flex;flex-direction:column;align-items:flex-end;gap:14px;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;--ff:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;--bg:#fff;--ink:#050505;--muted:#8a8a8a;--soft:#f3f3f1;--line:#ececea;--accent:#050505;--shadow:0 24px 80px rgba(0,0,0,.16)}' +
      '.den button{font-family:inherit;-webkit-tap-highlight-color:transparent;cursor:pointer;border:0}' +
      '.den svg{width:1em;height:1em;display:block}' +
      '.dark{--bg:#161616;--ink:#f6f6f2;--muted:#9a9a9a;--soft:#242424;--line:#2e2e2e;--accent:#fff;--shadow:0 24px 80px rgba(0,0,0,.5)}' +
      '.bottom-right{right:max(16px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom))}' +
      '.bottom-left{left:max(16px,env(safe-area-inset-left));bottom:max(16px,env(safe-area-inset-bottom));align-items:flex-start}' +
      '.top-right{right:max(16px,env(safe-area-inset-right));top:max(16px,env(safe-area-inset-top));flex-direction:column-reverse}' +
      '.top-left{left:max(16px,env(safe-area-inset-left));top:max(16px,env(safe-area-inset-top));flex-direction:column-reverse;align-items:flex-start}' +
      '.card{width:392px;max-width:calc(100vw - 32px);max-height:calc(100dvh - 120px);overflow:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:30px;box-shadow:var(--shadow);padding:26px 24px}' +
      '.den:not(.open):not(.closing) .card{display:none}.open .card{animation:denPop .2s cubic-bezier(.2,.7,.3,1)}.closing .card{animation:denPopOut .17s cubic-bezier(.4,0,.7,.3) forwards;pointer-events:none}@keyframes denPop{from{opacity:0;transform:translateY(10px) scale(.97)}}@keyframes denPopOut{to{opacity:0;transform:translateY(10px) scale(.97)}}' +
      '.top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}' +
      '.avatar{width:92px;height:92px;border-radius:50%;background:#e5e7eb center/cover no-repeat;display:grid;place-items:center;color:#111;font:600 32px/1 var(--ff);flex:0 0 auto;text-decoration:none;cursor:pointer}' +
      '.actions{display:flex;align-items:center;gap:10px}' +
      '.save{width:50px;height:50px;border-radius:50%;background:var(--soft);color:var(--ink);font-size:21px;display:grid;place-items:center}.save:hover{background:var(--line)}.save.on{background:var(--accent);color:var(--bg)}' +
      '.follow{display:inline-flex;align-items:center;justify-content:center;gap:7px;height:50px;padding:0 26px;border-radius:999px;background:var(--accent);color:var(--bg);font:600 17px/1 var(--ff)}.follow:hover{opacity:.9}.follow.on{background:var(--soft);color:var(--ink)}' +
      '.name{display:inline-block;margin:18px 0 24px;color:var(--ink);font:600 28px/1.15 var(--ff);letter-spacing:-.02em;text-decoration:none}.name:hover{text-decoration:underline;text-underline-offset:4px}' +
      '.stats{display:flex;flex-wrap:wrap;gap:8px 22px;margin:16px 0 26px}.stats[hidden]{display:none}.stat{color:var(--muted);text-decoration:none;font-size:16px;font-weight:600}.stat b{color:var(--ink);font-weight:800;margin-right:5px}.stat:hover span{text-decoration:underline;text-underline-offset:3px}' +
      '.pins{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 24px}.pins[hidden]{display:none}' +
      '.pin{display:flex;align-items:center;gap:7px;max-width:100%;padding:5px 12px 5px 5px;border:1px solid var(--line);border-radius:999px;color:var(--ink);text-decoration:none;font:700 13px/1 var(--ff)}.pin:hover{background:var(--soft)}' +
      '.pin-av{width:24px;height:24px;border-radius:50%;background:#e5e7eb center/cover no-repeat;display:grid;place-items:center;color:#111;font:800 11px/1 var(--ff);flex:0 0 auto}' +
      '.pin-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:130px}' +
      '.notes{display:grid;gap:16px}.note{display:flex;align-items:center;gap:12px}' +
      '.note-av{position:relative;width:46px;height:46px;flex:0 0 auto;border-radius:50%;background:#e5e7eb center/cover no-repeat;display:grid;place-items:center;color:#111;font:600 17px/1 var(--ff)}' +
      '.private-av{background:var(--soft);color:var(--muted)}.private-av::before{content:"";width:21px;height:21px;border-radius:50%;background:currentColor;opacity:.5;box-shadow:0 15px 0 -1px currentColor}' +
      '.react-badge{position:absolute;right:-6px;bottom:-6px;display:grid;place-items:center;font-size:16px;line-height:1}' +
      '.mail-badge{position:absolute;right:-5px;bottom:-5px;width:23px;height:23px;border-radius:50%;background:var(--bg);box-shadow:0 1px 4px rgba(0,0,0,.18);display:grid;place-items:center;color:#ff2d55;font-size:13px}' +
      '.note-copy{min-width:0}.note-line{font-size:15px;color:var(--ink);line-height:1.3}.author,.note-line b{color:var(--ink);font-weight:600;text-decoration:none}.author:hover{text-decoration:underline}.note p{margin:2px 0 0;font-size:14px;color:var(--ink);overflow-wrap:anywhere}' +
      '.badge{margin-left:7px;border:1px solid var(--line);border-radius:999px;padding:2px 8px;font-size:11px;font-weight:600;color:var(--muted)}.empty{color:var(--muted);font-size:14px}.see-all{justify-self:start;display:inline-flex;align-items:center;min-height:44px;margin-top:2px;padding:0 20px;border:1px solid var(--line);border-radius:999px;color:var(--ink);text-decoration:none;font:600 14px/1 var(--ff)}.see-all:hover{background:var(--soft);text-decoration:none}' +
      '.status{color:var(--muted);font-size:13px;margin-top:10px;overflow-wrap:anywhere}.status:empty{display:none}' +
      '.composer{display:flex;align-items:center;gap:4px;margin-top:24px;padding:6px;border:1px solid var(--line);border-radius:999px;background:var(--bg);box-shadow:0 10px 36px rgba(0,0,0,.07)}.composer:focus-within{border-color:var(--muted)}' +
      '.input{flex:1;min-width:0;border:0;background:transparent;color:var(--ink);font:400 16px/1 var(--ff);padding:12px 8px 12px 14px;outline:none}.input::placeholder{color:var(--muted);font-weight:400}' +
      '.react{width:40px;height:40px;border-radius:50%;background:transparent;color:var(--muted);font-size:18px;display:grid;place-items:center}.react:hover{background:var(--soft);color:var(--ink)}.react.on{background:var(--soft);color:var(--ink)}' +
      '.tray{display:flex;flex-wrap:wrap;gap:4px;margin-top:14px;padding:6px;border:1px solid var(--line);border-radius:20px;background:var(--bg);box-shadow:0 10px 36px rgba(0,0,0,.07)}.tray[hidden]{display:none}' +
      '.emoji{flex:1 0 auto;min-width:44px;height:44px;border-radius:14px;background:transparent;font-size:24px;line-height:1;display:grid;place-items:center;transition:transform .12s ease,background .12s ease}.emoji:hover{background:var(--soft);transform:translateY(-2px)}.emoji:active{transform:scale(.9)}' +
      '.send{width:42px;height:42px;border-radius:50%;background:var(--soft);color:var(--muted);font-size:22px;display:grid;place-items:center;transition:background .15s ease,color .15s ease}.send.ready{background:var(--accent);color:var(--bg)}.send:hover{color:var(--ink)}.send.ready:hover{color:var(--bg);opacity:.9}' +
      '.launcher{position:relative;display:flex;align-items:center;gap:9px;border:1px solid var(--line);background:#fff;color:#050505;border-radius:999px;padding:6px 16px 6px 6px;box-shadow:var(--shadow);font:600 14px/1 var(--ff);transition:transform .16s ease}.launcher:hover{transform:translateY(-2px)}' +
      '.pill-avatar{width:30px;height:30px;border-radius:50%;background:#e5e7eb center/cover no-repeat;display:grid;place-items:center;color:#111;font-weight:600;flex:0 0 auto}' +
      '.notif{position:absolute;top:-7px;right:-7px;min-width:22px;height:22px;padding:0 6px;border:2px solid #fff;border-radius:999px;background:#ff2d55;color:#fff;display:grid;place-items:center;font:900 11px/1 var(--ff)}.notif[hidden]{display:none}' +
      '.logo{display:grid;place-items:center;font-weight:950;letter-spacing:-.02em}' +
      '.launcher-avatar .launcher,.launcher-circle .launcher,.launcher-logo .launcher,.launcher-mark .launcher,.launcher-halo .launcher{padding:6px;width:62px;height:62px;justify-content:center}.launcher-avatar .pill-avatar,.launcher-circle .pill-avatar,.launcher-halo .pill-avatar{width:50px;height:50px}.launcher-avatar .launcher,.launcher-avatar .pill-avatar{border-radius:18px}.launcher-circle .launcher,.launcher-circle .pill-avatar,.launcher-logo .launcher,.launcher-mark .launcher,.launcher-halo .launcher,.launcher-halo .pill-avatar{border-radius:50%}' +
      '.launcher-logo .launcher,.launcher-mark .launcher{padding:0;background:#000;color:#fff;border-color:#000}.launcher-logo .logo{font-size:17px}.launcher-mark .logo{font-size:26px}.launcher-glass .launcher{background:rgba(255,255,255,.72);backdrop-filter:blur(18px);border-color:rgba(255,255,255,.7)}.launcher-neon .launcher{border-color:#ffd1ef;box-shadow:0 0 0 1px #ffd1ef,0 12px 44px rgba(255,45,133,.28),0 0 38px rgba(117,92,255,.18)}.launcher-halo .launcher{box-shadow:0 0 0 7px rgba(255,45,85,.08),0 20px 70px rgba(0,0,0,.18)}.launcher-slab .launcher{border-radius:18px;padding:9px 16px;background:#050505;color:#fff;border-color:#050505}.launcher-slab .logo{width:26px;height:26px;border-radius:8px;background:#fff;color:#000}.launcher-slab .notif,.launcher-logo .notif,.launcher-mark .notif{border-color:#050505}' +
      '@media(max-width:520px){.den{left:max(12px,env(safe-area-inset-left))!important;right:max(12px,env(safe-area-inset-right))!important;bottom:max(12px,env(safe-area-inset-bottom))!important;top:auto!important;flex-direction:column!important}.card{width:calc(100vw - 24px);max-width:none;max-height:calc(100dvh - 110px);padding:22px 20px;border-radius:26px}.avatar{width:78px;height:78px;font-size:28px}.follow,.save{height:46px}.save{width:46px}.follow{padding:0 22px;font-size:16px}.name{font-size:34px}}' +
      "</style>";
  }

  function ready(fn) { document.body ? fn() : document.addEventListener("DOMContentLoaded", fn); }
  function idOf(s) {
    var id = s.getAttribute("data-id");
    if (id) return id.indexOf("den:") === 0 ? id : "den:" + id;
    try { var m = new URL(s.src).pathname.match(/\/w\/([a-z0-9]+)(?:\.js)?$/i); return m && "den:" + m[1]; } catch (_) {}
  }
  function enc(s) { return encodeURIComponent(s); }
  function profileUrl(p) { return cfg.api + (p.handle ? "/@" + encodeURIComponent(p.handle) : "/"); }
  function store(k, v) { try { if (arguments.length > 1) return v ? localStorage.setItem(k, v) : localStorage.removeItem(k); return localStorage.getItem(k) || ""; } catch (_) { return ""; } }
  function node(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function avatar(el, m) {
    if (!el) return;
    if (m && m.avatar) { el.style.backgroundImage = "url(" + JSON.stringify(String(m.avatar)) + ")"; el.textContent = ""; }
    else { el.style.backgroundImage = ""; el.textContent = ((m && (m.name || m.handle)) || "?").trim().charAt(0).toUpperCase(); }
  }
  function compact(n) {
    n = Number(n) || 0;
    return n < 1e3 ? String(n) : n < 1e6 ? (n / 1e3).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, "") + "K" : (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  }
})();
