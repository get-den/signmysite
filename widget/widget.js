/*
 * Den widget — a floating "follow this person" badge for any personal site.
 *
 * Usage (one line, works in any framework):
 *   <script src="https://den.com/widget.js" data-site="/me.json"></script>
 *
 * It mounts itself in a shadow DOM so it cannot clash with the host site's CSS.
 * Identity (name/avatar/handle) comes from the static me.json.
 * Live state (follower counts, whether you follow) comes from the Den API.
 * Zero dependencies.
 */
(function () {
  "use strict";

  var script = document.currentScript;
  if (!script) return;

  var cfg = {
    site: script.getAttribute("data-site") || "/me.json",
    id: script.getAttribute("data-id") || null,
    api: (script.getAttribute("data-api") || "https://den.com").replace(/\/$/, ""),
    theme: script.getAttribute("data-theme") || "auto", // auto | light | dark
    position: script.getAttribute("data-position") || "bottom-right",
  };

  // ---- mount ---------------------------------------------------------------
  var host = document.createElement("div");
  host.setAttribute("data-den-widget", "");
  var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
  document.body.appendChild(host);

  root.appendChild(makeStyle());
  var el = render();
  root.appendChild(el.wrap);

  // ---- state ---------------------------------------------------------------
  var state = { me: null, stats: null, expanded: false, busy: false };

  load();

  async function load() {
    try {
      state.me = cfg.id ? { id: cfg.id } : await fetchJSON(cfg.site);
      paintIdentity();
    } catch (e) {
      // No me.json reachable — hide quietly rather than break the page.
      host.remove();
      return;
    }
    refreshStats();
  }

  async function refreshStats() {
    if (!state.me || !state.me.id) return;
    try {
      state.stats = await fetchJSON(
        cfg.api + "/api/profile/" + encodeURIComponent(state.me.id) + "/stats",
        { credentials: "include" }
      );
    } catch (e) {
      state.stats = null; // offline / no backend yet — show dashes.
    }
    paintStats();
  }

  // ---- actions -------------------------------------------------------------
  async function act(kind) {
    if (state.busy || !state.me) return;
    state.busy = true;
    try {
      var res = await fetch(cfg.api + "/api/" + kind, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id: state.me.id }),
      });
      if (res.status === 401) return signIn(); // not a member yet
      if (!res.ok) throw new Error(String(res.status));
      state.stats = await res.json();
      paintStats();
    } catch (e) {
      flash(kind === "follow" ? el.follow : el.save, "try again");
    } finally {
      state.busy = false;
    }
  }

  function signIn() {
    var ret = encodeURIComponent(location.href);
    window.open(
      cfg.api + "/auth?return=" + ret,
      "den-auth",
      "width=420,height=560"
    );
  }

  // ---- painting ------------------------------------------------------------
  function paintIdentity() {
    var m = state.me || {};
    el.name.textContent = m.name || m.handle || "Someone";
    el.handle.textContent = m.handle ? "@" + m.handle : "";
    if (m.avatar) {
      el.avatar.style.backgroundImage = "url(" + cssURL(m.avatar) + ")";
      el.pillAvatar.style.backgroundImage = "url(" + cssURL(m.avatar) + ")";
      el.avatar.textContent = "";
      el.pillAvatar.textContent = "";
    } else {
      var initial = (m.name || m.handle || "?").trim().charAt(0).toUpperCase();
      el.avatar.textContent = initial;
      el.pillAvatar.textContent = initial;
    }
  }

  function paintStats() {
    var s = state.stats;
    el.followers.textContent = s ? compact(s.followers) : "–";
    el.following.textContent = s ? compact(s.following) : "–";
    var following = !!(s && s.viewerFollows);
    el.follow.textContent = following ? "Following" : "Follow";
    el.follow.classList.toggle("on", following);
    var saved = !!(s && s.viewerSaved);
    el.save.textContent = saved ? "Saved" : "Save";
    el.save.classList.toggle("on", saved);
  }

  // ---- DOM -----------------------------------------------------------------
  function render() {
    var wrap = h("div", "den den-" + cfg.position + " den-theme-" + cfg.theme);

    // collapsed pill
    var pill = h("button", "den-pill");
    pill.setAttribute("aria-label", "Open Den profile");
    var pillAvatar = h("span", "den-pill-avatar");
    var pillMark = h("span", "den-mark", denMark());
    pill.append(pillAvatar, pillMark);

    // expanded card
    var card = h("div", "den-card");
    card.setAttribute("role", "dialog");

    var head = h("div", "den-head");
    var avatar = h("div", "den-avatar");
    var who = h("div", "den-who");
    var name = h("div", "den-name");
    var handle = h("div", "den-handle");
    who.append(name, handle);
    var brand = h("span", "den-brand", denMark());
    head.append(avatar, who, brand);

    var stats = h("div", "den-stats");
    var followers = h("strong", "", "–");
    var following = h("strong", "", "–");
    stats.append(stat(followers, "followers"), stat(following, "following"));

    var actions = h("div", "den-actions");
    var follow = h("button", "den-btn den-primary", "Follow");
    var save = h("button", "den-btn", "Save");
    follow.onclick = function () { act("follow"); };
    save.onclick = function () { act("save"); };
    actions.append(follow, save);

    card.append(head, stats, actions);
    wrap.append(card, pill);

    // open/close: hover on desktop, click everywhere
    var open = function () { toggle(true); };
    var close = function () { toggle(false); };
    pill.addEventListener("click", function () { toggle(); });
    wrap.addEventListener("mouseenter", open);
    wrap.addEventListener("mouseleave", close);
    wrap.addEventListener("focusin", open);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") close();
    });

    return { wrap: wrap, pill: pill, pillAvatar: pillAvatar, card: card,
      avatar: avatar, name: name, handle: handle,
      followers: followers, following: following, follow: follow, save: save };

    function stat(valueEl, label) {
      var box = h("div", "den-stat");
      box.append(valueEl, h("span", "den-stat-label", label));
      return box;
    }
  }

  function toggle(force) {
    state.expanded = force === undefined ? !state.expanded : force;
    el.wrap.classList.toggle("den-open", state.expanded);
    el.pill.setAttribute("aria-expanded", String(state.expanded));
  }

  // ---- helpers -------------------------------------------------------------
  function h(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  async function fetchJSON(url, opts) {
    var r = await fetch(url, opts || {});
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  }
  function compact(n) {
    n = Number(n) || 0;
    if (n < 1000) return String(n);
    if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, "") + "k";
    return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "m";
  }
  function cssURL(u) { return JSON.stringify(String(u)); }
  function flash(btn, msg) {
    var old = btn.textContent;
    btn.textContent = msg;
    setTimeout(function () { btn.textContent = old; }, 1400);
  }
  function denMark() {
    // tiny inline "den" wordmark
    return "den";
  }

  function makeStyle() {
    var s = document.createElement("style");
    s.textContent = [
      ":host{all:initial}",
      ".den{position:fixed;z-index:2147483000;",
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;",
        "--bg:#fff;--fg:#0b0b0c;--muted:#6b7280;--line:#ececef;--accent:#0b0b0c;--on-accent:#fff}",
      ".den-theme-dark{--bg:#161618;--fg:#f4f4f5;--muted:#a1a1aa;--line:#2a2a2e;--accent:#f4f4f5;--on-accent:#161618}",
      "@media (prefers-color-scheme:dark){.den-theme-auto{--bg:#161618;--fg:#f4f4f5;--muted:#a1a1aa;--line:#2a2a2e;--accent:#f4f4f5;--on-accent:#161618}}",
      ".den-bottom-right{right:18px;bottom:18px}",
      ".den-bottom-left{left:18px;bottom:18px}",
      ".den-top-right{right:18px;top:18px}",
      ".den-top-left{left:18px;top:18px}",
      // pill
      ".den-pill{display:flex;align-items:center;gap:8px;cursor:pointer;",
        "background:var(--bg);color:var(--fg);border:1px solid var(--line);",
        "border-radius:999px;padding:6px 12px 6px 6px;",
        "box-shadow:0 6px 24px rgba(0,0,0,.12);transition:transform .15s ease,opacity .15s}",
      ".den-pill:hover{transform:translateY(-1px)}",
      ".den-pill-avatar{width:26px;height:26px;border-radius:50%;background:#ddd center/cover no-repeat;",
        "display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;color:#555}",
      ".den-mark{font-weight:700;font-size:13px;letter-spacing:-.02em}",
      // card
      ".den-card{position:absolute;width:248px;background:var(--bg);color:var(--fg);",
        "border:1px solid var(--line);border-radius:16px;padding:16px;",
        "box-shadow:0 12px 40px rgba(0,0,0,.18);opacity:0;transform:translateY(8px) scale(.98);",
        "transform-origin:bottom right;pointer-events:none;transition:opacity .16s ease,transform .16s ease}",
      ".den-bottom-right .den-card,.den-bottom-left .den-card{bottom:0}",
      ".den-top-right .den-card,.den-top-left .den-card{top:0}",
      ".den-bottom-right .den-card,.den-top-right .den-card{right:0}",
      ".den-bottom-left .den-card,.den-top-left .den-card{left:0}",
      ".den-open .den-card{opacity:1;transform:translateY(0) scale(1);pointer-events:auto}",
      ".den-open .den-pill{opacity:0;pointer-events:none}",
      ".den-head{display:flex;align-items:center;gap:10px}",
      ".den-avatar{width:40px;height:40px;border-radius:50%;background:#ddd center/cover no-repeat;",
        "flex:0 0 auto;display:flex;align-items:center;justify-content:center;font-weight:600;color:#555}",
      ".den-who{flex:1;min-width:0}",
      ".den-name{font-weight:650;font-size:15px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".den-handle{color:var(--muted);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".den-brand{color:var(--muted);font-weight:700;font-size:12px}",
      ".den-stats{display:flex;gap:18px;margin:14px 0}",
      ".den-stat{display:flex;flex-direction:column;line-height:1.1}",
      ".den-stat strong{font-size:16px}",
      ".den-stat-label{color:var(--muted);font-size:12px;margin-top:2px}",
      ".den-actions{display:flex;gap:8px}",
      ".den-btn{flex:1;cursor:pointer;border:1px solid var(--line);background:var(--bg);color:var(--fg);",
        "border-radius:10px;padding:8px 10px;font-size:13px;font-weight:600;transition:background .12s,transform .12s}",
      ".den-btn:active{transform:scale(.97)}",
      ".den-primary{background:var(--accent);color:var(--on-accent);border-color:var(--accent)}",
      ".den-btn.on{background:var(--bg);color:var(--fg);border-color:var(--line)}",
      "@media (prefers-reduced-motion:reduce){.den-card,.den-pill,.den-btn{transition:none}}",
    ].join("");
    return s;
  }
})();
