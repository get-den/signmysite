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
    launcher: script.getAttribute("data-launcher") || "pill",
    collapsed: script.getAttribute("data-collapsed") === "true",
  };
  cfg.generic = !cfg.id;

  var card, ui, busy = false, viewed = false, isPrivate = false;
  var draftKey = "den_draft_" + cfg.id;
  var tokenKey = "den_token";

  ready(start);

  function start() {
    var host = document.createElement("div");
    var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
    host.setAttribute("data-den-widget", "");
    document.body.appendChild(host);
    root.innerHTML = style() + html(cfg);
    ui = map(root);

    ui.open.onclick = function () { open(true); };
    ui.close.onclick = function () { open(false); };
    ui.follow.onclick = function () { toggle("/api/follow", ui.follow); };
    ui.save.onclick = function () { toggle("/api/save", ui.save); };
    ui.private.onclick = function () { isPrivate = !isPrivate; paintPrivate(); ui.input.focus(); };
    ui.send.onclick = submit;
    ui.input.oninput = function () { ui.input.value.trim() ? saveDraft() : store(draftKey, ""); };
    ui.input.onkeydown = function (e) { if (e.key === "Enter") submit(); };
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") open(false); });
    window.addEventListener("message", function (e) {
      if (e.data && e.data.den === "signed-in") {
        store(tokenKey, e.data.token || "");
        load().then(postDraft);
      }
    });

    restoreDraft();
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

  async function toggle(path, button) {
    if (busy) return;
    if (!cfg.id) return signIn();
    busy = true;
    try {
      card.stats = await api(path, { id: cfg.id });
      ui.status.textContent = "";
      paintStats();
    } catch (e) {
      e.status === 401 ? signIn() : flash(button);
    } finally { busy = false; }
  }

  async function submit() {
    var body = ui.input.value.trim();
    if (!body || busy) return;
    saveDraft();
    if (!card || !card.viewer) return signIn();
    await postNote(body, isPrivate);
  }

  async function postNote(body, priv) {
    busy = true;
    try {
      card.comments = await api("/api/profile/" + enc(cfg.id) + "/comments", {
        body: body,
        visibility: priv ? "private" : "public",
      });
      ui.input.value = "";
      store(draftKey, "");
      paintNotes();
    } catch (e) {
      e.status === 401 ? signIn() : flash(ui.send);
    } finally { busy = false; }
  }

  function paint() {
    var p = card.profile || {};
    var owner = card.viewer && card.viewer.id === cfg.id;
    var href = p.url || profileUrl(p);

    ui.name.textContent = p.name || p.handle || "Someone";
    ui.name.href = href;
    ui.name.target = p.url ? "_blank" : "_self";
    ui.name.rel = "noopener";
    ui.bio.textContent = p.bio || "A personal site on Den.";
    if (ui.pillName) ui.pillName.textContent = p.name || p.handle || "Den";
    avatar(ui.avatar, p);
    avatar(ui.pillAvatar, p);
    ui.follow.hidden = owner;
    ui.save.hidden = owner;
    ui.status.textContent = cfg.generic
      ? card.viewer
        ? "Connected. Permanent tag: " + card.script
        : "Generic tag active. Sign in to personalize."
      : "";
    paintStats();
    paintNotes();
    paintCount();
  }

  function paintStats() {
    var s = card.stats || {};
    [["views", "views"], ["followers", "followers"], ["following", "following"], ["saved", "saved"]]
      .forEach(function (x) { ui[x[0]].textContent = compact(s[x[1]]); });

    ui.follow.textContent = s.viewerFollows ? "Following" : "Follow";
    ui.follow.classList.toggle("on", !!s.viewerFollows);
    ui.save.classList.toggle("on", !!s.viewerSaved);
    ui.save.setAttribute("aria-label", s.viewerSaved ? "Unsave this site" : "Save this site");

    var base = profileUrl(card.profile || {});
    ["views", "followers", "following", "saved"].forEach(function (k) {
      ui[k + "Link"].href = base + "#" + k;
    });
  }

  function paintNotes() {
    ui.notes.textContent = "";
    var items = (card.comments || []).slice(-4).reverse();
    paintCount();
    if (!items.length) return ui.notes.append(node("div", "empty", "Be the first to leave a note."));
    items.forEach(function (n) { ui.notes.append(note(n)); });
  }

  function paintCount() {
    if (ui.count) ui.count.textContent = compact((card && card.comments && card.comments.length) || 3);
  }

  function note(n) {
    var a = n.redacted ? {} : n.author || {};
    var row = node("div", "note");
    var av = node("span", "note-av" + (n.redacted ? " private-av" : ""), n.redacted ? "✉" : "");
    var copy = node("div", "note-copy");
    var line = node("div", "note-line");

    if (!n.redacted) avatar(av, a);
    line.append(n.redacted ? node("b", "", "Someone") : author(a));
    line.append(document.createTextNode(n.redacted ? " left a private note" : ""));
    if (!n.redacted && n.visibility === "private") line.append(node("span", "badge", "private"));
    copy.append(line);
    if (!n.redacted && n.body) copy.append(node("p", "", n.body));
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

  function paintPrivate() {
    ui.private.classList.toggle("on", isPrivate);
    ui.private.setAttribute("aria-pressed", String(isPrivate));
    ui.input.placeholder = isPrivate ? "Leave a private note…" : "Leave a note…";
  }

  function saveDraft() {
    store(draftKey, JSON.stringify({ text: ui.input.value.trim(), priv: isPrivate }));
  }
  function restoreDraft() {
    var draft = readDraft();
    if (!draft) return;
    ui.input.value = draft.text || "";
    isPrivate = !!draft.priv;
    paintPrivate();
  }
  function readDraft() {
    try { return JSON.parse(store(draftKey) || "null"); } catch (_) { return null; }
  }
  function postDraft() {
    var draft = readDraft();
    if (draft && draft.text && card && card.viewer) return postNote(draft.text, draft.priv);
  }

  function signIn() {
    window.open(cfg.api + "/auth?popup=1&return=" + encodeURIComponent(location.href), "den-auth", "width=420,height=560");
  }
  function fail() {
    ui.status.textContent = "Couldn’t load Den.";
  }
  function open(on) {
    ui.wrap.classList.toggle("open", on);
    ui.open.setAttribute("aria-expanded", String(on));
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
        '<button class="x" aria-label="Collapse Den card">×</button><div class="top">' +
          '<div class="avatar"></div><div class="actions"><button class="save" aria-label="Save this site">⌑</button><button class="follow">Follow</button></div>' +
        '</div><a class="name"></a><p class="bio"></p><nav class="stats">' +
          stat("views", "Views") + stat("followers", "Followers") + stat("following", "Following") + stat("saved", "Saved") +
        '</nav><div class="notes-head"><b>Notes</b><span>Public and private replies</span></div><div class="notes"></div><div class="status"></div>' +
        '<div class="composer"><input class="input" aria-label="Leave a note" placeholder="Leave a note…"><button class="private" aria-pressed="false">Private</button><button class="send" aria-label="Send note">+</button></div>' +
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
    return '<button class="launcher" aria-label="Open Den card" aria-expanded="false">' + inner + '<span class="notif">3</span></button>';
  }
  function stat(key, label) {
    return '<a class="' + key + '-link stat"><b class="' + key + '">–</b><span>' + label + "</span></a>";
  }
  function map(root) {
    var q = function (s) { return root.querySelector(s); };
    return {
      wrap: q(".den"), open: q(".launcher"), close: q(".x"), avatar: q(".avatar"), pillAvatar: q(".pill-avatar"),
      pillName: q(".pill-name"), count: q(".notif"), save: q(".save"), follow: q(".follow"), name: q(".name"), bio: q(".bio"),
      notes: q(".notes"), status: q(".status"), input: q(".input"), private: q(".private"), send: q(".send"),
      views: q(".views"), followers: q(".followers"), following: q(".following"), saved: q(".saved"),
      viewsLink: q(".views-link"), followersLink: q(".followers-link"), followingLink: q(".following-link"), savedLink: q(".saved-link"),
    };
  }

  function style() {
    return '<style>' +
      ':host{all:initial}.den,.den *{box-sizing:border-box}.den{position:fixed;z-index:2147483000;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;--bg:#fff;--ink:#050505;--muted:#767676;--soft:#f4f4f2;--line:#e8e8e5;--shadow:0 24px 80px rgba(0,0,0,.16)}button{font:inherit;-webkit-tap-highlight-color:transparent}' +
      '.dark{--bg:#161616;--ink:#f6f6f2;--muted:#a0a0a0;--soft:#242424;--line:#333;--shadow:0 24px 80px rgba(0,0,0,.5)}.bottom-right{right:max(16px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom))}.bottom-left{left:max(16px,env(safe-area-inset-left));bottom:max(16px,env(safe-area-inset-bottom))}.top-right{right:max(16px,env(safe-area-inset-right));top:max(16px,env(safe-area-inset-top))}.top-left{left:max(16px,env(safe-area-inset-left));top:max(16px,env(safe-area-inset-top))}' +
      '.card{position:relative;width:430px;max-width:calc(100vw - 32px);max-height:calc(100dvh - 32px);overflow:auto;overscroll-behavior:contain;background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:34px;box-shadow:var(--shadow);padding:28px;opacity:0;transform:translateY(14px) scale(.97);pointer-events:none;transition:.18s ease}.open .card{opacity:1;transform:none;pointer-events:auto}' +
      '.launcher{position:absolute;right:0;bottom:0;display:flex;align-items:center;gap:9px;border:1px solid var(--line);background:#fff;color:#050505;border-radius:999px;padding:6px 14px 6px 6px;box-shadow:var(--shadow);font:800 14px/1 inherit;cursor:pointer;transition:transform .16s ease}.launcher:hover{transform:translateY(-2px)}.open .launcher{opacity:0;pointer-events:none}.bottom-left .launcher,.top-left .launcher{left:0;right:auto}.top-left .launcher,.top-right .launcher{top:0;bottom:auto}.notif{position:absolute;top:-7px;right:-7px;min-width:22px;height:22px;padding:0 6px;border:2px solid #fff;border-radius:999px;background:#ff2d55;color:#fff;display:grid;place-items:center;font:900 11px/1 inherit}' +
      '.x{position:absolute;top:18px;right:20px;width:34px;height:34px;border:0;border-radius:50%;background:transparent;color:var(--muted);font-size:24px;cursor:pointer}.x:hover,.follow.on,.private{background:var(--soft);color:var(--ink)}.top{display:flex;justify-content:space-between;gap:20px}.avatar,.pill-avatar,.note-av{border-radius:50%;background:#e5e7eb center/cover no-repeat;display:grid;place-items:center;color:#111;font-weight:900}.avatar{width:98px;height:98px;font-size:34px}.pill-avatar{width:30px;height:30px}.actions{display:flex;gap:10px;margin-top:18px}' +
      '.logo{display:grid;place-items:center;font-weight:950;letter-spacing:-.06em}.launcher-avatar .launcher,.launcher-circle .launcher,.launcher-logo .launcher,.launcher-mark .launcher,.launcher-halo .launcher{padding:6px;width:66px;height:66px;justify-content:center}.launcher-avatar .pill-avatar,.launcher-circle .pill-avatar,.launcher-halo .pill-avatar{width:52px;height:52px}.launcher-avatar .launcher,.launcher-avatar .pill-avatar{border-radius:18px}.launcher-circle .launcher,.launcher-circle .pill-avatar,.launcher-logo .launcher,.launcher-mark .launcher,.launcher-halo .launcher,.launcher-halo .pill-avatar{border-radius:50%}.launcher-logo .launcher,.launcher-mark .launcher{padding:0;background:#000;color:#fff;border-color:#000}.launcher-logo .logo{font-size:17px}.launcher-mark .logo{font-size:26px}.launcher-glass .launcher{background:rgba(255,255,255,.72);backdrop-filter:blur(18px);border-color:rgba(255,255,255,.7)}.launcher-neon .launcher{border-color:#ffd1ef;box-shadow:0 0 0 1px #ffd1ef,0 12px 44px rgba(255,45,133,.28),0 0 38px rgba(117,92,255,.18)}.launcher-halo .launcher{box-shadow:0 0 0 7px rgba(255,45,85,.08),0 20px 70px rgba(0,0,0,.18)}.launcher-slab .launcher{border-radius:18px;padding:9px 16px;background:#050505;color:#fff;border-color:#050505}.launcher-slab .logo{width:26px;height:26px;border-radius:8px;background:#fff;color:#000}.launcher-slab .notif,.launcher-logo .notif,.launcher-mark .notif{border-color:#050505}' +
      '.save,.follow,.private,.send{border:0;cursor:pointer;font-weight:900}.save{width:56px;height:56px;border-radius:50%;background:var(--soft);border:1px solid var(--line);font-size:24px}.save.on,.follow,.private.on{background:#000;color:#fff;border-color:#000}.follow{height:56px;padding:0 30px;border-radius:999px;font-size:18px}.name{display:inline-block;margin-top:28px;color:var(--ink);font:900 31px/1.05 inherit;letter-spacing:-.04em;text-decoration:none}.name:hover,.stat:hover span{text-decoration:underline;text-underline-offset:5px}.bio{margin:8px 0 0;color:var(--muted);font-weight:600;max-width:32ch}' +
      '.stats{display:flex;flex-wrap:wrap;gap:18px;margin:22px 0 30px}.stat{color:var(--muted);text-decoration:none;font-size:16px}.stat b{color:var(--ink);margin-right:5px}.notes-head{display:flex;justify-content:space-between;gap:12px;margin-bottom:14px}.notes-head span,.empty,.status{color:var(--muted);font-size:13px}.status{margin-top:10px;overflow-wrap:anywhere}.notes{display:grid;gap:16px}.note{display:flex;gap:13px}.note-av{width:48px;height:48px;flex:0 0 auto}.private-av{background:#b5b8bd;color:#fff}.note-line{font-size:15px}.author,.note-line b{color:var(--ink);font-weight:900;text-decoration:none}.author:hover{text-decoration:underline}.note p{margin:6px 0 0;font-size:15px}.badge{margin-left:7px;border:1px solid var(--line);border-radius:999px;padding:2px 7px;font-size:11px;color:var(--muted)}' +
      '.composer{display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:center;margin-top:28px;padding:8px;border:1px solid var(--line);border-radius:999px;background:var(--bg);box-shadow:0 14px 50px rgba(0,0,0,.08)}.input{min-width:0;border:0;background:transparent;color:var(--ink);font:600 16px/1 inherit;padding:13px 12px;outline:none}.private{height:38px;border-radius:999px;padding:0 13px;color:var(--muted);font-size:12px}.send{width:42px;height:42px;border-radius:50%;background:#d7d7d7;color:#fff;font-size:26px}.send:hover{background:#000}' +
      '@media(max-width:520px){.den{left:max(12px,env(safe-area-inset-left))!important;right:max(12px,env(safe-area-inset-right))!important;bottom:max(12px,env(safe-area-inset-bottom))!important;top:auto!important}.card{width:auto;max-width:none;max-height:calc(100dvh - 24px);padding:22px;border-radius:28px}.avatar{width:82px;height:82px}.follow,.save{height:50px}.save{width:50px}.stats{gap:12px}.composer{grid-template-columns:1fr auto}.private{display:none}.launcher{right:0;bottom:0}.top{align-items:flex-start}.name{font-size:28px}}' +
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
  function flash(el) {
    var old = el.textContent;
    el.textContent = "Try again";
    setTimeout(function () { el.textContent = old; }, 1200);
  }
})();
