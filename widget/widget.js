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

  // Dev HUD: a small footer showing whether/how the widget sees you as signed in,
  // plus a sign-out button for testing. On only against a local API (or data-dev).
  var DEV = script.getAttribute("data-dev") === "true" || /\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(cfg.api);

  var host, card, ui, busy = false, viewed = false;
  // An action (follow/save) the visitor tried while signed out. We stash it,
  // open auth, then replay it automatically once they're back — so a click never
  // has to be repeated after signing in.
  var pendingAction = null;
  var isPrivate = false; // the inline private-note switch (signed-in visitors only)
  var draftKey = "den_draft_" + cfg.id;
  var tokenKey = "den_token";

  // The faces offered in the reaction tray. Every reaction is public.
  var REACTIONS = ["❤️", "🔥", "😂", "👏", "🎉", "✨", "👀", "🙌"];

  // A clean filled person silhouette for anonymous / private avatars.
  var SILHOUETTE = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="9" r="3.6"/><path d="M5 19.4a7 7 0 0 1 14 0Z"/></svg>';

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
    ui.devOut.onclick = signOut;
    ui.privCheck.onchange = function () { isPrivate = ui.privCheck.checked; };
    ui.input.oninput = function () { store(draftKey, ui.input.value.trim()); toggleTray(false); paintSend(); paintPrivacy(); };
    ui.input.onkeydown = function (e) { if (e.key === "Enter") { e.preventDefault(); submit(); } };
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") { toggleTray(false); open(false); } });
    document.addEventListener("click", function (e) {
      if (ui.wrap.classList.contains("open") && e.composedPath && e.composedPath().indexOf(host) === -1) open(false);
    });
    window.addEventListener("message", function (e) {
      if (e.data && e.data.den === "signed-in") {
        store(tokenKey, e.data.token || "");
        load().then(resumePending);
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
    // A stored token that resolves to no viewer is stale (e.g. the visitor signed
    // out elsewhere). Drop it so it can't shadow a future session and so "authed"
    // reflects reality — no more navigating away when you're actually signed in.
    if (store(tokenKey) && !card.viewer) store(tokenKey, "");
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
    if (busy || !cfg.id || !card) return;
    // Signed out → remember the intent and authenticate first (no optimistic
    // flip we'd just have to revert). resumePending() replays it after sign-in.
    if (!card.viewer) { pendingAction = { path: path, flag: flag }; return signIn(); }
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
      if (e.status === 401) { pendingAction = { path: path, flag: flag }; signIn(); }
    } finally { busy = false; }
  }

  // After sign-in the card is reloaded; if the visitor had clicked follow/save
  // beforehand, carry that action through now that they have a session.
  function resumePending() {
    var a = pendingAction;
    pendingAction = null;
    if (a && card && card.viewer) act(a.path, a.flag);
  }

  // Is this visitor signed in here? The widget sends its stored Bearer token, so
  // on a site where they've authenticated before, the card comes back with a
  // viewer — and they can post in place, no second window.
  function authed() { return !!(cfg.id && card && card.viewer); }

  // Pressing Enter (or the send arrow) with text:
  //  • signed in  → post the note in place, honoring the private switch.
  //  • signed out → carry the draft to the full-page postcard composer (a new
  //    tab), where they pick public/private and sign in to send.
  // With no text yet, the same key just opens the emoji tray.
  function submit() {
    var text = ui.input.value.trim();
    if (!text) return toggleTray();
    if (authed()) return postNote(text, isPrivate);
    if (!cfg.id) return signIn();
    openTab(mainUrl("/compose", { to: cfg.id, site: siteName(), body: text }));
  }

  // Reactions are always public AND always attributed (never anonymous).
  //  • signed in  → post in place, instantly, no redirect.
  //  • signed out → open the confirmation tab (synchronously, inside the click,
  //    so a popup blocker can't eat it). That page posts the reaction as them
  //    once they have a session — so it shows their name, never "Someone".
  function react(emoji) {
    if (busy || !cfg.id) return;
    toggleTray(false);
    if (authed()) return postReaction(emoji);
    openTab(mainUrl("/reacted", { to: cfg.id, site: siteName(), emoji: emoji }));
  }

  // Post a written note as the signed-in visitor, in place. If the session turns
  // out to be stale (401), fall back to the postcard page so nothing is lost.
  async function postNote(text, priv) {
    if (busy) return;
    busy = true;
    try {
      await send(text, priv);
      ui.input.value = "";
      store(draftKey, "");
      isPrivate = false;
      paintSend();
      paintPrivacy();
    } catch (e) {
      if (e.status === 401) openTab(mainUrl("/compose", { to: cfg.id, site: siteName(), body: text }));
    } finally { busy = false; }
  }

  // A signed-in reaction is just a public emoji note, posted in place. If the
  // session turns out to be stale (401), hand off to the confirmation tab, which
  // re-auths and posts it as them — still attributed, never anonymous.
  async function postReaction(emoji) {
    if (busy) return;
    busy = true;
    try {
      await send(emoji, false);
    } catch (e) {
      if (e.status === 401) openTab(mainUrl("/reacted", { to: cfg.id, site: siteName(), emoji: emoji }));
    } finally { busy = false; }
  }

  // Post a comment and refresh the notes list from the server's response.
  function send(body, priv) {
    return api("/api/profile/" + enc(cfg.id) + "/comments", { body: body, visibility: priv ? "private" : "public" })
      .then(function (comments) { card.comments = comments; paintNotes(); });
  }

  function buildTray() {
    if (!ui.tray) return;
    // One row only. CSS lays out 5 columns (the most that fit a widescreen card);
    // showing 5 keeps it to a single row on every screen width.
    REACTIONS.slice(0, 5).forEach(function (e) {
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

    paintDev(); // dev HUD reflects auth state in every view (incl. onboarding)

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
    paintPrivacy();
  }

  // The private-note switch slides down only when the visitor is signed in AND
  // mid-note (there's text). Guests never see it — their note is composed on the
  // full postcard page, which has its own public/private toggle.
  function paintPrivacy() {
    if (!ui.privacy) return;
    ui.privacy.classList.toggle("show", authed() && !!ui.input.value.trim());
    ui.privCheck.checked = isPrivate;
  }

  // Dev-only footer: shows whether the widget sees you as signed in, WHICH account,
  // and HOW the server knew (Bearer token vs first-party cookie). Plus a sign-out
  // button for testing both paths. Hidden entirely unless DEV.
  function paintDev() {
    if (!ui.dev) return;
    ui.dev.hidden = !DEV;
    if (!DEV) return;
    var v = card && card.viewer;
    var via = card && card.auth;        // "bearer" | "cookie" | null (from the card)
    var hasTok = !!store(tokenKey);
    ui.devState.textContent = v
      ? "auth ✓ " + (v.handle ? "@" + v.handle : v.name || v.id) + " · via " + (via || "session")
      : "guest · " + (hasTok ? "stale token, no session" : "no token, no cookie");
    ui.devOut.hidden = !(v || hasTok);  // nothing to sign out of
  }

  // Dev-only: drop the widget's token AND end the den.com session/cookie, then
  // reload the card so the HUD flips to "guest" — for testing the signed-out flow.
  function signOut() {
    store(tokenKey, "");
    api("/api/logout", {}).then(load, load);
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
    // When following, the label lives in .lbl so hover can swap it for "Unfollow".
    ui.follow.innerHTML = following ? '<span class="lbl">' + icon("check") + "Following</span>" : "Follow";
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
    var anon = !n.redacted && !(a.name || a.handle || a.avatar);
    var reaction = !n.redacted && isReaction(n.body) ? n.body.trim() : "";
    var row = node("div", "note");
    var av = node("span", "note-av" + (n.redacted || anon ? " private-av" : ""));
    var copy = node("div", "note-copy");
    var line = node("div", "note-line");

    if (n.redacted || anon) av.innerHTML = SILHOUETTE; // clean placeholder, no "?"
    else avatar(av, a);
    if (n.redacted) av.append(badge("mail-badge", icon("mail")));

    // Activity-feed line: bold name, dimmer verb, then a gray timestamp.
    line.append(n.redacted ? node("b", "", "Someone") : author(a));
    if (n.redacted) line.append(node("span", "act", " left a private note"));
    else if (reaction) {
      line.append(node("span", "act", " reacted with "));
      line.append(node("span", "react-emoji", reaction)); // the emoji, rendered 1.5×
    } else if (n.visibility === "private") line.append(node("span", "badge", "private"));
    var ts = relTime(n.created);
    if (ts) line.append(node("time", "note-time", ts));

    copy.append(line);
    // A written note shows its text under the line; a reaction doesn't.
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
      // Tag-first: whether they just signed up or already had an account, the
      // reason they authenticated from this site's widget is to get the permanent
      // tag to paste in. So it's the hero; the dashboard is a secondary link.
      ui.obTitle.textContent = "You're in" + (p.name ? ", " + firstName(p.name) : "") + " 🎉";
      ui.obBody.textContent = "Paste this line on your site to finish — it replaces the generic tag and keeps your followers attached even if your domain changes.";
      ui.obCode.textContent = tagLine(card.script);
      ui.obTag.hidden = false;
      ui.obCta.hidden = true;
      ui.obAlt.textContent = "Open your dashboard";
      ui.obAlt.onclick = function () { openTab(cfg.api + "/"); };
      ui.obAlt.hidden = false;
    } else {
      ui.obTitle.textContent = "Welcome to Den";
      ui.obBody.textContent = "Den connects personal sites into one network — followers, notes, and a profile that's yours. This widget is now live here. Create your account to claim this site.";
      ui.obCta.textContent = "Create your account";
      ui.obCta.onclick = signIn;
      ui.obCta.hidden = false;
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
    paintPrivacy();
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
        '<label class="privacy">' +
          '<input type="checkbox" class="priv-check" aria-label="Send this as a private note">' +
          '<span class="switch" aria-hidden="true"></span>' +
          '<span class="priv-text">Send this as a private note</span>' +
        '</label>' +
        '<div class="onboard">' +
          '<div class="ob-mark"><span class="logo">den</span></div>' +
          '<h2 class="ob-title"></h2>' +
          '<p class="ob-body"></p>' +
          '<div class="ob-tag" hidden><code class="ob-code"></code><button class="ob-copy">Copy</button></div>' +
          '<button class="ob-cta"></button>' +
          '<button class="ob-alt" hidden></button>' +
        '</div>' +
        '<div class="dev" hidden><span class="dev-tag">DEV</span><span class="dev-state"></span><button class="dev-out" type="button" hidden>Sign out</button></div>' +
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
      privacy: q(".privacy"), privCheck: q(".priv-check"),
      stats: q(".stats"), views: q(".views"), followers: q(".followers"),
      viewsLink: q(".views-link"), followersLink: q(".followers-link"),
      onboard: q(".onboard"), obTitle: q(".ob-title"), obBody: q(".ob-body"),
      obCta: q(".ob-cta"), obAlt: q(".ob-alt"), obTag: q(".ob-tag"),
      obCode: q(".ob-code"), obCopy: q(".ob-copy"),
      dev: q(".dev"), devState: q(".dev-state"), devOut: q(".dev-out"),
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
      '.save{width:46px;height:46px;border-radius:50%;background:var(--soft);color:var(--ink);font-size:21px;display:grid;place-items:center}.save:hover{background:var(--line)}' +
      // Saved = quiet outline; hover turns red to signal "unsave".
      '.save.on{background:transparent;color:var(--ink);border:1px solid var(--line)}.save.on:hover{background:rgba(229,72,77,.12);color:#e5484d;border-color:rgba(229,72,77,.5)}' +
      '.follow{display:inline-flex;align-items:center;justify-content:center;gap:7px;height:46px;padding:0 22px;border-radius:999px;background:var(--accent);color:var(--bg);font:600 17px/1 var(--ff)}.follow:hover{opacity:.9}' +
      // Following = quiet outline; hover reveals the destructive "Unfollow" in red.
      '.follow.on{background:transparent;color:var(--ink);border:1px solid var(--line)}.follow.on:hover{background:rgba(229,72,77,.12);color:#e5484d;border-color:rgba(229,72,77,.5);opacity:1}.follow.on:hover .lbl{display:none}.follow.on:hover::after{content:"Unfollow"}' +
      '.name{display:inline-block;margin:18px 0 24px;color:var(--ink);font:600 28px/1.15 var(--ff);letter-spacing:-.02em;text-decoration:none}.name:hover{text-decoration:underline;text-underline-offset:4px}' +
      '.stats{display:flex;flex-wrap:wrap;gap:8px 22px;margin:16px 0 26px}.stats[hidden]{display:none}.stat{color:var(--muted);text-decoration:none;font-size:16px;font-weight:600}.stat b{color:var(--ink);font-weight:800;margin-right:5px}.stat:hover span{text-decoration:underline;text-underline-offset:3px}' +
      '.pins{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 24px}.pins[hidden]{display:none}' +
      '.pin{display:flex;align-items:center;gap:7px;max-width:100%;padding:5px 12px 5px 5px;border:1px solid var(--line);border-radius:999px;color:var(--ink);text-decoration:none;font:700 13px/1 var(--ff)}.pin:hover{background:var(--soft)}' +
      '.pin-av{width:24px;height:24px;border-radius:50%;background:#e5e7eb center/cover no-repeat;display:grid;place-items:center;color:#111;font:800 11px/1 var(--ff);flex:0 0 auto}' +
      '.pin-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:130px}' +
      '.notes{display:grid;gap:22px}.note{display:flex;align-items:center;gap:14px}' +
      '.note-av{position:relative;width:42px;height:42px;flex:0 0 auto;border-radius:50%;background:#e5e7eb center/cover no-repeat;display:grid;place-items:center;color:#111;font:600 16px/1 var(--ff)}' +
      '.private-av{background:var(--soft);overflow:hidden}.private-av svg{width:62%;height:62%;color:#b4b4b9}' +
      '.mail-badge{position:absolute;right:-5px;bottom:-5px;width:23px;height:23px;border-radius:50%;background:var(--bg);box-shadow:0 1px 4px rgba(0,0,0,.18);display:grid;place-items:center;color:#ff2d55;font-size:13px}' +
      '.note-copy{min-width:0}.note-line{font:400 16px/1.45 var(--ff);color:var(--ink);overflow-wrap:anywhere;opacity:.9}.author,.note-line b{color:var(--ink);font-weight:600;text-decoration:none}.author:hover{text-decoration:underline}' +
      '.act{color:var(--muted)}.react-emoji{font-size:1.25em;line-height:1;vertical-align:-.12em}.note-time{margin-left:6px;color:var(--muted);font-size:14px;white-space:nowrap}' +
      '.note p{margin:3px 0 0;font-size:15px;color:var(--ink);opacity:.8;overflow-wrap:anywhere}' +
      '.badge{margin-left:7px;border:1px solid var(--line);border-radius:999px;padding:2px 8px;font-size:11px;font-weight:600;color:var(--muted)}.empty{color:var(--muted);font-size:14px}.see-all{justify-self:start;display:inline-flex;align-items:center;gap:5px;min-height:38px;margin-top:2px;padding:0 8px;color:var(--muted);text-decoration:none;font:600 14px/1 var(--ff)}.see-all::after{content:"→"}.see-all:hover{color:var(--ink);text-decoration:none}' +
      '.status{color:var(--muted);font-size:13px;margin-top:10px;overflow-wrap:anywhere}.status:empty{display:none}' +
      '.composer{display:flex;align-items:center;gap:4px;margin-top:24px;padding:6px;border:1px solid var(--line);border-radius:999px;background:var(--bg);box-shadow:0 10px 36px rgba(0,0,0,.07);transition:box-shadow .15s ease}.composer:focus-within{box-shadow:0 0 0 3px rgba(0,0,0,.05),0 10px 36px rgba(0,0,0,.07)}' +
      '.den button:focus{outline:none}.den button:focus-visible{outline:2px solid rgba(0,0,0,.18);outline-offset:2px}' +
      '.input{flex:1;min-width:0;border:0;background:transparent;color:var(--ink);font:400 16px/1 var(--ff);padding:12px 8px 12px 14px;outline:none}.input::placeholder{color:var(--muted);font-weight:400}' +
      '.react{width:40px;height:40px;border-radius:50%;background:transparent;color:var(--muted);font-size:18px;display:grid;place-items:center}.react:hover{background:var(--soft);color:var(--ink)}.react.on{background:var(--soft);color:var(--ink)}' +
      '.tray{display:grid;grid-template-columns:repeat(5,1fr);gap:4px;margin-top:14px;padding:6px;border:1px solid var(--line);border-radius:20px;background:var(--bg);box-shadow:0 10px 36px rgba(0,0,0,.07)}.tray[hidden]{display:none}.tray:not([hidden]){animation:trayUp .2s cubic-bezier(.2,.7,.3,1)}@keyframes trayUp{from{opacity:0;transform:translateY(10px)}}' +
      '.emoji{height:46px;border-radius:14px;background:transparent;font-size:24px;line-height:1;display:grid;place-items:center;transition:transform .12s ease,background .12s ease}.emoji:hover{background:var(--soft);transform:translateY(-2px)}.emoji:active{transform:scale(.9)}' +
      '.send{width:42px;height:42px;border-radius:50%;background:var(--soft);color:var(--muted);font-size:22px;display:grid;place-items:center;transition:background .15s ease,color .15s ease}.send.ready{background:var(--accent);color:var(--bg)}.send:hover{color:var(--ink)}.send.ready:hover{color:var(--bg);opacity:.9}' +
      // The private-note switch: collapsed by default, slides down (max-height +
      // fade) once a signed-in visitor starts writing.
      '.privacy{display:flex;align-items:center;gap:10px;overflow:hidden;max-height:0;opacity:0;margin-top:0;padding:0 6px;cursor:pointer;user-select:none;font:600 13px/1.2 var(--ff);color:var(--muted);transition:max-height .22s ease,opacity .2s ease,margin-top .22s ease}' +
      '.privacy.show{max-height:44px;opacity:1;margin-top:12px}' +
      '.priv-check{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}' +
      '.switch{position:relative;flex:0 0 auto;width:36px;height:21px;border-radius:999px;background:var(--line);transition:background .16s ease}' +
      '.switch::after{content:"";position:absolute;top:2px;left:2px;width:17px;height:17px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .16s ease}' +
      '.priv-check:checked+.switch{background:var(--accent)}.priv-check:checked+.switch::after{transform:translateX(15px)}.priv-check:focus-visible+.switch{box-shadow:0 0 0 3px rgba(0,0,0,.14)}' +
      // Dev HUD — a thin monospace footer, only present against a local API.
      '.dev{display:flex;align-items:center;gap:8px;margin-top:18px;padding-top:12px;border-top:1px dashed var(--line);font:600 11px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted)}.dev[hidden]{display:none}' +
      '.dev-tag{flex:0 0 auto;padding:2px 6px;border-radius:6px;background:var(--accent);color:var(--bg);font-weight:800;letter-spacing:.04em}' +
      '.dev-state{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.dev-out{flex:0 0 auto;padding:5px 11px;border-radius:999px;background:var(--soft);color:var(--ink);border:1px solid var(--line);font:inherit;font-weight:700;cursor:pointer}.dev-out:hover{background:var(--line)}.dev-out[hidden]{display:none}' +
      // Onboarding view (the generic /w.js front door). When .onboarding is on the
      // card, the profile chrome is hidden and this self-contained flow shows.
      '.onboard{display:none;text-align:center;padding:6px 2px 2px}.card.onboarding .onboard{display:block}' +
      '.card.onboarding>.top,.card.onboarding>.name,.card.onboarding>.stats,.card.onboarding>.pins,.card.onboarding>.notes,.card.onboarding>.status,.card.onboarding>.tray,.card.onboarding>.composer,.card.onboarding>.privacy{display:none!important}' +
      '.ob-mark{width:56px;height:56px;margin:8px auto 18px;border-radius:50%;background:var(--accent);color:var(--bg);display:grid;place-items:center}.ob-mark .logo{font:950 16px/1 var(--ff);letter-spacing:-.03em}' +
      '.ob-title{margin:0 0 10px;font:600 22px/1.2 var(--ff);letter-spacing:-.02em;color:var(--ink)}' +
      '.ob-body{margin:0 auto 22px;max-width:34ch;font:400 15px/1.55 var(--ff);color:var(--muted)}' +
      '.ob-cta{display:block;width:100%;height:52px;border-radius:999px;background:var(--accent);color:var(--bg);font:600 16px/1 var(--ff)}.ob-cta:hover{opacity:.9}.ob-cta[hidden]{display:none}' +
      '.ob-alt{display:block;width:100%;margin-top:10px;height:42px;background:transparent;color:var(--muted);font:600 14px/1 var(--ff)}.ob-alt:hover{color:var(--ink)}.ob-alt[hidden]{display:none}' +
      '.ob-tag{display:flex;align-items:center;gap:8px;margin-top:18px;padding:8px 8px 8px 14px;border:1px solid var(--line);border-radius:14px;background:var(--soft);text-align:left}.ob-tag[hidden]{display:none}' +
      '.ob-code{flex:1;min-width:0;overflow:auto;white-space:nowrap;font:500 12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--ink)}' +
      '.ob-copy{flex:0 0 auto;height:36px;padding:0 16px;border-radius:999px;background:var(--accent);color:var(--bg);font:600 13px/1 var(--ff)}.ob-copy:hover{opacity:.9}' +
      '.launcher{position:relative;display:flex;align-items:center;gap:9px;border:1px solid var(--line);background:#fff;color:#050505;border-radius:999px;padding:6px 16px 6px 6px;box-shadow:var(--shadow);font:600 14px/1 var(--ff);transition:transform .16s ease}.launcher:hover{transform:translateY(-2px)}' +
      '.pill-avatar{width:30px;height:30px;border-radius:50%;background:#e5e7eb center/cover no-repeat;display:grid;place-items:center;color:#111;font-weight:600;flex:0 0 auto}' +
      '.notif{position:absolute;top:-3px;right:-3px;min-width:22px;height:22px;padding:0 7px;border-radius:999px;background:#ff2d55;color:#fff;display:grid;place-items:center;font:600 12px/1 var(--ff);box-shadow:0 2px 8px rgba(255,45,85,.4)}.notif[hidden]{display:none}' +
      '.logo{display:grid;place-items:center;font-weight:950;letter-spacing:-.02em}' +
      '.launcher-avatar .launcher,.launcher-circle .launcher,.launcher-logo .launcher,.launcher-mark .launcher,.launcher-halo .launcher{padding:6px;width:62px;height:62px;justify-content:center}.launcher-avatar .pill-avatar,.launcher-circle .pill-avatar,.launcher-halo .pill-avatar{width:50px;height:50px}.launcher-avatar .launcher,.launcher-avatar .pill-avatar{border-radius:18px}.launcher-circle .launcher,.launcher-circle .pill-avatar,.launcher-logo .launcher,.launcher-mark .launcher,.launcher-halo .launcher,.launcher-halo .pill-avatar{border-radius:50%}.launcher-circle .launcher{width:64px;height:64px}.launcher-circle .pill-avatar{width:42px;height:42px}' +
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
  // Compact relative time for the notes feed: now, 5m, 15h, 2d, 3w, 4mo, 1y.
  function relTime(s) {
    var t = Date.parse(s || "");
    if (!t) return "";
    var d = Date.now() - t, m = 6e4, h = 36e5, day = 864e5;
    if (d < m) return "now";
    if (d < h) return Math.floor(d / m) + "m";
    if (d < day) return Math.floor(d / h) + "h";
    if (d < 7 * day) return Math.floor(d / day) + "d";
    if (d < 30 * day) return Math.floor(d / (7 * day)) + "w";
    if (d < 365 * day) return Math.floor(d / (30 * day)) + "mo";
    return Math.floor(d / (365 * day)) + "y";
  }
})();
