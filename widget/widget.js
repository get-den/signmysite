/*
 * Den widget — a floating profile + follow + notes badge for any personal site.
 *
 * Paste ONE line, anywhere (footer, header, HTML block). Works on Squarespace,
 * WordPress, Wix, Substack, Jekyll/Hexo, Lovable, Framer, hand-written HTML —
 * static or live — because a <script> tag is the only thing every platform
 * allows.
 *
 *   <script src="https://den.com/w/7f3a9c2e8b1d4f6a.js"></script>
 *
 * Everything it needs rides in on that one URL: the code, the API origin, and
 * whose badge this is (the id in the path). data-id="den:..." also works.
 *
 * Collapsed: a small pill. Expanded: avatar, name, Views + Followers, Follow,
 * and a notes feed where each note links back to its author's blog. Leaving a
 * note can be public (default) or private. Owners see private notes on their
 * own site. Mounts in a shadow DOM (no CSS clash). Zero deps.
 */
(function () {
  "use strict";

  if (window.__denWidget) return;
  window.__denWidget = true;

  var script = document.currentScript ||
    (function () {
      var all = document.querySelectorAll('script[data-id],script[src*="/w/"]');
      return all[all.length - 1] || null;
    })();
  if (!script) return;

  var srcOrigin = "";
  try { srcOrigin = new URL(script.src).origin; } catch (e) {}

  var cfg = {
    id: resolveId(script),
    api: (script.getAttribute("data-api") || srcOrigin || "https://den.com").replace(/\/$/, ""),
    theme: script.getAttribute("data-theme") || "auto",     // auto | light | dark
    position: script.getAttribute("data-position") || "bottom-right",
  };
  if (!cfg.id) {
    console.warn("[den] no id — use src '.../w/<id>.js' or data-id='den:...'");
    return;
  }

  var DRAFT_KEY = "den_draft_" + cfg.id;  // survives a full page navigation
  var TOKEN_KEY = "den_token";            // first-party session token (see below)
  var el, state = {
    me: null, viewer: null, stats: null, comments: null,
    expanded: false, busy: false, viewed: false, isPrivate: false, isOwner: false,
  };

  // Session token lives in the HOST site's own localStorage, sent as a Bearer
  // header — because third-party cookies (den.com's cookie on someone else's
  // site) are blocked by Safari and deprecated in Chrome. This makes Follow,
  // notes, and owner-mode work everywhere, not just where 3rd-party cookies do.
  function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; } }
  function setToken(t) { try { if (t) localStorage.setItem(TOKEN_KEY, t); } catch (e) {} }

  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);

  function start() {
    var hostEl = document.createElement("div");
    hostEl.setAttribute("data-den-widget", "");
    var root = hostEl.attachShadow ? hostEl.attachShadow({ mode: "open" }) : hostEl;
    document.body.appendChild(hostEl);
    root.appendChild(makeStyle());
    el = render();
    root.appendChild(el.wrap);
    el.removeHost = function () { hostEl.remove(); };

    // A sign-in popup messages us when it completes → store the token (so we
    // can auth cross-site without cookies), refresh, then post the preserved note.
    window.addEventListener("message", function (e) {
      if (e && e.data && e.data.den === "signed-in") {
        if (e.data.token) setToken(e.data.token);
        onSignedIn();
      }
    });
    restoreDraft();
    load();
  }

  // ---- data ----------------------------------------------------------------
  async function load() {
    try {
      state.me = await getJSON("/api/profile/" + enc(cfg.id));
    } catch (e) {
      if (e.status === 404) {
        try {
          await postJSON("/api/sites/claim", { id: cfg.id, url: location.origin, name: document.title || "" });
          state.me = await getJSON("/api/profile/" + enc(cfg.id));
        } catch (e2) { return fail(e2); }
      } else { return fail(e); }
    }
    paintIdentity();
    countView();
    await refreshViewer();   // determines owner mode before painting actions
    refreshStats();
    loadComments();
  }
  function fail(e) { console.warn("[den] could not load profile " + cfg.id, e); el.removeHost(); }

  async function refreshViewer() {
    try { state.viewer = await getJSON("/api/viewer"); }
    catch (e) { state.viewer = null; }
    state.isOwner = !!(state.viewer && state.viewer.id === cfg.id);
    paintMode();
  }
  async function refreshStats() {
    try { state.stats = await getJSON("/api/profile/" + enc(cfg.id) + "/stats"); }
    catch (e) { state.stats = null; }
    paintStats();
  }
  async function countView() {
    if (state.viewed) return;
    state.viewed = true;
    try { await postJSON("/api/profile/" + enc(cfg.id) + "/view", {}); } catch (e) {}
  }
  async function loadComments() {
    try { state.comments = await getJSON("/api/profile/" + enc(cfg.id) + "/comments"); }
    catch (e) { state.comments = []; }
    paintComments();
  }

  // ---- actions -------------------------------------------------------------
  async function toggleFollow() {
    if (state.busy) return;
    state.busy = true;
    try {
      var res = await fetch(cfg.api + "/api/follow", post({ id: cfg.id }));
      if (res.status === 401) { state.busy = false; return signIn(); }
      if (!res.ok) throw new Error(res.status);
      state.stats = await res.json();
      paintStats();
    } catch (e) { flash(el.follow, "try again"); }
    finally { state.busy = false; }
  }

  // Send a note. If the visitor isn't signed in, we PRESERVE the draft and
  // route them through auth; onSignedIn() auto-posts it afterward.
  async function submitNote() {
    var text = el.input.value.trim();
    if (!text || state.busy) return;
    saveDraft(text, state.isPrivate); // belt: persists before anything can fail
    if (!state.viewer) return signIn(); // suspenders: popup keeps this page alive too
    await postNote(text, state.isPrivate);
  }

  async function postNote(text, isPrivate) {
    state.busy = true;
    try {
      var res = await fetch(
        cfg.api + "/api/profile/" + enc(cfg.id) + "/comments",
        post({ body: text, visibility: isPrivate ? "private" : "public" })
      );
      if (res.status === 401) { state.busy = false; return signIn(); } // draft still saved
      if (!res.ok) throw new Error(res.status);
      state.comments = await res.json();
      clearDraft();
      el.input.value = "";
      closeComposer();
      paintComments();
    } catch (e) { flash(el.send, "!"); }
    finally { state.busy = false; }
  }

  async function onSignedIn() {
    await refreshViewer();
    refreshStats();
    var d = readDraft();
    if (d && d.text && state.viewer) await postNote(d.text, d.priv);
    else loadComments();
  }

  function signIn() {
    var ret = encodeURIComponent(location.href);
    window.open(cfg.api + "/auth?popup=1&return=" + ret, "den-auth", "width=420,height=560");
  }

  // ---- draft persistence ---------------------------------------------------
  function saveDraft(text, priv) {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ text: text, priv: !!priv })); } catch (e) {}
  }
  function readDraft() {
    try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch (e) { return null; }
  }
  function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (e) {} }
  function restoreDraft() {
    var d = readDraft();
    if (d && d.text) { el.input.value = d.text; state.isPrivate = !!d.priv; openComposer(); paintToggle(); }
  }

  // ---- painting ------------------------------------------------------------
  function paintIdentity() {
    var m = state.me || {};
    el.name.textContent = m.name || m.handle || "Someone";
    setAvatar(el.avatar, m);
    setAvatar(el.pillAvatar, m);
  }
  function paintMode() {
    // Owner viewing their own site: no Follow button (you can't follow yourself).
    el.follow.style.display = state.isOwner ? "none" : "";
    el.wrap.classList.toggle("den-owner", state.isOwner);
  }
  function paintStats() {
    var s = state.stats;
    el.views.textContent = s ? compact(s.views) : "–";
    el.followers.textContent = s ? compact(s.followers) : "–";
    var following = !!(s && s.viewerFollows);
    el.follow.textContent = following ? "Following" : "Follow";
    el.follow.classList.toggle("on", following);
  }
  function paintComments() {
    var list = el.comments;
    clear(list);
    var items = state.comments || [];
    if (!items.length) { list.append(h("div", "den-empty", "No notes yet — leave one.")); return; }
    items.forEach(function (c) {
      var row = h("div", "den-comment");
      var head = h("div", "den-chead");
      if (c.redacted) {
        // A private note the current viewer isn't allowed to read.
        var lock = h("span", "den-cavatar den-lock", "✉");
        var who = h("span", "den-cwho");
        who.append(h("b", "", "Someone"), document.createTextNode(" left a private note"));
        head.append(lock, who);
        row.append(head);
      } else {
        var a = c.author || {};
        var av = h("span", "den-cavatar"); setAvatar(av, a);
        var who2 = h("span", "den-cwho");
        who2.append(h("b", "", a.name || "Someone"));
        if (a.url) {
          var link = h("a", "den-cblog", "(" + hostOf(a.url) + ")");
          link.href = a.url; link.target = "_blank"; link.rel = "noopener";
          who2.append(" ", link);
        } else if (a.handle) {
          who2.append(h("span", "den-cblog", " @" + a.handle));
        }
        if (c.visibility === "private") who2.append(h("span", "den-badge", "private"));
        head.append(av, who2);
        row.append(head);
        if (c.body) row.append(h("div", "den-cbody", c.body));
      }
      list.append(row);
    });
  }
  function paintToggle() {
    el.toggle.classList.toggle("den-on", state.isPrivate);
    el.toggleLabel.textContent = state.isPrivate ? "Private" : "Public";
    el.input.setAttribute("placeholder", state.isPrivate ? "Leave a private note…" : "Leave a note…");
  }

  // ---- composer open/close (slide-out privacy toggle) ----------------------
  function openComposer() { el.wrap.classList.add("den-compose"); }
  function closeComposer() { el.wrap.classList.remove("den-compose"); }

  // ---- DOM -----------------------------------------------------------------
  function render() {
    var wrap = h("div", "den den-" + cfg.position + " den-theme-" + cfg.theme);

    var pill = h("button", "den-pill");
    pill.setAttribute("aria-label", "Open Den profile");
    var pillAvatar = h("span", "den-pill-avatar");
    pill.append(pillAvatar, h("span", "den-mark", "den"));

    var card = h("div", "den-card");
    card.setAttribute("role", "dialog");

    var top = h("div", "den-top");
    var avatar = h("div", "den-avatar");
    var follow = h("button", "den-follow", "Follow");
    follow.onclick = toggleFollow;
    top.append(avatar, follow);

    var name = h("div", "den-name", "");
    var statsRow = h("div", "den-stats");
    var views = h("b", "", "–");
    var followers = h("b", "", "–");
    statsRow.append(stat(views, "Views"), stat(followers, "Followers"));

    var cTitle = h("div", "den-ctitle", "Comments");
    var comments = h("div", "den-comments");

    // composer with a slide-out public/private toggle
    var composer = h("div", "den-composer");
    var toggleRow = h("div", "den-toggle-row");
    var toggle = h("button", "den-toggle");
    toggle.setAttribute("type", "button");
    toggle.setAttribute("role", "switch");
    var knob = h("span", "den-knob");
    toggle.append(knob);
    var toggleLabel = h("span", "den-toggle-label", "Public");
    toggle.onclick = function () { state.isPrivate = !state.isPrivate; paintToggle(); el.input.focus(); };
    var hint = h("span", "den-toggle-hint", "Only the owner sees private notes");
    toggleRow.append(toggle, toggleLabel, hint);

    var inputRow = h("div", "den-input-row");
    var input = h("input", "den-input");
    input.setAttribute("placeholder", "Leave a note…");
    input.setAttribute("aria-label", "Leave a note");
    input.addEventListener("focus", openComposer);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") submitNote(); });
    var send = h("button", "den-send", "→");
    send.setAttribute("aria-label", "Send note");
    send.onclick = submitNote;
    inputRow.append(input, send);

    composer.append(toggleRow, inputRow);
    card.append(top, name, statsRow, cTitle, comments, composer);

    var close = h("button", "den-close", "×");
    close.setAttribute("aria-label", "Close");
    close.onclick = function () { toggle_(false); };
    card.append(close);

    wrap.append(card, pill);

    pill.addEventListener("click", function () { toggle_(true); });
    wrap.addEventListener("mouseleave", function () { if (!el.input.value) toggle_(false); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") toggle_(false); });

    return { wrap: wrap, pill: pill, pillAvatar: pillAvatar, avatar: avatar, follow: follow,
      name: name, views: views, followers: followers, comments: comments,
      input: input, send: send, toggle: toggle, toggleLabel: toggleLabel };

    function stat(valueEl, label) {
      var box = h("span", "den-stat");
      box.append(valueEl, " ", h("span", "den-stat-l", label));
      return box;
    }
  }

  function toggle_(open) {
    state.expanded = open;
    el.wrap.classList.toggle("den-open", open);
    el.pill.setAttribute("aria-expanded", String(open));
    if (!open) closeComposer();
  }

  // ---- helpers -------------------------------------------------------------
  function resolveId(s) {
    var attr = s.getAttribute("data-id");
    if (attr) return attr.indexOf("den:") === 0 ? attr : "den:" + attr;
    try {
      var m = new URL(s.src).pathname.match(/\/w\/([a-z0-9]+)(?:\.js)?$/i);
      if (m) return "den:" + m[1];
    } catch (e) {}
    return null;
  }
  function enc(s) { return encodeURIComponent(s); }
  // Bearer token (works cross-site) + credentials (works first-party on den.com).
  function authHeaders(base) {
    var h = base || {};
    var t = getToken();
    if (t) h["authorization"] = "Bearer " + t;
    return h;
  }
  function post(bodyObj) {
    return { method: "POST", headers: authHeaders({ "content-type": "application/json" }),
      credentials: "include", body: JSON.stringify(bodyObj) };
  }
  async function getJSON(path) {
    var r = await fetch(cfg.api + path, { credentials: "include", headers: authHeaders() });
    if (!r.ok) throw Object.assign(new Error(r.status), { status: r.status });
    return r.json();
  }
  async function postJSON(path, bodyObj) {
    var r = await fetch(cfg.api + path, post(bodyObj));
    if (!r.ok) throw Object.assign(new Error(r.status), { status: r.status });
    return r.json();
  }
  function h(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function clear(p) { while (p.firstChild) p.removeChild(p.firstChild); }
  function setAvatar(node, m) {
    if (m && m.avatar) {
      node.style.backgroundImage = "url(" + JSON.stringify(String(m.avatar)) + ")";
      node.textContent = "";
    } else {
      node.style.backgroundImage = "";
      node.textContent = ((m && (m.name || m.handle)) || "?").trim().charAt(0).toUpperCase();
    }
  }
  function compact(n) {
    n = Number(n) || 0;
    if (n < 1000) return String(n);
    if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, "") + "K";
    return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  }
  function hostOf(u) { try { return new URL(u).host; } catch (e) { return String(u); } }
  function flash(node, msg) {
    var old = node.textContent; node.textContent = msg;
    setTimeout(function () { node.textContent = old; }, 1200);
  }

  function makeStyle() {
    var s = document.createElement("style");
    s.textContent = [
      ":host{all:initial}",
      ".den{position:fixed;z-index:2147483000;",
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;",
        "--bg:#fff;--fg:#0b0b0c;--muted:#8a9099;--line:#eceef0;--accent:#0b0b0c;--on-accent:#fff;--soft:#f3f4f6}",
      ".den-theme-dark{--bg:#161618;--fg:#f4f4f5;--muted:#9aa0a6;--line:#2a2a2e;--accent:#f4f4f5;--on-accent:#161618;--soft:#222226}",
      "@media (prefers-color-scheme:dark){.den-theme-auto{--bg:#161618;--fg:#f4f4f5;--muted:#9aa0a6;--line:#2a2a2e;--accent:#f4f4f5;--on-accent:#161618;--soft:#222226}}",
      ".den-bottom-right{right:18px;bottom:18px}.den-bottom-left{left:18px;bottom:18px}",
      ".den-top-right{right:18px;top:18px}.den-top-left{left:18px;top:18px}",
      // pill
      ".den-pill{display:flex;align-items:center;gap:8px;cursor:pointer;background:var(--bg);color:var(--fg);",
        "border:1px solid var(--line);border-radius:999px;padding:6px 14px 6px 6px;",
        "box-shadow:0 6px 24px rgba(0,0,0,.12);transition:transform .15s ease,opacity .15s}",
      ".den-pill:hover{transform:translateY(-1px)}",
      ".den-pill-avatar{width:26px;height:26px;border-radius:50%;background:#ddd center/cover no-repeat;",
        "display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;color:#777}",
      ".den-mark{font-weight:800;font-size:13px;letter-spacing:-.02em}",
      // card
      ".den-card{position:absolute;width:340px;max-width:86vw;max-height:80vh;display:flex;flex-direction:column;",
        "background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:22px;padding:20px;",
        "box-shadow:0 18px 60px rgba(0,0,0,.22);opacity:0;transform:translateY(10px) scale(.98);",
        "transform-origin:bottom right;pointer-events:none;transition:opacity .18s ease,transform .18s ease}",
      ".den-bottom-right .den-card,.den-bottom-left .den-card{bottom:0}",
      ".den-top-right .den-card,.den-top-left .den-card{top:0}",
      ".den-bottom-right .den-card,.den-top-right .den-card{right:0}",
      ".den-bottom-left .den-card,.den-top-left .den-card{left:0}",
      ".den-open .den-card{opacity:1;transform:translateY(0) scale(1);pointer-events:auto}",
      ".den-open .den-pill{opacity:0;pointer-events:none}",
      ".den-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding-right:26px}",
      ".den-avatar{width:64px;height:64px;border-radius:50%;background:#e7e7ea center/cover no-repeat;",
        "display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:600;color:#9aa0a6}",
      ".den-follow{cursor:pointer;border:0;background:var(--accent);color:var(--on-accent);font-weight:600;",
        "font-size:15px;padding:9px 22px;border-radius:999px;transition:transform .1s,opacity .12s}",
      ".den-follow:active{transform:scale(.97)}.den-follow.on{background:var(--soft);color:var(--fg)}",
      ".den-name{font-size:24px;font-weight:700;letter-spacing:-.01em;margin:14px 0 8px}",
      ".den-stats{display:flex;gap:22px;margin-bottom:6px}",
      ".den-stat b{font-size:16px;font-weight:700}.den-stat-l{color:var(--muted);font-weight:400}",
      ".den-ctitle{font-weight:700;font-size:16px;margin:18px 0 10px}",
      ".den-comments{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;min-height:40px}",
      ".den-comment{margin-bottom:14px}",
      ".den-chead{display:flex;align-items:center;gap:10px}",
      ".den-cavatar{width:34px;height:34px;border-radius:50%;background:#e7e7ea center/cover no-repeat;flex:0 0 auto;",
        "display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;color:#9aa0a6}",
      ".den-lock{background:var(--soft)}",
      ".den-cwho{font-size:14px;min-width:0}.den-cwho b{font-weight:700}",
      ".den-cblog{color:var(--muted);text-decoration:none}.den-cblog:hover{text-decoration:underline}",
      ".den-badge{margin-left:8px;font-size:11px;color:var(--muted);border:1px solid var(--line);border-radius:6px;padding:1px 6px}",
      ".den-cbody{margin:6px 0 0 44px;font-size:14px;line-height:1.45}",
      ".den-empty{color:var(--muted);font-size:14px;padding:4px 0 10px}",
      // composer
      ".den-composer{margin-top:10px;padding-top:14px;border-top:1px solid var(--line)}",
      // slide-out toggle: hidden until composing
      ".den-toggle-row{display:flex;align-items:center;gap:10px;max-height:0;opacity:0;overflow:hidden;",
        "transition:max-height .2s ease,opacity .2s ease,margin .2s ease}",
      ".den-compose .den-toggle-row{max-height:40px;opacity:1;margin-bottom:10px}",
      ".den-toggle{position:relative;width:42px;height:24px;border-radius:999px;border:0;cursor:pointer;",
        "background:var(--soft);flex:0 0 auto;transition:background .15s}",
      ".den-toggle.den-on{background:var(--accent)}",
      ".den-knob{position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;",
        "box-shadow:0 1px 3px rgba(0,0,0,.3);transition:transform .15s}",
      ".den-toggle.den-on .den-knob{transform:translateX(18px)}",
      ".den-toggle-label{font-size:13px;font-weight:600}",
      ".den-toggle-hint{font-size:11px;color:var(--muted);margin-left:auto}",
      ".den-input-row{display:flex;align-items:center;gap:8px}",
      ".den-input{flex:1;font:inherit;font-size:14px;padding:10px 14px;border:0;border-radius:999px;",
        "background:var(--soft);color:var(--fg);outline:none}",
      ".den-input::placeholder{color:var(--muted)}",
      ".den-send{cursor:pointer;border:0;width:38px;height:38px;border-radius:50%;flex:0 0 auto;",
        "background:var(--accent);color:var(--on-accent);font-size:17px;line-height:1;transition:transform .1s}",
      ".den-send:active{transform:scale(.94)}",
      ".den-close{position:absolute;top:14px;right:16px;display:none;cursor:pointer;border:0;background:transparent;",
        "color:var(--muted);font-size:22px;line-height:1;padding:4px}",
      ".den-open .den-close{display:block}",
      "@media (prefers-reduced-motion:reduce){.den-card,.den-pill,.den-follow,.den-send,.den-toggle-row,.den-knob,.den-toggle{transition:none}}",
    ].join("");
    return s;
  }
})();
