/*
 * Den widget — a floating profile + follow + comments badge for any personal site.
 *
 * Paste ONE line, anywhere (footer, header, HTML block). Works on Squarespace,
 * WordPress, Wix, Jekyll/Hexo, Lovable, hand-written HTML — static or live —
 * because a <script> tag is the only thing every platform allows.
 *
 *   <script src="https://den.com/w/7f3a9c2e8b1d4f6a.js"></script>
 *
 * Everything it needs rides in on that one URL: the code (the file), the API
 * origin (where it was served from), and whose badge this is (the id in the
 * path). data-id="den:..." also works if you can't control the path.
 *
 * Collapsed: a small pill. Expanded: avatar, name, Views + Followers, a Follow
 * button, and a comments feed where every commenter links back to their own
 * blog — the traversal hook. Mounts in a shadow DOM (no CSS clash). Zero deps.
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

  var el, state = { me: null, stats: null, comments: null, expanded: false, busy: false, viewed: false };

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

    window.addEventListener("message", function (e) {
      if (e && e.data && e.data.den === "signed-in") { refreshStats(); loadComments(); }
    });
    load();
  }

  // ---- data ----------------------------------------------------------------
  async function load() {
    try {
      state.me = await getJSON("/api/profile/" + enc(cfg.id));
    } catch (e) {
      if (e.status === 404) {
        // Self-minted id not yet known to Den → claim it (zero-fetch onboarding),
        // then continue. Idempotent server-side.
        try {
          await postJSON("/api/sites/claim", { id: cfg.id, url: location.origin, name: document.title || "" });
          state.me = await getJSON("/api/profile/" + enc(cfg.id));
        } catch (e2) { return fail(e2); }
      } else { return fail(e); }
    }
    paintIdentity();
    countView();
    refreshStats();
    loadComments();
  }
  function fail(e) { console.warn("[den] could not load profile " + cfg.id, e); el.removeHost(); }

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
      if (res.status === 401) return signIn();
      if (!res.ok) throw new Error(res.status);
      state.stats = await res.json();
      paintStats();
    } catch (e) { flash(el.follow, "try again"); }
    finally { state.busy = false; }
  }

  async function submitComment() {
    var text = el.input.value.trim();
    if (!text || state.busy) return;
    state.busy = true;
    try {
      var res = await fetch(cfg.api + "/api/profile/" + enc(cfg.id) + "/comments", post({ body: text }));
      if (res.status === 401) { state.busy = false; return signIn(); }
      if (!res.ok) throw new Error(res.status);
      state.comments = await res.json();
      el.input.value = "";
      paintComments();
    } catch (e) { flash(el.send, "!"); }
    finally { state.busy = false; }
  }

  function signIn() {
    var ret = encodeURIComponent(location.href);
    window.open(cfg.api + "/auth?return=" + ret, "den-auth", "width=420,height=560");
  }

  // ---- painting ------------------------------------------------------------
  function paintIdentity() {
    var m = state.me || {};
    el.name.textContent = m.name || m.handle || "Someone";
    setAvatar(el.avatar, m);
    setAvatar(el.pillAvatar, m);
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
    if (!items.length) {
      list.append(h("div", "den-empty", "Be the first to comment."));
    } else {
      items.forEach(function (c) {
        var a = c.author || {};
        var av = h("span", "den-cavatar");
        setAvatar(av, a);
        var who = h("span", "den-cwho");
        who.append(h("b", "", a.name || "Someone"));
        if (a.url) {
          var link = h("a", "den-cblog", "(" + hostOf(a.url) + ")");
          link.href = a.url; link.target = "_blank"; link.rel = "noopener";
          who.append(" ", link);
        } else if (a.handle) {
          who.append(h("span", "den-cblog", " @" + a.handle));
        }
        var row = h("div", "den-comment");
        var head = h("div", "den-chead"); head.append(av, who);
        row.append(head);
        if (c.body) row.append(h("div", "den-cbody", c.body));
        list.append(row);
      });
    }
  }

  // ---- DOM -----------------------------------------------------------------
  function render() {
    var wrap = h("div", "den den-" + cfg.position + " den-theme-" + cfg.theme);

    // collapsed pill
    var pill = h("button", "den-pill");
    pill.setAttribute("aria-label", "Open Den profile");
    var pillAvatar = h("span", "den-pill-avatar");
    pill.append(pillAvatar, h("span", "den-mark", "den"));

    // expanded card
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
    statsRow.append(
      stat(views, "Views"),
      stat(followers, "Followers")
    );

    var cTitle = h("div", "den-ctitle", "Comments");
    var comments = h("div", "den-comments");

    var composer = h("div", "den-composer");
    var input = h("input", "den-input");
    input.setAttribute("placeholder", "Leave a comment…");
    input.setAttribute("aria-label", "Leave a comment");
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") submitComment(); });
    var send = h("button", "den-send", "→");
    send.setAttribute("aria-label", "Send comment");
    send.onclick = submitComment;
    composer.append(input, send);

    card.append(top, name, statsRow, cTitle, comments, composer);
    wrap.append(card, pill);

    pill.addEventListener("click", function () { toggle(true); });
    wrap.addEventListener("mouseleave", function () { toggle(false); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") toggle(false); });
    // brand mark also closes when expanded
    var close = h("button", "den-close", "×");
    close.setAttribute("aria-label", "Close");
    close.onclick = function () { toggle(false); };
    card.append(close);

    return { wrap: wrap, pill: pill, pillAvatar: pillAvatar, avatar: avatar, follow: follow,
      name: name, views: views, followers: followers, comments: comments, input: input, send: send };

    function stat(valueEl, label) {
      var box = h("span", "den-stat");
      box.append(valueEl, " ", h("span", "den-stat-l", label));
      return box;
    }
  }

  function toggle(open) {
    state.expanded = open;
    el.wrap.classList.toggle("den-open", open);
    el.pill.setAttribute("aria-expanded", String(open));
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
  function post(bodyObj) {
    return { method: "POST", headers: { "content-type": "application/json" },
      credentials: "include", body: JSON.stringify(bodyObj) };
  }
  async function getJSON(path) {
    var r = await fetch(cfg.api + path, { credentials: "include" });
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
      ".den-card{position:absolute;width:340px;max-width:86vw;max-height:78vh;display:flex;flex-direction:column;",
        "background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:22px;padding:20px;",
        "box-shadow:0 18px 60px rgba(0,0,0,.22);opacity:0;transform:translateY(10px) scale(.98);",
        "transform-origin:bottom right;pointer-events:none;transition:opacity .18s ease,transform .18s ease}",
      ".den-bottom-right .den-card,.den-bottom-left .den-card{bottom:0}",
      ".den-top-right .den-card,.den-top-left .den-card{top:0}",
      ".den-bottom-right .den-card,.den-top-right .den-card{right:0}",
      ".den-bottom-left .den-card,.den-top-left .den-card{left:0}",
      ".den-open .den-card{opacity:1;transform:translateY(0) scale(1);pointer-events:auto}",
      ".den-open .den-pill{opacity:0;pointer-events:none}",
      // top row
      ".den-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}",
      ".den-avatar{width:64px;height:64px;border-radius:50%;background:#e7e7ea center/cover no-repeat;",
        "display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:600;color:#9aa0a6}",
      ".den-follow{cursor:pointer;border:0;background:var(--accent);color:var(--on-accent);font-weight:600;",
        "font-size:15px;padding:9px 22px;border-radius:999px;transition:transform .1s,opacity .12s}",
      ".den-follow:active{transform:scale(.97)}",
      ".den-follow.on{background:var(--soft);color:var(--fg)}",
      ".den-name{font-size:24px;font-weight:700;letter-spacing:-.01em;margin:14px 0 8px}",
      // stats
      ".den-stats{display:flex;gap:22px;margin-bottom:6px}",
      ".den-stat b{font-size:16px;font-weight:700}",
      ".den-stat-l{color:var(--muted);font-weight:400}",
      // comments
      ".den-ctitle{font-weight:700;font-size:16px;margin:18px 0 10px}",
      ".den-comments{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;min-height:40px}",
      ".den-comment{margin-bottom:14px}",
      ".den-chead{display:flex;align-items:center;gap:10px}",
      ".den-cavatar{width:34px;height:34px;border-radius:50%;background:#e7e7ea center/cover no-repeat;flex:0 0 auto;",
        "display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;color:#9aa0a6}",
      ".den-cwho{font-size:14px;min-width:0}",
      ".den-cwho b{font-weight:700}",
      ".den-cblog{color:var(--muted);text-decoration:none}",
      ".den-cblog:hover{text-decoration:underline}",
      ".den-cbody{margin:6px 0 0 44px;font-size:14px;line-height:1.45}",
      ".den-empty{color:var(--muted);font-size:14px;padding:4px 0 10px}",
      // composer
      ".den-composer{display:flex;align-items:center;gap:8px;margin-top:10px;padding-top:14px;border-top:1px solid var(--line)}",
      ".den-input{flex:1;font:inherit;font-size:14px;padding:10px 14px;border:0;border-radius:999px;",
        "background:var(--soft);color:var(--fg);outline:none}",
      ".den-input::placeholder{color:var(--muted)}",
      ".den-send{cursor:pointer;border:0;width:38px;height:38px;border-radius:50%;flex:0 0 auto;",
        "background:var(--accent);color:var(--on-accent);font-size:17px;line-height:1;transition:transform .1s}",
      ".den-send:active{transform:scale(.94)}",
      // close
      ".den-close{position:absolute;top:14px;right:16px;display:none;cursor:pointer;border:0;background:transparent;",
        "color:var(--muted);font-size:22px;line-height:1;padding:4px}",
      ".den-open .den-close{display:block}",
      ".den-top{padding-right:26px}",
      "@media (prefers-reduced-motion:reduce){.den-card,.den-pill,.den-follow,.den-send{transition:none}}",
    ].join("");
    return s;
  }
})();
