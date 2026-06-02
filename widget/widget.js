/*
 * Den widget — a floating profile + follow + notes badge for any personal site.
 *
 * Paste ONE line, anywhere (footer, header, HTML block). Works on Squarespace,
 * WordPress, Wix, Substack, Ghost, Jekyll, Lovable, Framer, hand-written HTML —
 * static or live — because a <script> tag is the only thing every platform
 * allows.
 *
 *   <script src="https://den.com/w/7f3a9c2e8b1d4f6a.js"></script>
 *
 * Everything it needs rides in on that one URL: the code, the API origin, and
 * whose badge this is (the id in the path). data-id="den:..." also works.
 *
 * Vanilla, zero dependencies, ~7KB gzipped. Mounts in a shadow DOM so it never
 * touches the host page's CSS. The whole card loads in ONE request (/card).
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

  var DRAFT_KEY = "den_draft_" + cfg.id;  // a note survives a full page navigation
  var TOKEN_KEY = "den_token";            // first-party session token (see authHeaders)
  var el, card = null;                    // card = latest {profile,stats,viewer,comments}
  var isPrivate = false, busy = false, viewed = false;

  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);

  function start() {
    var host = document.createElement("div");
    host.setAttribute("data-den-widget", "");
    var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
    document.body.appendChild(host);
    root.appendChild(style());
    el = render();
    root.appendChild(el.wrap);
    el.remove = function () { host.remove(); };

    // The sign-in popup messages us when done → store token, reload the card,
    // then auto-post the note the visitor was writing before we sent them off.
    window.addEventListener("message", function (e) {
      if (e && e.data && e.data.den === "signed-in") {
        setStore(TOKEN_KEY, e.data.token || "");
        load().then(postPendingDraft);
      }
    });
    restoreDraft();
    load();
  }

  // ---- data: one request loads everything ----------------------------------
  async function load() {
    var data;
    try {
      data = await getJSON("/api/profile/" + enc(cfg.id) + "/card");
    } catch (e) {
      if (e.status !== 404) { console.warn("[den] load failed", e); return el.remove(); }
      // Unknown id (a self-minted tag) → claim it, then retry once.
      try {
        await postJSON("/api/sites/claim", { id: cfg.id, url: location.origin, name: document.title || "" });
        data = await getJSON("/api/profile/" + enc(cfg.id) + "/card");
      } catch (e2) { console.warn("[den] claim failed", e2); return el.remove(); }
    }
    card = data;
    paint();
    countView();
  }

  async function countView() {
    if (viewed) return;
    viewed = true;
    try { await postJSON("/api/profile/" + enc(cfg.id) + "/view", {}); } catch (e) {}
  }

  // ---- actions -------------------------------------------------------------
  async function toggleFollow() {
    if (busy) return;
    busy = true;
    try {
      var s = await postJSON("/api/follow", { id: cfg.id });
      card.stats = s; paintStats();
    } catch (e) {
      if (e.status === 401) signIn(); else flash(el.follow, "try again");
    } finally { busy = false; }
  }

  // Send a note. If not signed in, the draft is saved first, then auth opens —
  // postPendingDraft() finishes the job when the popup reports back.
  async function submitNote() {
    var text = el.input.value.trim();
    if (!text || busy) return;
    saveDraft(text);
    if (!card || !card.viewer) return signIn();
    await postNote(text, isPrivate);
  }
  async function postNote(text, priv) {
    busy = true;
    try {
      card.comments = await postJSON("/api/profile/" + enc(cfg.id) + "/comments",
        { body: text, visibility: priv ? "private" : "public" });
      clearDraft(); el.input.value = ""; closeComposer(); paintComments();
    } catch (e) {
      if (e.status === 401) signIn(); else flash(el.send, "!");
    } finally { busy = false; }
  }
  async function postPendingDraft() {
    var d = readDraft();
    if (d && d.text && card && card.viewer) await postNote(d.text, d.priv);
  }

  function signIn() {
    window.open(cfg.api + "/auth?popup=1&return=" + encodeURIComponent(location.href),
      "den-auth", "width=420,height=560");
  }

  // ---- draft persistence ---------------------------------------------------
  function saveDraft(text) { setStore(DRAFT_KEY, JSON.stringify({ text: text, priv: isPrivate })); }
  function readDraft() { try { return JSON.parse(getStore(DRAFT_KEY) || "null"); } catch (e) { return null; } }
  function clearDraft() { setStore(DRAFT_KEY, ""); }
  function restoreDraft() {
    var d = readDraft();
    if (d && d.text) { el.input.value = d.text; isPrivate = !!d.priv; openComposer(); paintToggle(); }
  }

  // ---- paint ---------------------------------------------------------------
  function paint() {
    var p = (card && card.profile) || {};
    el.name.textContent = p.name || p.handle || "Someone";
    setAvatar(el.avatar, p);
    setAvatar(el.pillAvatar, p);
    var isOwner = !!(card && card.viewer && card.viewer.id === cfg.id);
    el.follow.style.display = isOwner ? "none" : "";
    paintStats();
    paintComments();
  }
  function paintStats() {
    var s = card && card.stats;
    el.views.textContent = s ? compact(s.views) : "–";
    el.followers.textContent = s ? compact(s.followers) : "–";
    var following = !!(s && s.viewerFollows);
    el.follow.textContent = following ? "Following" : "Follow";
    el.follow.classList.toggle("on", following);
  }
  function paintComments() {
    var list = el.comments;
    clear(list);
    var items = (card && card.comments) || [];
    if (!items.length) return list.append(h("div", "den-empty", "No notes yet — leave one."));
    items.forEach(function (c) { list.append(noteEl(c)); });
  }
  function noteEl(c) {
    var row = h("div", "den-note");
    var head = h("div", "den-nhead");
    var a = c.redacted ? null : (c.author || {});
    var av = h("span", "den-navatar" + (c.redacted ? " den-lock" : ""), c.redacted ? "✉" : null);
    if (!c.redacted) setAvatar(av, a);
    var who = h("span", "den-nwho");
    if (c.redacted) {
      who.append(h("b", "", "Someone"), document.createTextNode(" left a private note"));
    } else {
      who.append(h("b", "", a.name || "Someone"));
      if (a.url) who.append(" ", link("(" + hostOf(a.url) + ")", a.url));
      else if (a.handle) who.append(h("span", "den-nblog", " @" + a.handle));
      if (c.visibility === "private") who.append(h("span", "den-badge", "private"));
    }
    head.append(av, who);
    row.append(head);
    if (!c.redacted && c.body) row.append(h("div", "den-nbody", c.body));
    return row;
  }
  function paintToggle() {
    el.toggle.classList.toggle("on", isPrivate);
    el.toggleLabel.textContent = isPrivate ? "Private" : "Public";
    el.input.setAttribute("placeholder", isPrivate ? "Leave a private note…" : "Leave a note…");
  }

  function openComposer() { el.wrap.classList.add("den-compose"); }
  function closeComposer() { el.wrap.classList.remove("den-compose"); }
  function open(o) {
    el.wrap.classList.toggle("den-open", o);
    el.pill.setAttribute("aria-expanded", String(o));
    if (!o) closeComposer();
  }

  // ---- DOM -----------------------------------------------------------------
  function render() {
    var wrap = h("div", "den den-" + cfg.position + " den-" + cfg.theme);

    var pill = h("button", "den-pill");
    pill.setAttribute("aria-label", "Open Den profile");
    var pillAvatar = h("span", "den-pill-av");
    pill.append(pillAvatar, h("span", "den-mark", "den"));

    var card = h("div", "den-card");
    card.setAttribute("role", "dialog");

    var top = h("div", "den-top");
    var avatar = h("div", "den-av");
    var follow = h("button", "den-follow", "Follow");
    follow.onclick = toggleFollow;
    top.append(avatar, follow);

    var name = h("div", "den-name");
    var stats = h("div", "den-stats");
    var views = h("b"), followers = h("b");
    stats.append(stat(views, "Views"), stat(followers, "Followers"));

    var comments = h("div", "den-notes");

    var composer = h("div", "den-composer");
    var toggleRow = h("div", "den-trow");
    var toggle = h("button", "den-toggle"); toggle.type = "button"; toggle.setAttribute("role", "switch");
    toggle.append(h("span", "den-knob"));
    var toggleLabel = h("span", "den-tlabel", "Public");
    toggle.onclick = function () { isPrivate = !isPrivate; paintToggle(); el.input.focus(); };
    toggleRow.append(toggle, toggleLabel, h("span", "den-thint", "Only the owner sees private notes"));

    var inputRow = h("div", "den-irow");
    var input = h("input", "den-input");
    input.setAttribute("placeholder", "Leave a note…");
    input.setAttribute("aria-label", "Leave a note");
    input.addEventListener("focus", openComposer);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") submitNote(); });
    var send = h("button", "den-send", "→"); send.setAttribute("aria-label", "Send note");
    send.onclick = submitNote;
    inputRow.append(input, send);
    composer.append(toggleRow, inputRow);

    var close = h("button", "den-x", "×"); close.setAttribute("aria-label", "Close");
    close.onclick = function () { open(false); };

    card.append(close, top, name, stats, h("div", "den-ntitle", "Notes"), comments, composer);
    wrap.append(card, pill);

    pill.addEventListener("click", function () { open(true); });
    wrap.addEventListener("mouseleave", function () { if (!input.value) open(false); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") open(false); });

    return { wrap: wrap, pill: pill, pillAvatar: pillAvatar, avatar: avatar, follow: follow,
      name: name, views: views, followers: followers, comments: comments,
      input: input, send: send, toggle: toggle, toggleLabel: toggleLabel };

    function stat(v, label) { return h("span", "den-stat", null, [v, " ", h("span", "den-stat-l", label)]); }
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
  function getStore(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function setStore(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) {} }
  // Bearer token works cross-site (3rd-party cookies are blocked); credentials
  // cover first-party use on den.com itself.
  function opts(method, bodyObj) {
    var headers = {};
    var t = getStore(TOKEN_KEY);
    if (t) headers["authorization"] = "Bearer " + t;
    if (bodyObj !== undefined) headers["content-type"] = "application/json";
    return { method: method, headers: headers, credentials: "include",
      body: bodyObj !== undefined ? JSON.stringify(bodyObj) : undefined };
  }
  async function getJSON(path) {
    var r = await fetch(cfg.api + path, opts("GET"));
    if (!r.ok) throw Object.assign(new Error(r.status), { status: r.status });
    return r.json();
  }
  async function postJSON(path, bodyObj) {
    var r = await fetch(cfg.api + path, opts("POST", bodyObj || {}));
    if (!r.ok) throw Object.assign(new Error(r.status), { status: r.status });
    return r.json();
  }
  function h(tag, cls, text, kids) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    (kids || []).forEach(function (k) { n.append(k.nodeType ? k : String(k)); });
    return n;
  }
  function link(text, href) {
    var a = h("a", "den-nblog", text); a.href = href; a.target = "_blank"; a.rel = "noopener"; return a;
  }
  function clear(p) { while (p.firstChild) p.removeChild(p.firstChild); }
  function setAvatar(node, m) {
    if (m && m.avatar) { node.style.backgroundImage = "url(" + JSON.stringify(String(m.avatar)) + ")"; node.textContent = ""; }
    else { node.style.backgroundImage = ""; node.textContent = ((m && (m.name || m.handle)) || "?").trim().charAt(0).toUpperCase(); }
  }
  function compact(n) {
    n = Number(n) || 0;
    if (n < 1000) return String(n);
    if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, "") + "K";
    return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  }
  function hostOf(u) { try { return new URL(u).host.replace(/^www\./, ""); } catch (e) { return String(u); } }
  function flash(node, msg) { var old = node.textContent; node.textContent = msg; setTimeout(function () { node.textContent = old; }, 1200); }

  // ---- styles (Den design system, scoped to the shadow root) ---------------
  function style() {
    var s = document.createElement("style");
    s.textContent = [
      ":host{all:initial}",
      ".den{position:fixed;z-index:2147483000;",
        "font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;",
        "--bg:#fff;--title:#282a30;--base:#3c4149;--muted:#6c6a63;--faint:#918e87;",
        "--line:#e0e1e5;--sub:#f2f0ed;--accent:#6f79d9;--accent-h:#5c68c9;--on-accent:#fff;",
        "--shadow:0 12px 40px rgba(0,0,0,.16),0 1px 2px rgba(0,0,0,.06)}",
      ".den-dark{--bg:#1c1c1f;--title:#e6e7eb;--base:#c8c9cf;--muted:#9a9ba3;--faint:#7c7d85;",
        "--line:#3f3f45;--sub:#2a2a2d;--accent:#6f79d9;--accent-h:#8892e2;--on-accent:#fff;",
        "--shadow:0 12px 40px rgba(0,0,0,.5),0 1px 2px rgba(0,0,0,.4)}",
      "@media (prefers-color-scheme:dark){.den-auto{--bg:#1c1c1f;--title:#e6e7eb;--base:#c8c9cf;--muted:#9a9ba3;--faint:#7c7d85;",
        "--line:#3f3f45;--sub:#2a2a2d;--accent:#6f79d9;--accent-h:#8892e2;--on-accent:#fff;",
        "--shadow:0 12px 40px rgba(0,0,0,.5),0 1px 2px rgba(0,0,0,.4)}}",
      ".den-bottom-right{right:20px;bottom:20px}.den-bottom-left{left:20px;bottom:20px}",
      ".den-top-right{right:20px;top:20px}.den-top-left{left:20px;top:20px}",
      // pill
      ".den-pill{display:flex;align-items:center;gap:8px;cursor:pointer;background:var(--bg);color:var(--title);",
        "border:.5px solid var(--line);border-radius:999px;padding:5px 14px 5px 5px;",
        "box-shadow:var(--shadow);transition:transform .12s ease,opacity .12s}",
      ".den-pill:hover{transform:translateY(-1px)}",
      ".den-pill-av{width:26px;height:26px;border-radius:50%;background:#e8e6fb center/cover no-repeat;",
        "display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;color:var(--accent)}",
      ".den-mark{font-weight:700;font-size:13px;letter-spacing:-.02em}",
      // card
      ".den-card{position:absolute;width:340px;max-width:88vw;max-height:78vh;display:flex;flex-direction:column;",
        "background:var(--bg);color:var(--base);border:.5px solid var(--line);border-radius:18px;padding:20px;",
        "box-shadow:var(--shadow);opacity:0;transform:translateY(8px) scale(.98);transform-origin:bottom right;",
        "pointer-events:none;transition:opacity .16s ease,transform .16s ease}",
      ".den-bottom-right .den-card,.den-bottom-left .den-card{bottom:0}",
      ".den-top-right .den-card,.den-top-left .den-card{top:0}",
      ".den-bottom-right .den-card,.den-top-right .den-card{right:0}",
      ".den-bottom-left .den-card,.den-top-left .den-card{left:0}",
      ".den-open .den-card{opacity:1;transform:translateY(0) scale(1);pointer-events:auto}",
      ".den-open .den-pill{opacity:0;pointer-events:none}",
      // top
      ".den-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}",
      ".den-av{width:60px;height:60px;border-radius:50%;background:#e8e6fb center/cover no-repeat;",
        "display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:600;color:var(--accent)}",
      ".den-follow{cursor:pointer;border:.5px solid var(--accent);background:var(--accent);color:var(--on-accent);",
        "font-weight:500;font-size:14px;padding:8px 18px;border-radius:999px;transition:background .12s,transform .1s}",
      ".den-follow:hover{background:var(--accent-h)}.den-follow:active{transform:scale(.97)}",
      ".den-follow.on{background:var(--sub);color:var(--base);border-color:var(--line)}",
      ".den-name{font-size:21px;font-weight:600;letter-spacing:-.01em;color:var(--title);margin:14px 0 8px}",
      // stats
      ".den-stats{display:flex;gap:20px}",
      ".den-stat{font-size:14px;color:var(--muted)}.den-stat b{font-size:15px;font-weight:600;color:var(--title)}",
      // notes
      ".den-ntitle{font-weight:600;font-size:13px;color:var(--faint);text-transform:uppercase;letter-spacing:.05em;margin:20px 0 12px}",
      ".den-notes{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;min-height:36px;",
        "scrollbar-width:thin;scrollbar-color:var(--line) transparent}",
      ".den-note{margin-bottom:14px}",
      ".den-nhead{display:flex;align-items:center;gap:10px}",
      ".den-navatar{width:32px;height:32px;border-radius:50%;background:#e8e6fb center/cover no-repeat;flex:0 0 auto;",
        "display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;color:var(--accent)}",
      ".den-lock{background:var(--sub);color:var(--faint)}",
      ".den-nwho{font-size:14px;color:var(--title);min-width:0}.den-nwho b{font-weight:600}",
      ".den-nblog{color:var(--muted);text-decoration:none}.den-nblog:hover{text-decoration:underline}",
      ".den-badge{margin-left:7px;font-size:11px;color:var(--muted);border:.5px solid var(--line);border-radius:4px;padding:0 6px}",
      ".den-nbody{margin:5px 0 0 42px;font-size:14px;line-height:1.45;color:var(--base)}",
      ".den-empty{color:var(--faint);font-size:14px;padding:2px 0 8px}",
      // composer
      ".den-composer{margin-top:8px;padding-top:14px;border-top:.5px solid var(--line)}",
      ".den-trow{display:flex;align-items:center;gap:10px;max-height:0;opacity:0;overflow:hidden;transition:max-height .2s ease,opacity .2s ease,margin .2s ease}",
      ".den-compose .den-trow{max-height:40px;opacity:1;margin-bottom:10px}",
      ".den-toggle{position:relative;width:40px;height:23px;border-radius:999px;border:0;cursor:pointer;background:var(--sub);flex:0 0 auto;transition:background .15s}",
      ".den-toggle.on{background:var(--accent)}",
      ".den-knob{position:absolute;top:3px;left:3px;width:17px;height:17px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:transform .15s}",
      ".den-toggle.on .den-knob{transform:translateX(17px)}",
      ".den-tlabel{font-size:13px;font-weight:600;color:var(--title)}",
      ".den-thint{font-size:11px;color:var(--faint);margin-left:auto}",
      ".den-irow{display:flex;align-items:center;gap:8px}",
      ".den-input{flex:1;font:inherit;font-size:14px;padding:10px 14px;border:.5px solid var(--line);border-radius:999px;background:var(--bg);color:var(--title);outline:none;transition:border-color .12s,box-shadow .12s}",
      ".den-input:focus{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent)}",
      ".den-input::placeholder{color:var(--faint)}",
      ".den-send{cursor:pointer;border:0;width:38px;height:38px;border-radius:50%;flex:0 0 auto;background:var(--accent);color:var(--on-accent);font-size:17px;line-height:1;transition:background .12s,transform .1s}",
      ".den-send:hover{background:var(--accent-h)}.den-send:active{transform:scale(.94)}",
      ".den-x{position:absolute;top:14px;right:16px;cursor:pointer;border:0;background:transparent;color:var(--faint);font-size:20px;line-height:1;padding:4px}",
      ".den-x:hover{color:var(--base)}",
      "@media (prefers-reduced-motion:reduce){.den-card,.den-pill,.den-follow,.den-send,.den-trow,.den-knob,.den-toggle{transition:none}}",
    ].join("");
    return s;
  }
})();
