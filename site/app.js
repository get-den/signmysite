/*
 * den.com — the main site. Vanilla JS, no framework, no build.
 * Hash routes: #/ (home/profile), #/edit, #/embed.
 * Talks to the same-origin API with cookies.
 */
(function () {
  "use strict";

  var API = ""; // same origin
  var app = document.getElementById("app");
  var nav = document.getElementById("nav");
  var me = null; // the signed-in member, or null

  // ---- tiny helpers --------------------------------------------------------
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === "class") n.className = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c != null) n.append(c.nodeType ? c : String(c)); });
    return n;
  }
  function clear(p) { while (p.firstChild) p.removeChild(p.firstChild); }
  async function api(path, opts) {
    var r = await fetch(API + path, Object.assign({ credentials: "include" }, opts));
    if (!r.ok) throw Object.assign(new Error(r.status), { status: r.status });
    return r.status === 204 ? null : r.json();
  }
  function compact(n) {
    n = Number(n) || 0;
    if (n < 1000) return String(n);
    if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, "") + "K";
    return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  }
  function initials(s) { return (s || "?").trim().charAt(0).toUpperCase(); }
  function avatar(m, cls) {
    var a = el("div", { class: "avatar " + (cls || "") });
    if (m && m.avatar) a.style.backgroundImage = "url(" + JSON.stringify(m.avatar) + ")";
    else a.textContent = initials(m && (m.name || m.handle));
    return a;
  }
  function host(url) { try { return new URL(url).host; } catch (e) { return url; } }
  function toast(msg) {
    var t = el("div", { class: "toast" }, [msg]);
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add("show"); });
    setTimeout(function () { t.classList.remove("show"); setTimeout(function () { t.remove(); }, 250); }, 1600);
  }

  // ---- chrome --------------------------------------------------------------
  function renderNav() {
    clear(nav);
    if (me) {
      nav.append(
        el("a", { class: "who", href: "#/" }, ["@" + (me.handle || "you")]),
        el("a", { class: "btn sm", href: "#/embed" }, ["Get widget"]),
        el("button", { class: "btn sm", onclick: logout }, ["Sign out"])
      );
    } else {
      nav.append(el("a", { class: "btn sm primary", href: signinUrl() }, ["Sign in"]));
    }
  }
  function signinUrl() { return "/api/auth/google?return=" + encodeURIComponent(location.href); }
  async function logout() { await api("/api/logout", { method: "POST" }); me = null; renderNav(); go("#/"); }

  // ---- views ---------------------------------------------------------------
  async function viewHome() {
    if (!me) return viewLanding();
    var stats = await api("/api/profile/" + encodeURIComponent(me.id) + "/stats").catch(function () { return {}; });
    var following = await api("/api/following").catch(function () { return []; });

    var head = el("div", { class: "phead" }, [
      avatar(me),
      el("div", {}, [
        el("div", { class: "pname" }, [me.name || "You"]),
        el("div", { class: "phandle" }, ["@" + (me.handle || "")]),
        me.url ? el("div", { class: "purl" }, [el("a", { href: me.url, target: "_blank", rel: "noopener" }, [host(me.url)])]) : null,
      ]),
    ]);
    var bio = me.bio ? el("p", { class: "pbio" }, [me.bio]) : null;
    var statRow = el("div", { class: "pstats" }, [
      stat(stats.views, "Views"), stat(stats.followers, "Followers"), stat(stats.following, "Following"),
    ]);
    var actions = el("div", { class: "row" }, [
      el("a", { class: "btn", href: "#/edit" }, ["Edit profile"]),
      el("a", { class: "btn", href: "#/embed" }, ["Get your widget"]),
    ]);

    var follows = el("div", { class: "section" }, [
      el("h2", {}, ["Blogs you follow"]),
      following.length
        ? el("div", {}, following.map(blogRow))
        : el("div", { class: "empty" }, ["You don't follow anyone yet. Visit a Den site and tap Follow."]),
    ]);

    render([head, bio, statRow, actions, follows]);

    function stat(n, label) {
      return el("div", {}, [el("span", { class: "n" }, [compact(n)]), " ", el("span", { class: "l" }, [label])]);
    }
  }

  function blogRow(b) {
    return el("a", { class: "blog", href: b.url || "#", target: b.url ? "_blank" : null, rel: "noopener" }, [
      avatar(b),
      el("div", { class: "meta" }, [
        el("div", { class: "bn" }, [b.name || "—"]),
        el("div", { class: "bh" }, [b.url ? host(b.url) : "@" + (b.handle || "")]),
      ]),
    ]);
  }

  function viewLanding() {
    render([
      el("div", { class: "hero" }, [
        el("h1", {}, ["Your corner of the internet — connected."]),
        el("p", {}, ["Den links personal websites into one social graph you can follow, save, and explore. Keep your own site. Add one line. Be discoverable."]),
        el("a", { class: "google", href: signinUrl() }, [googleSvg(), "Continue with Google"]),
      ]),
      el("div", { class: "section" }, [
        el("h2", {}, ["How it works"]),
        el("div", { class: "note" }, [
          "Sign in, then paste one line into your site (any platform). A small badge appears so visitors can follow you — and you show up in everyone's graph.",
        ]),
      ]),
    ]);
  }

  async function viewEdit() {
    if (!me) return go("#/");
    var f = {
      name: inputField("Name", "name", me.name || ""),
      handle: inputField("Handle", "handle", me.handle || ""),
      url: inputField("Your site URL", "url", me.url || "", "https://you.example"),
      avatar: inputField("Avatar image URL", "avatar", me.avatar || "", "https://…/me.jpg"),
      bio: textField("Bio", "bio", me.bio || ""),
    };
    var status = el("div", { class: "empty" }, [""]);
    var form = el("form", { onsubmit: save }, [
      f.name.wrap, f.handle.wrap, f.url.wrap, f.avatar.wrap, f.bio.wrap,
      el("div", { class: "row" }, [
        el("button", { class: "btn primary", type: "submit" }, ["Save"]),
        el("a", { class: "btn", href: "#/" }, ["Cancel"]),
        status,
      ]),
    ]);
    render([el("h2", { class: "section" }, ["Edit profile"]), form]);

    async function save(ev) {
      ev.preventDefault();
      status.textContent = "Saving…";
      try {
        me = await api("/api/profile", {
          method: "PATCH", headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: f.name.input.value, handle: f.handle.input.value,
            url: f.url.input.value, avatar: f.avatar.input.value, bio: f.bio.input.value,
          }),
        });
        renderNav(); toast("Saved"); go("#/");
      } catch (e) {
        status.textContent = e.status === 409 ? "That handle is taken." : "Couldn't save.";
      }
    }
  }

  function viewEmbed() {
    if (!me) return go("#/");
    var idShort = me.id.replace(/^den:/, "");
    var tag = '<script src="' + location.origin + '/w/' + idShort + '.js"><\/script>';
    var box = el("div", { class: "snippet" }, [tag]);
    box.append(el("button", { class: "btn sm copy", onclick: function () {
      navigator.clipboard.writeText(tag).then(function () { toast("Copied"); });
    } }, ["Copy"]));

    render([
      el("h2", { class: "section" }, ["Your widget"]),
      el("p", {}, ["Paste this once into your site — footer, header, or any HTML block. Works on Squarespace, WordPress, Wix, Jekyll, Lovable, or hand-written HTML."]),
      box,
      el("div", { class: "section" }, [
        el("h2", {}, ["Vibe-coding your site?"]),
        el("div", { class: "note" }, [
          "Tell your AI agent: ", el("b", {}, ["“add Den — see " + location.origin + "/skill.md”"]),
          ". It'll insert the line for you.",
        ]),
      ]),
    ]);
  }

  // ---- form field builders -------------------------------------------------
  function inputField(label, name, value, ph) {
    var input = el("input", { name: name, value: value, placeholder: ph || "" });
    return { input: input, wrap: el("div", { class: "field" }, [el("label", {}, [label]), input]) };
  }
  function textField(label, name, value) {
    var input = el("textarea", { name: name }, [value]);
    return { input: input, wrap: el("div", { class: "field" }, [el("label", {}, [label]), input]) };
  }

  // ---- render + router -----------------------------------------------------
  function render(nodes) { clear(app); nodes.forEach(function (n) { if (n) app.append(n); }); }
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

  var routes = { "#/": viewHome, "#/edit": viewEdit, "#/embed": viewEmbed };
  async function route() {
    var view = routes[location.hash] || viewHome;
    app.innerHTML = '<div class="loading">…</div>';
    try { await view(); } catch (e) { render([el("div", { class: "empty" }, ["Something went wrong. Try reloading."])]); }
  }

  function googleSvg() {
    var s = '<svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.9 2.4 30.3 0 24 0 14.6 0 6.4 5.4 2.5 13.3l7.9 6.1C12.3 13.2 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.1 5.3-4.6 7l7.1 5.5c4.2-3.9 6.6-9.6 6.6-16.5z"/><path fill="#FBBC05" d="M10.4 28.6c-.5-1.5-.8-3-.8-4.6s.3-3.1.8-4.6l-7.9-6.1C.9 16.5 0 20.1 0 24s.9 7.5 2.5 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.3 0 11.6-2.1 15.5-5.6l-7.1-5.5c-2 1.4-4.6 2.2-8.4 2.2-6.3 0-11.7-3.7-13.6-9.4l-7.9 6.1C6.4 42.6 14.6 48 24 48z"/></svg>';
    var span = el("span", { html: s }); return span;
  }

  // ---- boot ----------------------------------------------------------------
  window.addEventListener("hashchange", route);
  (async function boot() {
    try { me = await api("/api/viewer"); } catch (e) { me = null; }
    renderNav();
    if (!location.hash) location.hash = "#/";
    route();
  })();
})();
