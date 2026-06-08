(function () {
  "use strict";

  if (window.__signmysiteWidget) return;
  window.__signmysiteWidget = true;

  // A self-describing handle for anything inspecting the live page — including
  // an AI agent reading the DOM: what this is and where its docs live, without
  // diving into source. (The origin is rewritten to the live host on serve.)
  window.signmysite = window.signmysite || {
    version: "signmysite/v1",
    docs: "https://signmysite.com/skill.md",
    wellKnown: "https://signmysite.com/.well-known/signmysite.json",
  };

  var script = document.currentScript || document.querySelector('script[src*="/w/"],script[data-id]');
  if (!script) return;

  var origin = "";
  try { origin = new URL(script.src).origin; } catch (_) {}

  var cfg = {
    id: idOf(script),
    api: (script.getAttribute("data-api") || origin || "https://signmysite.com").replace(/\/$/, ""),
    // Presentation. The default is the visible follow / comments / reactions card,
    // so a bare tag (including ones added before data-ui existed) always renders —
    // backwards compatible. data-ui="none" is the opt-out: join the graph and track
    // views with NO visible UI (a quiet presence + analytics beacon). data-collapsed
    // still picks badge vs. open for the card.
    ui: (script.getAttribute("data-ui") || "card").toLowerCase(),
    theme: script.getAttribute("data-theme") || "light",
    position: script.getAttribute("data-position") || "bottom-right",
    launcher: script.getAttribute("data-launcher") || "circle",
    // Closed by default — a quiet badge until tapped. data-collapsed="false" opens it.
    collapsed: script.getAttribute("data-collapsed") !== "false",
    // How the owner's pinned sites (their webring) are shown: "ring" (default) |
    // "stack" | "thumbs" | "spotlight" | "list". See paintPins().
    pins: (script.getAttribute("data-pins") || "ring").toLowerCase(),
  };
  cfg.generic = !cfg.id;

  // Views/followers are hidden for now — flip to true to bring the stats row back.
  var SHOW_STATS = false;

  // Dev HUD: a small footer showing whether/how the widget sees you as signed in,
  // plus a sign-out button for testing. On only against a local API (or data-dev).
  var DEV = script.getAttribute("data-dev") === "true" || /\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(cfg.api);

  // Preview mode: the owner opened their own site with ?signmysite_preview=1 (the eye
  // button) to see the signed-out, guest version of their widget. We render as a
  // guest by nulling the viewer on load — without touching their real session.
  var previewGuest = false;
  try { previewGuest = new URL(location.href).searchParams.get("signmysite_preview") === "1"; } catch (_) {}

  var host, card, ui, busy = false, viewed = false, isOwner = false;
  // The server-served public demo (demo.ts) sets card.demo. There's no real record
  // behind it, so in demo mode every internal link/action returns the visitor to the
  // page instead of opening a dead signmysite route — see demoBounce(). Set in load().
  var inDemo = false;
  // Engaged-time tracking for this page: engagedMs accumulates visible time, and
  // visibleSince marks the start of the current visible span (0 while hidden).
  var engagedMs = 0, visibleSince = 0;
  // An action (follow/save) the visitor tried while signed out. We stash it,
  // open auth, then replay it automatically once they're back — so a click never
  // has to be repeated after signing in.
  var pendingAction = null;
  var isPrivate = false; // the inline private-note switch (signed-in visitors only)
  var draftKey = "signmysite_draft_" + cfg.id;
  var tokenKey = "signmysite_token";

  // The faces offered in the reaction tray. Every reaction is public.
  var REACTIONS = ["❤️", "🔥", "😂", "👏", "🎉", "✨", "👀", "🙌"];

  // A clean filled person silhouette for anonymous / private avatars.
  var SILHOUETTE = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="9" r="3.6"/><path d="M5 19.4a7 7 0 0 1 14 0Z"/></svg>';

  // A neutral page wireframe shown for a pinned site that has no preview image
  // (og:image) yet — so the thumbnail/webring views never show a broken image.
  var PIN_PLACEHOLDER = "data:image/svg+xml;utf8," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="#f1f1f3"/><rect x="58" y="56" width="284" height="188" rx="14" fill="#fff" stroke="#e4e4e8" stroke-width="2"/><rect x="84" y="118" width="232" height="62" rx="10" fill="#eaeaee"/><rect x="84" y="196" width="168" height="12" rx="6" fill="#eaeaee"/></svg>'
  );

  ready(start);

  function start() {
    // data-ui="none" is the headless opt-out: do the network work — register/claim,
    // count the view, passively verify ownership — without building any UI. load()
    // does all of it; paint()/fail() no-op with no `ui`. Anything else (the default
    // included) builds the visible card below.
    if (cfg.ui === "none") return load();

    host = document.createElement("div");
    var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
    host.setAttribute("data-signmysite-widget", "");
    document.body.appendChild(host);
    root.innerHTML = style() + html(cfg);
    ui = map(root);

    ui.open.onclick = function () { open(!ui.wrap.classList.contains("open")); };
    // Owner sees Edit profile (→ dashboard) and a Preview eye where guests see
    // Follow + Save.
    ui.follow.onclick = function () { if (isOwner) return openTab(cfg.api + "/#/edit"); armFollowGuard(); act("/api/follow", "viewerFollows"); };
    ui.save.onclick = function () { if (isOwner) return openPreview(); act("/api/save", "viewerSaved"); };
    ui.react.onclick = function () { toggleTray(); };
    ui.send.onclick = submit;
    ui.obCopy.onclick = copyTag;
    ui.obHelp.onclick = function () { toggleHelp(); };
    ui.devOut.onclick = signOut;
    ui.privCheck.onchange = function () { isPrivate = ui.privCheck.checked; };
    ui.input.oninput = function () { store(draftKey, ui.input.value.trim()); toggleTray(false); paintSend(); paintPrivacy(); };
    ui.input.onkeydown = function (e) { if (e.key === "Enter") { e.preventDefault(); submit(); } };
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") { toggleTray(false); open(false); } });
    document.addEventListener("click", function (e) {
      if (ui.wrap.classList.contains("open") && e.composedPath && e.composedPath().indexOf(host) === -1) open(false);
    });
    // Demo mode: comments, the name/avatar and the social rows all link to a signmysite
    // profile that, for the demo, has no real record behind it. Intercept those clicks
    // and return to the page instead of opening a dead route. Real pins (other people's
    // sites, on their own origin) aren't internal links, so they fall through and open.
    root.addEventListener("click", function (e) {
      if (!inDemo || !e.composedPath) return;
      var p = e.composedPath(), a = null;
      for (var i = 0; i < p.length && p[i] !== host; i++) { if (p[i].tagName === "A") { a = p[i]; break; } }
      if (a && a.href && a.href.lastIndexOf(cfg.api, 0) === 0) { e.preventDefault(); demoBounce(); }
    }, true);
    window.addEventListener("message", function (e) {
      if (e.data && e.data.signmysite === "signed-in") {
        store(tokenKey, e.data.token || "");
        load().then(resumePending);
      }
    });
    // Returning to the tab after a sign-in detour (mobile opens auth in a separate
    // tab, so the postMessage above can be missed): re-check the session and replay
    // any pending follow/save. No-op unless a sign-in was actually started.
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && pendingAction) load().then(resumePending);
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
    inDemo = !!card.demo;
    // Preview mode: render exactly what a signed-out guest sees, without touching
    // the real session/token (so closing the preview tab leaves you signed in).
    if (previewGuest) card.viewer = null;
    // A stored token that resolves to no viewer is stale (e.g. the visitor signed
    // out elsewhere). Drop it so it can't shadow a future session and so "authed"
    // reflects reality — no more navigating away when you're actually signed in.
    else if (store(tokenKey) && !card.viewer) store(tokenKey, "");
    paint();
    if (cfg.id && !viewed) {
      viewed = true;
      trackView();
    }
  }

  // Record this page view and start the engaged-time clock. The view goes through
  // api(), so it carries the Bearer token — that's how the server learns WHICH signmysite
  // member is reading (the relational bit); anonymous visitors just count. Path +
  // referrer ride along for the owner's breakdown. Duration is reported separately,
  // on exit, by sendEngagement() — a beacon that can't carry headers.
  function trackView() {
    var path = "", ref = "";
    try { path = location.pathname; } catch (_) {}
    try { ref = document.referrer || ""; } catch (_) {}
    api("/api/profile/" + enc(cfg.id) + "/view", { session: sid(), path: path, ref: ref }).catch(function () {});
    startEngagement();
  }

  // Engaged time = how long the page is actually visible (a background tab doesn't
  // count). We accumulate visible spans and report the running total on tab-hide
  // and on page-exit; the server keeps the max, so repeated beacons are harmless.
  function startEngagement() {
    visibleSince = document.visibilityState === "visible" ? Date.now() : 0;
    document.addEventListener("visibilitychange", onVisibility, { passive: true });
    // pagehide fires on real unloads AND bfcache navigations, where unload doesn't.
    window.addEventListener("pagehide", sendEngagement, { passive: true });
  }
  function accrue() {
    if (visibleSince) { engagedMs += Date.now() - visibleSince; visibleSince = 0; }
  }
  function onVisibility() {
    if (document.visibilityState === "visible") { if (!visibleSince) visibleSince = Date.now(); }
    else { accrue(); sendEngagement(); } // hiding the tab is a reliable "leaving" signal
  }
  function sendEngagement() {
    accrue();
    if (!cfg.id || engagedMs < 1000) return; // ignore sub-second blips
    var ms = Math.min(engagedMs, 6 * 3600 * 1000);
    var url = cfg.api + "/api/profile/" + enc(cfg.id) + "/view";
    var payload = JSON.stringify({ session: sid(), ms: ms });
    var sent = false;
    // text/plain keeps it a "simple" request — no CORS preflight as the page unloads.
    try { if (navigator.sendBeacon) sent = navigator.sendBeacon(url, new Blob([payload], { type: "text/plain" })); } catch (_) {}
    if (!sent) api("/api/profile/" + enc(cfg.id) + "/view", { session: sid(), ms: ms }).catch(function () {});
  }

  // Follow / save. Flip the button's state immediately (optimistic) so the click
  // always gives instant feedback, then reconcile with the server — reverting if
  // the request fails.
  async function act(path, flag) {
    if (inDemo) return demoBounce();
    if (busy || !cfg.id || !card) return;
    // Signed out → remember the intent and authenticate first (no optimistic
    // flip we'd just have to revert). resumePending() replays it after sign-in.
    if (!card.viewer) { pendingAction = { path: path, flag: flag }; return signIn(); }
    card.stats = card.stats || {};
    var prev = !!card.stats[flag];
    card.stats[flag] = !prev;
    // A follow seeds a save: turning Follow ON also saves the site (mirrors the
    // server), so the bookmark fills the instant you follow. Unfollow leaves the
    // save, and Save stays its own toggle for sites you bookmark without following.
    if (path === "/api/follow" && card.stats[flag]) card.stats.viewerSaved = true;
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
    // Only consume the stashed action once we actually have a session — otherwise
    // keep it, so returning to the tab and re-checking (below) can still replay it.
    if (!pendingAction || !card || !card.viewer) return;
    var a = pendingAction;
    pendingAction = null;
    act(a.path, a.flag);
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
    if (inDemo) return demoBounce();
    var text = ui.input.value.trim();
    if (!text) return toggleTray();
    if (authed()) return postNote(text, isPrivate);
    if (!cfg.id) return signIn();
    openTab(mainUrl("/compose", { to: cfg.id, site: siteName(), body: text, from: location.href }));
  }

  // Reactions are always public AND always attributed (never anonymous).
  //  • signed in  → post in place, instantly, no redirect.
  //  • signed out → open the confirmation tab (synchronously, inside the click,
  //    so a popup blocker can't eat it). That page posts the reaction as them
  //    once they have a session — so it shows their name, never "Someone".
  function react(emoji) {
    if (inDemo) return demoBounce();
    if (busy || !cfg.id) return;
    toggleTray(false);
    if (authed()) return postReaction(emoji);
    openTab(mainUrl("/reacted", { to: cfg.id, site: siteName(), emoji: emoji, from: location.href }));
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
      if (e.status === 401) openTab(mainUrl("/compose", { to: cfg.id, site: siteName(), body: text, from: location.href }));
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
      if (e.status === 401) openTab(mainUrl("/reacted", { to: cfg.id, site: siteName(), emoji: emoji, from: location.href }));
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
    ui.react.classList.toggle("on", show);
    if (show) {
      ui.tray.classList.remove("closing");
      ui.tray.hidden = false;
    } else if (!ui.tray.hidden && !ui.tray.classList.contains("closing")) {
      // Reverse the open animation, then hide once it ends (mirrors the card's
      // .closing). The guard keeps a re-open from being hidden by a stale timer.
      var tray = ui.tray, t;
      var done = function () {
        clearTimeout(t);
        tray.removeEventListener("animationend", done);
        if (tray.classList.contains("closing")) { tray.classList.remove("closing"); tray.hidden = true; }
      };
      tray.classList.add("closing");
      t = setTimeout(done, 240); // fallback if animationend never fires (reduced motion)
      tray.addEventListener("animationend", done);
    }
  }

  function paint() {
    if (!ui) return; // headless: loaded + tracked, nothing to render
    var p = card.profile || {};
    var signedIn = !!card.viewer;
    isOwner = signedIn && card.viewer.id === cfg.id;

    paintDev(); // dev HUD reflects auth state in every view (incl. onboarding)

    // Launcher branding is shown in every state.
    if (ui.pillName) ui.pillName.textContent = p.name || p.handle || "signmysite";
    avatar(ui.pillAvatar, p);

    // The generic /w.js tag is the front door: when the site is unclaimed (no
    // profile id) or has just been claimed by the person signing in, the card
    // becomes a self-contained onboarding flow instead of a profile view.
    var onboarding = cfg.generic && (!p.id || (signedIn && card.viewer.id === p.id));
    ui.panel.classList.toggle("onboarding", onboarding);
    if (onboarding) { paintOnboard(signedIn, p); return; }

    // Always the signmysite profile — never the visitor's own personal site.
    var prof = profileUrl(p);

    ui.name.textContent = p.name || p.handle || "Someone";
    ui.name.href = prof;
    ui.name.target = "_blank";
    ui.name.rel = "noopener";
    if (ui.avatar.tagName === "A") { ui.avatar.href = prof; ui.avatar.target = "_blank"; ui.avatar.rel = "noopener"; }
    avatar(ui.avatar, p);
    // On your own widget: no point leaving a note to yourself, so hide the
    // composer and surface a small analytics row instead.
    ui.composer.hidden = isOwner;
    if (isOwner) toggleTray(false);
    ui.analytics.hidden = !isOwner;
    if (ui.visitors) ui.visitors.hidden = !isOwner;
    if (isOwner) {
      var st = card.stats || {};
      ui.anaViews.textContent = compact(st.views || 0);
      ui.anaComments.textContent = compact((card.comments && card.comments.length) || 0);
      ui.anaTime.textContent = "·"; // filled by loadAnalytics() once the figures arrive
      loadAnalytics();
    }
    // A gentle banner while previewing the signed-out view of your own widget.
    ui.status.textContent = previewGuest ? "Preview — the signed-out view" : "";
    if (ui.stats) ui.stats.hidden = !SHOW_STATS;
    if (SHOW_STATS) paintStats();
    paintActions();
    paintSocial();
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
    ui.privacy.classList.toggle("show", authed() && !isOwner && !!ui.input.value.trim());
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

  // Dev-only: drop the widget's token AND end the signmysite session/cookie, then
  // reload the card so the HUD flips to "guest" — for testing the signed-out flow.
  function signOut() {
    store(tokenKey, "");
    api("/api/logout", {}).then(load, load);
  }

  // The owner's pinned sites: their curated little webring, and the widget's
  // traversal surface. FIVE interchangeable presentations, chosen with data-pins
  // so we can feel each before committing:
  //   stack     — overlapping favicons + a count; one doorway to the full profile
  //               (pins open full-size there). Loads no thumbnails, so it's lightest.
  //   thumbs    — a vertical list of site previews (real og:image), each a doorway.
  //   ring      — a horizontal, swipeable filmstrip that peeks the next card.
  //   spotlight — one site at a time, big, with ‹ › + dots: the most literal
  //               webring "next site" navigation.
  //   list      — a typographic blogroll (favicon · name · host), no thumbnails:
  //               the most minimal, lighter even than stack.
  // Read-only here (pinning is managed from the dashboard) and deliberately clean
  // — no note bubbles — so the card stays about WHERE TO GO NEXT, not commentary.
  function paintPins() {
    if (!ui.pins) return;
    var items = (card && card.pinned) || [];
    ui.pins.textContent = "";
    ui.pins.hidden = !items.length;
    if (!items.length) return;
    var render = { stack: pinsStack, thumbs: pinsThumbs, ring: pinsRing, spotlight: pinsSpotlight, list: pinsList };
    var mode = render[cfg.pins] ? cfg.pins : "ring";
    ui.pins.className = "pins " + mode;
    render[mode](items);
  }

  // A reusable FACEPILE: a row of overlapping avatars + a label, optionally the
  // whole row a link with a trailing arrow. The generalized component behind the
  // "stack" pins view AND the social-proof rows ("Followed by …", mutuals).
  function facepile(people, label, href) {
    var row = href ? pinAnchor("facepile", href) : node("div", "facepile");
    var faces = node("span", "pin-faces");
    people.slice(0, 5).forEach(function (p) { var f = node("span", "pin-face"); avatar(f, p); faces.append(f); });
    row.append(faces, node("span", "facepile-label", label));
    if (href) row.append(pinArrow());
    return row;
  }

  // stack: identity-first and lightest — the facepile of pinned-site favicons + a
  // count, the whole row a single doorway to the profile (pins show full-size there).
  function pinsStack(items) {
    var p = card.profile || {};
    var owner = firstName(p.name || p.handle || "");
    var n = items.length, s = n === 1 ? "" : "s";
    ui.pins.append(facepile(items, owner ? n + " site" + s + " " + owner + " loves" : n + " pinned site" + s, profileUrl(p)));
  }

  // Social proof: who notable follows this site ("Followed by …"), leading with the
  // signed-in viewer's mutuals when there are any. Only on someone else's card (the
  // owner gets analytics). The server ranks fame (manual prominence flag, then page
  // views), so the recognizable faces lead. Unlike the pins stack, this row is NOT a
  // single link — each avatar and name links to that person (see socialProof).
  function paintSocial() {
    if (!ui.social) return;
    ui.social.textContent = "";
    if (!card || isOwner) { ui.social.hidden = true; return; }
    var fb = card.followedBy || { faces: [], total: 0 };
    var mu = card.mutuals || { faces: [], total: 0 };
    // Lead with the viewer's mutuals ("people you follow") when there are any,
    // otherwise the notable "Followed by" pile. The count is the full follower
    // total, so it reads "Followed by <names> and N more".
    var faces = (mu.faces && mu.faces.length) ? mu.faces : (fb.faces || []);
    if (!faces.length) { ui.social.hidden = true; return; }
    ui.social.append(socialProof(faces, fb.total || faces.length));
    ui.social.hidden = false;
  }

  // "Followed by <name>, <name> and N more". No whole-row link or hover background:
  // each avatar and each name is its OWN link to that person, so the row reads as a
  // sentence and spans the full card width. Names underline on hover. In demo mode
  // the global click handler bounces these like any other signmysite link.
  function socialProof(faces, total) {
    var row = node("div", "social-proof");
    var pile = node("span", "sp-faces");
    faces.slice(0, 3).forEach(function (p) { var a = personLink("sp-face", p); avatar(a, p); pile.append(a); });
    var label = node("span", "sp-label");
    label.append(document.createTextNode("Followed by "));
    var named = faces.slice(0, 2);
    named.forEach(function (p, i) {
      if (i) label.append(document.createTextNode(", "));
      label.append(personLink("sp-name", p, p.name || p.handle || "Someone"));
    });
    var rest = Math.max(0, (total || named.length) - named.length);
    if (rest) label.append(document.createTextNode(" and " + compact(rest) + " more"));
    row.append(pile, label);
    return row;
  }
  // A new-tab link to one person's signmysite profile (each face + each name).
  function personLink(cls, p, text) {
    var a = pinAnchor(cls, profileUrl(p));
    if (text != null) a.textContent = text;
    return a;
  }

  // thumbs: a vertical stack of site previews, each a labeled doorway straight to
  // that site.
  function pinsThumbs(items) {
    items.forEach(function (it) {
      var a = pinAnchor("pin-thumb", pinHref(it));
      var foot = node("span", "pin-thumb-foot");
      var fav = node("span", "pin-fav"); avatar(fav, it);
      var meta = node("span", "pin-thumb-meta");
      meta.append(node("span", "pin-thumb-name", it.name || it.handle || "Site"));
      meta.append(node("span", "pin-thumb-host", it.url ? hostOf(it.url) : "@" + (it.handle || "")));
      foot.append(fav, meta, pinArrow());
      a.append(pinShot(it, "pin-shot"), foot);
      ui.pins.append(a);
    });
  }

  // The heading above the pinned-site views. One place to adjust the section copy.
  function pinnedLabel() {
    var n = ((card && card.pinned) || []).length;
    return "Pinned site" + (n === 1 ? "" : "s");
  }

  // ring: a horizontal filmstrip you swipe through; the rail scroll-snaps and
  // peeks the next site, inviting the next hop.
  function pinsRing(items) {
    ui.pins.append(node("div", "pin-head", pinnedLabel()));
    var frame = node("div", "pin-frame");
    var rail = node("div", "pin-rail");
    items.forEach(function (it) {
      var a = pinAnchor("ring-card", pinHref(it));
      var cap = node("span", "ring-cap");
      var fav = node("span", "pin-fav"); avatar(fav, it);
      cap.append(fav, node("span", "ring-name", it.name || it.handle || "Site"));
      a.append(pinShot(it, "ring-shot"), cap);
      rail.append(a);
    });
    // Minimal scroll arrows: only the right one shows at the start; the left fades
    // in once you've scrolled, and each fades out at its end of the rail.
    var prev = railArrow("ring-prev", "chevron-left", "Previous");
    var next = railArrow("ring-next", "chevron-right", "Next");
    prev.onclick = function () { rail.scrollBy({ left: -165, behavior: "smooth" }); };
    next.onclick = function () { rail.scrollBy({ left: 165, behavior: "smooth" }); };
    var sync = function () {
      prev.classList.toggle("on", rail.scrollLeft > 2);
      next.classList.toggle("on", rail.scrollLeft + rail.clientWidth < rail.scrollWidth - 2);
    };
    rail.addEventListener("scroll", sync, { passive: true });
    // Re-sync when the rail (re)gains layout — chiefly when the card opens from its
    // closed default, where it first measured zero width and so hid the right arrow.
    if (window.ResizeObserver) new ResizeObserver(sync).observe(rail);
    frame.append(rail, prev, next);
    ui.pins.append(frame);
    sync(); // reflect the initial position (start ⇒ only the right arrow)
  }
  function railArrow(cls, name, label) {
    var b = node("button", "ring-arrow " + cls);
    b.type = "button";
    b.innerHTML = icon(name); // a real chevron, centered (SVG has no text baseline)
    b.setAttribute("aria-label", label);
    return b;
  }

  // spotlight: one site at a time, big — the deliberate "next site" doorway, with
  // ‹ › and dots to flip through. The most literal webring navigation; the card
  // itself opens whichever site is showing.
  function pinsSpotlight(items) {
    var i = 0;
    var a = pinAnchor("spot-card", pinHref(items[0]));
    var shot = pinShot(items[0], "spot-shot");
    var cap = node("span", "spot-cap");
    var fav = node("span", "pin-fav");
    var meta = node("span", "spot-meta");
    var name = node("span", "spot-name");
    var host = node("span", "spot-host");
    meta.append(name, host);
    cap.append(fav, meta, pinArrow());
    a.append(shot, cap);
    var nav = node("div", "spot-nav");
    var prev = navBtn("‹", "Previous site");
    var dots = node("span", "spot-dots");
    var next = navBtn("›", "Next site");
    var dotEls = items.map(function (_, k) {
      var d = node("button", "spot-dot"); d.type = "button";
      d.setAttribute("aria-label", "Site " + (k + 1));
      d.onclick = function () { show(k); };
      dots.append(d); return d;
    });
    nav.append(prev, dots, next);
    ui.pins.append(a, nav);
    prev.onclick = function () { show(i - 1); };
    next.onclick = function () { show(i + 1); };
    show(0);
    // Swap the single card to site k (wrapping), and light its dot.
    function show(k) {
      i = (k + items.length) % items.length;
      var it = items[i];
      a.href = pinHref(it);
      shot.src = it.thumbnail || PIN_PLACEHOLDER;
      avatar(fav, it);
      name.textContent = it.name || it.handle || "Site";
      host.textContent = it.url ? hostOf(it.url) : "@" + (it.handle || "");
      dotEls.forEach(function (d, idx) { d.classList.toggle("on", idx === i); });
    }
  }
  function navBtn(glyph, label) { var b = node("button", "spot-btn", glyph); b.type = "button"; b.setAttribute("aria-label", label); return b; }

  // list: a typographic blogroll — favicon, name, host, no thumbnails. The
  // lightest + most minimal option (loads no preview images at all), echoing the
  // classic personal-site links page that webrings grew out of.
  function pinsList(items) {
    var owner = firstName((card.profile || {}).name || "");
    ui.pins.append(node("div", "pin-list-head", owner ? owner + "’s blogroll" : "Blogroll"));
    items.forEach(function (it) {
      var a = pinAnchor("pin-row", pinHref(it));
      var fav = node("span", "pin-fav"); avatar(fav, it);
      a.append(fav, node("span", "pin-row-name", it.name || it.handle || "Site"),
        node("span", "pin-row-host", it.url ? hostOf(it.url) : "@" + (it.handle || "")), pinArrow());
      ui.pins.append(a);
    });
  }

  // A site preview image: real og:image when present, else a neutral placeholder.
  // An <img loading="lazy"> so offscreen ring cards don't fetch until scrolled to,
  // keeping the card light on first paint.
  function pinShot(it, cls) {
    var img = node("img", cls);
    img.loading = "lazy"; img.alt = "";
    img.src = it.thumbnail || PIN_PLACEHOLDER;
    return img;
  }
  function pinArrow() { return badge("pin-go", icon("arrow-up-right")); }
  function pinHref(p) { return p.url || profileUrl(p); }
  // Every pin opens in a NEW TAB — the widget lives on someone else's page.
  function pinAnchor(cls, href) { var a = node("a", cls); a.href = href; a.target = "_blank"; a.rel = "noopener"; return a; }
  function hostOf(u) { try { return new URL(u).host.replace(/^www\./, ""); } catch (_) { return u || ""; } }

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

  // Owner-only: pull the relational analytics (real avg engaged time + the signmysite
  // members who've read you) and paint them. One extra request, and ONLY ever on
  // your own widget — a visitor's load path never touches this.
  function loadAnalytics() {
    api("/api/analytics").then(function (a) {
      if (!a) return;
      ui.anaTime.textContent = fmtDuration(a.avgDurationMs);
      paintVisitors(a.recent || []);
    }).catch(function () { ui.anaTime.textContent = "–"; });
  }

  // The relational payoff, right in the widget: a row of the signmysite members who've
  // visited you, each a doorway to their profile, with a nudge toward the ones you
  // don't follow back yet. Hidden when no signed-in member has visited.
  function paintVisitors(list) {
    if (!ui.visitors) return;
    ui.visitorFaces.textContent = "";
    ui.visitors.hidden = !list.length;
    if (!list.length) return;
    list.slice(0, 6).forEach(function (v) {
      var a = node("a", "vface" + (v.viewerFollows ? "" : " vnew"));
      a.href = profileUrl(v);
      a.target = "_blank";
      a.rel = "noopener";
      a.title = (v.name || v.handle || "Someone") + (v.viewerFollows ? "" : " · you don’t follow back");
      avatar(a, v);
      ui.visitorFaces.append(a);
    });
  }

  // ms → "45s" / "1m 12s" / "–" (nothing measured yet). Mirrors the dashboard.
  function fmtDuration(ms) {
    if (!ms || ms < 1000) return "–";
    var s = Math.round(ms / 1000);
    if (s < 60) return s + "s";
    var m = Math.floor(s / 60);
    s = s % 60;
    return m + "m" + (s ? " " + s + "s" : "");
  }

  // Suppress the "Unfollow"-on-hover state for one hover cycle right after a
  // click, so a button followed under a resting cursor doesn't snap to red —
  // it stays "Following" until the pointer leaves and comes back.
  function armFollowGuard() {
    ui.follow.classList.add("just");
    ui.follow.addEventListener("mouseleave", function off() {
      ui.follow.classList.remove("just");
      ui.follow.removeEventListener("mouseleave", off);
    });
  }

  // Follow + save button state. Save just fills its bookmark in when saved;
  // follow reads "Following" with a tick — both change instantly on click.
  function paintActions() {
    // Your own widget: Follow → Edit profile, Save ribbon → Preview (eye).
    if (isOwner) {
      ui.follow.classList.remove("on", "just");
      ui.follow.innerHTML = "Edit profile";
      ui.save.classList.remove("on");
      ui.save.innerHTML = icon("eye");
      ui.save.setAttribute("aria-label", "Preview as a guest");
      return;
    }
    var s = (card && card.stats) || {};
    var following = !!s.viewerFollows;
    ui.follow.classList.toggle("on", following);
    // When following, the label lives in .lbl so hover can swap it for "Unfollow".
    ui.follow.innerHTML = following ? '<span class="lbl">Following</span>' : "Follow";
    // The bookmark glyph is rendered once in the card markup; saving just fills it
    // (.save.on svg{fill}) — no icon swap, no unsave state.
    ui.save.innerHTML = icon("bookmark");
    ui.save.classList.toggle("on", !!s.viewerSaved);
    ui.save.setAttribute("aria-label", s.viewerSaved ? "Saved" : "Save this site");
  }

  function paintNotes() {
    ui.notes.textContent = "";
    var all = card.comments || [];
    var items = all.slice(-3).reverse();
    paintCount();
    if (ui.notesHead) ui.notesHead.hidden = !items.length;
    if (!items.length) {
      var empty = node("div", "notes-empty");
      empty.append(badge("notes-empty-ic", icon("message")), node("p", "", "No comments yet"));
      ui.notes.append(empty);
      return;
    }
    items.forEach(function (n) { ui.notes.append(note(n)); });
  }

  function paintCount() {
    if (ui.count) {
      var n = (card && card.comments && card.comments.length) || 0;
      ui.count.hidden = !n; // a small presence dot now — no number
    }
  }

  function note(n) {
    var a = n.redacted ? {} : n.author || {};
    var anon = !n.redacted && !(a.name || a.handle || a.avatar);
    var reaction = !n.redacted && isReaction(n.body) ? n.body.trim() : "";
    // The viewer's own note/reaction reads "You …", never their own name in the
    // third person. Authors carry an id; the signed-in viewer is card.viewer.
    var mine = !n.redacted && !!card.viewer && !!a.id && a.id === card.viewer.id;
    // The whole row links to this comment on the owner's signmysite profile (new tab),
    // where it floats to the top of the comment section and highlights. A redacted
    // private note you can't see, or an owner with no handle yet, stays inert.
    var prof = card.profile || {};
    var link = !n.redacted && !!n.id && !!prof.handle;
    var row = node(link ? "a" : "div", "note" + (link ? " note-link" : ""));
    if (link) {
      row.href = profileUrl(prof) + "#comment-" + enc(n.id);
      row.target = "_blank";
      row.rel = "noopener";
      row.setAttribute("aria-label", "See this comment on " + (prof.name || prof.handle || "signmysite"));
    }
    var av = node("span", "note-av" + (n.redacted || anon ? " private-av" : ""));
    var copy = node("div", "note-copy");
    var line = node("div", "note-line");

    if (n.redacted || anon) av.innerHTML = SILHOUETTE; // clean placeholder, no "?"
    else avatar(av, a);

    // Activity-feed line: bold name, dimmer verb, then a gray timestamp. The name
    // is plain text now — the row itself is the link.
    line.append(node("b", "", n.redacted ? "Someone" : (mine ? "You" : (a.name || a.handle || "Someone"))));
    if (n.redacted) line.append(node("span", "act", " left a private comment"));
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
    if (link) row.append(badge("note-go", icon("arrow-up-right"))); // fades in on hover
    return row;
  }

  // The /w.js onboarding view. Two states share one layout:
  //  • signed out → explain signmysite, with a button that opens the auth popup. Sign-in
  //    IS sign-up here (a new Google/email account is created on the spot), so a
  //    visitor goes from "never heard of signmysite" to a live account without leaving.
  //  • signed in  → success + the permanent /w/<id>.js tag to copy, so the owner
  //    (or their agent) can swap the generic line for their stable one.
  function paintOnboard(signedIn, p) {
    toggleTray(false);
    toggleHelp(false); // collapse the troubleshooting panel on every (re)paint
    ui.obHelpLink.href = cfg.api + "/#/troubleshoot";
    // A big confetti mark heads both onboarding states (welcome + success).
    ui.obMark.classList.add("emoji");
    ui.obMark.textContent = "🎉";
    if (signedIn) {
      // Success: the permanent tag to copy, and one friendly link out. No
      // troubleshooting/log-out clutter on the happy path.
      ui.obTitle.textContent = "You're in" + (p.name ? ", " + firstName(p.name) : "");
      ui.obBody.textContent = "Paste this line on your site to finish — it replaces the generic tag and keeps your followers attached even if your domain changes.";
      ui.obCode.textContent = tagLine(card.script);
      ui.obTag.hidden = false;
      ui.obCta.hidden = true;
      ui.obAlt.innerHTML = icon("external") + "<span>See your profile</span>";
      ui.obAlt.onclick = function () { openTab(cfg.api + "/"); };
      ui.obAlt.hidden = false;
      ui.obFoot.hidden = true;
    } else {
      ui.obTitle.textContent = "Welcome to signmysite";
      ui.obBody.textContent = "signmysite connects personal sites into one network — followers, comments, and a profile that's yours. This widget is now live here. Create your account to claim this site.";
      ui.obCta.textContent = "Create your account";
      ui.obCta.onclick = signIn;
      ui.obCta.hidden = false;
      ui.obAlt.textContent = "I already have an account";
      ui.obAlt.onclick = signIn;
      ui.obAlt.hidden = false;
      ui.obTag.hidden = true;
      ui.obFoot.hidden = false; // troubleshooting stays available pre-signup
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
  // Split "script" so the string is inert even if the widget is ever inlined. The
  // bare tag renders the visible card by default, so the copy box hands it back as-is.
  function tagLine(src) { return '<scr' + 'ipt src="' + (src || cfg.api + "/w/you.js") + '"></scr' + 'ipt>'; }
  function firstName(n) { return String(n).trim().split(/\s+/)[0]; }

  // "Not working?" disclosure in the onboarding footer: expand/collapse the
  // troubleshooting steps. Passing a boolean forces a state.
  function toggleHelp(on) {
    if (!ui.obHelpPanel) return;
    var show = on === undefined ? ui.obHelpPanel.hidden : on;
    ui.obHelpPanel.hidden = !show;
    ui.obHelp.setAttribute("aria-expanded", String(show));
  }

  function paintSend() {
    var has = !!ui.input.value.trim();
    ui.send.classList.toggle("ready", has);
    // Once you're writing a note, the emoji button steps aside.
    ui.react.hidden = has;
  }

  function restoreDraft() {
    ui.input.value = store(draftKey) || "";
    paintSend();
    paintPrivacy();
  }

  function signIn() {
    if (inDemo) return demoBounce();
    // "_blank", never a persistent window name: on mobile the auth tab often can't
    // close itself, and a named target would just re-aim that stale background tab —
    // so a second tap looked like it did nothing. A fresh tab each time always shows.
    window.open(cfg.api + "/auth?popup=1&return=" + encodeURIComponent(location.href), "_blank", "width=420,height=560");
  }

  // The display name we hand the compose / confirmation pages, so they can greet
  // the visitor with whose site they're writing on before the card even loads.
  function siteName() {
    return (card && card.profile && (card.profile.name || card.profile.handle)) || document.title || "this site";
  }
  // A deep link into the main signmysite app (a hash route — the SPA reads the query
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
  // The demo's "navigate back to the site": the card's links and actions point at
  // signmysite profiles/routes that have no real record behind them in the demo, so
  // rather than open a broken page we simply dismiss the card — returning the visitor to
  // the page they're on. Used by every action guard + the internal-link interceptor.
  function demoBounce() { toggleTray(false); open(false); }
  // Owner preview: reopen THIS page with ?signmysite_preview=1 so the widget renders the
  // signed-out, guest version (see previewGuest). New tab, current session intact.
  function openPreview() {
    try {
      var u = new URL(location.href);
      u.searchParams.set("signmysite_preview", "1");
      openTab(u.toString());
    } catch (_) { openTab(location.href); }
  }
  function fail() {
    if (!ui) return; // headless: nowhere to surface an error
    ui.status.textContent = "Couldn’t load signmysite.";
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
    return '<div class="signmysite ' + c.position + ' ' + c.theme + ' launcher-' + c.launcher + '">' +
      '<section class="card" role="dialog" aria-label="signmysite profile card">' +
        '<header class="top">' +
          '<a class="avatar" aria-label="View profile"></a>' +
          '<div class="actions">' +
            '<button class="save" aria-label="Save this site">' + icon("bookmark") + '</button>' +
            '<button class="follow">Follow</button>' +
          '</div>' +
        '</header>' +
        '<a class="name"></a>' +
        // Social proof: "Followed by …" + the viewer's mutuals (facepiles, visitors
        // only). See paintSocial().
        '<div class="social"></div>' +
        // The owner's pinned sites (their webring) — the traversal surface. One of
        // five presentations renders in here; see paintPins().
        '<div class="pins"></div>' +
        '<nav class="stats">' + stat("views", "Views") + stat("followers", "Followers") + '</nav>' +
        // Creator analytics — shown only on your own widget (see paint()).
        '<div class="analytics" hidden>' +
          '<div class="metric"><b class="ana-views">–</b><span>Views</span></div>' +
          '<div class="metric"><b class="ana-comments">–</b><span>Comments</span></div>' +
          '<div class="metric"><b class="ana-time">–</b><span>Avg. time</span></div>' +
        '</div>' +
        // Relational analytics: who from signmysite has actually read you (owner-only).
        '<div class="visitors" hidden><div class="visitors-faces"></div></div>' +
        '<div class="notes-head" hidden>Comments</div>' +
        '<div class="notes"></div><div class="status"></div>' +
        '<div class="tray" role="group" aria-label="Send a reaction" hidden></div>' +
        '<div class="composer">' +
          '<input class="input" aria-label="Leave a comment" placeholder="Leave a comment…">' +
          '<button class="react" aria-label="React with an emoji">' + icon("smile-plus") + '</button>' +
          '<button class="send" aria-label="Write a comment">' + icon("arrow-up") + '</button>' +
        '</div>' +
        '<label class="privacy">' +
          '<input type="checkbox" class="priv-check">' +
          '<span class="priv-text">Send this privately</span>' +
        '</label>' +
        '<div class="onboard">' +
          // Filled with a 🎉 emoji at paint time (see paintOnboard); never a brand
          // logo. Starts empty so no wordmark flashes before the script runs.
          '<div class="ob-mark"></div>' +
          '<h2 class="ob-title"></h2>' +
          '<p class="ob-body"></p>' +
          '<div class="ob-tag" hidden><code class="ob-code"></code><button class="ob-copy">Copy</button></div>' +
          '<button class="ob-cta"></button>' +
          '<button class="ob-alt" hidden></button>' +
          '<div class="ob-foot">' +
            '<button class="ob-help" type="button" aria-expanded="false">Not working?</button>' +
          '</div>' +
          '<div class="ob-help-panel" hidden>' +
            '<ol class="ob-steps">' +
              '<li>Hard-refresh this page — ⌘⇧R (Mac) or Ctrl-Shift-R. A cached older widget is the usual cause.</li>' +
              '<li>Check the tag sits just before &lt;/body&gt; and the page fully reloaded.</li>' +
              '<li>Just signed in? Give it a moment — this card updates itself.</li>' +
            '</ol>' +
            '<a class="ob-help-link" target="_blank" rel="noopener">Open the troubleshooting guide →</a>' +
          '</div>' +
        '</div>' +
        '<div class="dev" hidden><span class="dev-tag">DEV</span><span class="dev-state"></span><button class="dev-out" type="button" hidden>Sign out</button></div>' +
      "</section>" + launcher(c.launcher) + "</div>";
  }
  function launcher(kind) {
    var avatar = '<span class="pill-avatar"></span>';
    var name = '<span class="pill-name">signmysite</span>';
    var star = '<span class="logo">✦</span>';
    // The launcher shows the site owner's avatar (and name), never a brand logo —
    // the wordmark lives only in the app's top-left. The "mark" variant uses a
    // neutral glyph, not the brand. Older logo/slab configs degrade to the avatar.
    var inner = {
      avatar: avatar,
      circle: avatar,
      logo: avatar,
      mark: star,
      glass: avatar + name,
      neon: avatar + name,
      halo: avatar,
      slab: avatar + name,
      pill: avatar + name,
    }[kind] || avatar + name;
    // The circle lives inside a larger, stable hit target (.launch). Only the inner
    // .launcher scales on hover, so the clickable area never shifts out from under
    // the cursor — a tap near the edge always opens the card.
    return '<button class="launch" aria-label="Toggle signmysite card" aria-expanded="false">' +
      '<span class="launcher">' + inner + '<span class="notif" hidden></span></span></button>';
  }
  function stat(key, label) {
    return '<a class="' + key + '-link stat"><b class="' + key + '">–</b><span>' + label + "</span></a>";
  }
  function map(root) {
    var q = function (s) { return root.querySelector(s); };
    return {
      wrap: q(".signmysite"), panel: q(".card"), open: q(".launch"), avatar: q(".avatar"), pillAvatar: q(".pill-avatar"),
      pillName: q(".pill-name"), count: q(".notif"), save: q(".save"), follow: q(".follow"), name: q(".name"),
      social: q(".social"), pins: q(".pins"), notesHead: q(".notes-head"), notes: q(".notes"), status: q(".status"), input: q(".input"),
      composer: q(".composer"), react: q(".react"), send: q(".send"), tray: q(".tray"),
      privacy: q(".privacy"), privCheck: q(".priv-check"),
      stats: q(".stats"), views: q(".views"), followers: q(".followers"),
      viewsLink: q(".views-link"), followersLink: q(".followers-link"),
      analytics: q(".analytics"), anaViews: q(".ana-views"), anaComments: q(".ana-comments"), anaTime: q(".ana-time"),
      visitors: q(".visitors"), visitorFaces: q(".visitors-faces"),
      onboard: q(".onboard"), obMark: q(".ob-mark"), obTitle: q(".ob-title"), obBody: q(".ob-body"),
      obCta: q(".ob-cta"), obAlt: q(".ob-alt"), obTag: q(".ob-tag"),
      obCode: q(".ob-code"), obCopy: q(".ob-copy"),
      obFoot: q(".ob-foot"), obHelp: q(".ob-help"),
      obHelpPanel: q(".ob-help-panel"), obHelpLink: q(".ob-help-link"),
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
      eye: '<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.94 10.94 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.94 10.94 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/>',
      "arrow-up-right": '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
      "chevron-left": '<path d="m15 18-6-6 6-6"/>',
      "chevron-right": '<path d="m9 18 6-6-6-6"/>',
      external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6"/>',
      message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
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
      // Brand tokens (--accent, --accent-ink, --ink, --muted, --line, --bg) are injected
      // into :host from the one source, server/theme.ts (see server/index.ts). The
      // widget keeps only its own semantics here: the font var, the soft fill, shadow.
      ':host{all:initial}.signmysite,.signmysite *{box-sizing:border-box}' +
      '.signmysite{position:fixed;z-index:2147483000;display:flex;flex-direction:column;align-items:flex-end;gap:14px;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;--ff:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;--vgap:26px;--soft:#f3f3f1;--shadow:0 24px 80px rgba(0,0,0,.16)}' +
      '.signmysite button{font-family:inherit;-webkit-tap-highlight-color:transparent;cursor:pointer;border:0}' +
      '.signmysite svg{width:1em;height:1em;display:block}' +
      '.dark{--bg:#161616;--ink:#f6f6f2;--muted:#9a9a9a;--soft:#242424;--line:#2e2e2e;--shadow:0 24px 80px rgba(0,0,0,.5)}' +
      '.bottom-right{right:max(16px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom))}' +
      '.bottom-left{left:max(16px,env(safe-area-inset-left));bottom:max(16px,env(safe-area-inset-bottom));align-items:flex-start}' +
      '.top-right{right:max(16px,env(safe-area-inset-right));top:max(16px,env(safe-area-inset-top));flex-direction:column-reverse}' +
      '.top-left{left:max(16px,env(safe-area-inset-left));top:max(16px,env(safe-area-inset-top));flex-direction:column-reverse;align-items:flex-start}' +
      '.card{width:416px;max-width:calc(100vw - 32px);max-height:calc(100dvh - 120px);overflow:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:30px;box-shadow:var(--shadow);padding:26px 24px}' +
      '.signmysite:not(.open):not(.closing) .card{display:none}.open .card{animation:smsPop .2s cubic-bezier(.2,.7,.3,1)}.closing .card{animation:smsPopOut .17s cubic-bezier(.4,0,.7,.3) forwards;pointer-events:none}@keyframes smsPop{from{opacity:0;transform:translateY(10px) scale(.97)}}@keyframes smsPopOut{to{opacity:0;transform:translateY(10px) scale(.97)}}' +
      '.top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}' +
      '.avatar{width:92px;height:92px;border-radius:50%;background:#e5e7eb center/cover no-repeat;display:grid;place-items:center;color:#111;font:600 32px/1 var(--ff);flex:0 0 auto;text-decoration:none;cursor:pointer}' +
      '.actions{display:flex;align-items:center;gap:10px}' +
      '.save{width:46px;height:46px;border-radius:50%;background:var(--soft);color:var(--ink);font-size:21px;display:grid;place-items:center}.save:hover{background:var(--line)}' +
      // Saved = the same bookmark, simply filled in. No icon swap, no unsave state.
      '.save.on svg{fill:currentColor}' +
      // Follow stays monochrome ink (black in light, the inverse in dark), not the brand accent.
      '.follow{display:inline-flex;align-items:center;justify-content:center;gap:7px;height:46px;padding:0 22px;border-radius:999px;background:var(--ink);color:var(--bg);font:600 17px/1 var(--ff)}.follow:hover{opacity:.9}' +
      // Following = quiet outline; hover reveals the destructive "Unfollow" in red.
      // .just suppresses that for one hover cycle after the click (set in armFollowGuard).
      // Following: stack the "Following" label and the "Unfollow" pseudo in one grid
      // cell so the button is as wide as the longer word — the hover swap never resizes it.
      '.follow.on{background:transparent;color:var(--ink);border:1px solid var(--line);display:inline-grid;place-items:center}.follow.on .lbl,.follow.on::after{grid-area:1/1}.follow.on::after{content:"Unfollow";visibility:hidden}.follow.on:not(.just):hover{background:rgba(229,72,77,.12);color:#e5484d;border-color:rgba(229,72,77,.5);opacity:1}.follow.on:not(.just):hover .lbl{visibility:hidden}.follow.on:not(.just):hover::after{visibility:visible}' +
      '.name{display:inline-block;margin:14px 0 var(--vgap);color:var(--ink);font:600 28px/1.15 var(--ff);letter-spacing:-.02em;text-decoration:none}.name:hover{text-decoration:underline;text-underline-offset:4px}' +
      '.stats{display:flex;flex-wrap:wrap;gap:8px 22px;margin:16px 0 26px}.stats[hidden]{display:none}.stat{color:var(--muted);text-decoration:none;font-size:16px;font-weight:600}.stat b{color:var(--ink);font-weight:600;margin-right:5px}.stat:hover span{text-decoration:underline;text-underline-offset:3px}' +
      // Creator analytics: a clean 3-up row, hairline dividers between metrics.
      '.analytics{display:flex;margin:2px 0 16px}.analytics[hidden]{display:none}' +
      '.metric{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center}.metric+.metric{border-left:1px solid var(--line)}' +
      '.metric b{color:var(--ink);font:600 22px/1 var(--ff);letter-spacing:-.01em}.metric span{color:var(--muted);font:400 12px/1 var(--ff)}' +
      // Relational analytics: overlapping faces of the signmysite members who read you, with
      // an accent ring on the ones you don\'t follow back (the "follow them" nudge).
      '.visitors{margin:0 0 24px}.visitors[hidden]{display:none}' +
      '.visitors-faces{display:flex;align-items:center;padding-left:2px}' +
      '.vface{width:34px;height:34px;border-radius:50%;margin-right:-8px;border:2px solid var(--bg);background:#e5e7eb center/cover no-repeat;display:grid;place-items:center;color:#111;font:600 13px/1 var(--ff);text-decoration:none;transition:transform .12s ease}' +
      '.vface:hover{transform:translateY(-2px)}.vface.vnew{border-color:var(--accent)}' +
      // Pins — the curated webring. Three presentations share the .pins box and a
      // mode class (stack | thumbs | ring); see paintPins(). Shared bits first:
      '.pins[hidden]{display:none}' +
      '.pin-go{flex:0 0 auto;display:grid;place-items:center;color:var(--muted);font-size:15px}' +
      '.pin-fav{width:20px;height:20px;flex:0 0 auto;border-radius:6px;background:#fff center/cover no-repeat;border:1px solid var(--line);display:grid;place-items:center;color:#111;font:600 9px/1 var(--ff)}' +
      // stack: one rounded row — overlapping favicons + a count → the full profile.
      // facepile — the shared overlapping-avatars pill (stack pins + social proof).
      // grid-template-columns:minmax(0,1fr) lets the facepile shrink so its label
      // truncates instead of overflowing (grid items default to min-width:auto).
      // Consistent vertical rhythm between card sections (name · social · pins ·
      // comments) — one --vgap token; mode rules below carry NO margin of their own.
      '.pins{margin:0 0 var(--vgap)}.social{display:grid;grid-template-columns:minmax(0,1fr);gap:9px;margin:0 0 var(--vgap)}.social[hidden]{display:none}' +
      // No resting outline — borderless by default; the rounded pill shape appears
      // only on hover (border-radius is kept so that hover background is rounded).
      '.facepile{display:flex;align-items:center;gap:12px;padding:8px 14px 8px 10px;border-radius:999px;color:var(--ink);text-decoration:none}.facepile:hover{background:var(--soft)}' +
      '.pin-faces{display:flex;align-items:center;flex:0 0 auto}' +
      '.pin-face{width:30px;height:30px;border-radius:50%;margin-right:-10px;border:2px solid var(--bg);background:#fff center/cover no-repeat;display:grid;place-items:center;color:#111;font:600 12px/1 var(--ff)}.pin-face:last-child{margin-right:0}' +
      '.facepile-label{flex:1;min-width:0;font:600 14px/1.25 var(--ff);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      // Social proof row: full-width (no padding), no whole-row hover/link. Each
      // avatar (.sp-face) and name (.sp-name) is its own link to that person.
      '.social-proof{display:flex;align-items:center;gap:12px}' +
      '.sp-faces{display:flex;align-items:center;flex:0 0 auto}' +
      '.sp-face{width:30px;height:30px;border-radius:50%;margin-right:-10px;border:2px solid var(--bg);background:#fff center/cover no-repeat;display:grid;place-items:center;color:#111;font:600 12px/1 var(--ff);text-decoration:none}.sp-face:last-child{margin-right:0}' +
      '.sp-label{flex:1;min-width:0;font:600 14px/1.25 var(--ff);color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.sp-name{color:inherit;text-decoration:none}.sp-name:hover{text-decoration:underline}' +
      // thumbs: a vertical list of site previews, each a doorway.
      '.pins.thumbs{display:grid;gap:12px}' +
      '.pin-thumb{display:block;color:var(--ink);text-decoration:none;border:1px solid var(--line);border-radius:16px;overflow:hidden;background:var(--bg);transition:box-shadow .15s ease,transform .15s ease}.pin-thumb:hover{box-shadow:0 12px 30px rgba(0,0,0,.10);transform:translateY(-2px)}' +
      '.pin-shot{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;background:var(--soft)}' +
      '.pin-thumb-foot{display:flex;align-items:center;gap:10px;padding:10px 12px}' +
      '.pin-thumb-meta{display:flex;flex-direction:column;min-width:0}' +
      '.pin-thumb-name{font:600 14px/1.3 var(--ff);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.pin-thumb-host{font:500 12px/1.35 var(--ff);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.pin-thumb .pin-go{margin-left:auto;opacity:0;transition:opacity .15s ease}.pin-thumb:hover .pin-go{opacity:1}' +
      // ring: a horizontal filmstrip; the rail snaps and peeks the next card.
      '.pin-head,.notes-head{margin:0 0 11px;font:600 13px/1 var(--ff);color:var(--muted)}' +
      '.pin-rail{display:flex;gap:10px;overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;padding-bottom:4px;scrollbar-width:none}.pin-rail::-webkit-scrollbar{display:none}' +
      '.ring-card{flex:0 0 auto;width:150px;scroll-snap-align:start;color:var(--ink);text-decoration:none}' +
      '.ring-shot{display:block;width:150px;height:95px;object-fit:cover;border-radius:14px;border:1px solid var(--line);background:var(--soft);transition:box-shadow .15s ease}.ring-card:hover .ring-shot{box-shadow:0 10px 24px rgba(0,0,0,.14)}' +
      '.ring-cap{display:flex;align-items:center;gap:7px;margin-top:8px}' +
      '.ring-name{font:600 13px/1.25 var(--ff);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      // Floating circular prev/next over the thumbnails. Hidden until the strip is
      // hovered, then only the relevant ones show: .on is toggled by sync() in
      // pinsRing (right arrow at the start, left arrow once you have scrolled).
      // top:31px ≈ (ring-shot 95 − arrow 32) / 2 — vertically centered on the thumbnail.
      '.pin-frame{position:relative}' +
      '.ring-arrow{position:absolute;top:31px;z-index:2;display:grid;place-items:center;width:32px;height:32px;padding:0;border-radius:50%;background:var(--bg);color:var(--ink);border:1px solid var(--line);box-shadow:0 6px 18px rgba(0,0,0,.16);font:400 18px/1 var(--ff);opacity:0;transform:scale(.8);pointer-events:none;transition:opacity .15s ease,transform .15s ease}' +
      '.ring-prev{left:-2px}.ring-next{right:-2px}' +
      '.pin-frame:hover .ring-arrow.on{opacity:1;transform:scale(1);pointer-events:auto}' +
      '.ring-arrow:hover{background:var(--soft)}' +
      // spotlight: one big card + a ‹ • • • › navigator; flip through one at a time.
      '.spot-card{display:block;color:var(--ink);text-decoration:none}' +
      '.spot-shot{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:16px;border:1px solid var(--line);background:var(--soft)}' +
      '.spot-cap{display:flex;align-items:center;gap:9px;margin:11px 2px 0}' +
      '.spot-meta{display:flex;flex-direction:column;min-width:0;flex:1}' +
      '.spot-name{font:600 14px/1.25 var(--ff);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.spot-host{font:500 12px/1.3 var(--ff);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.spot-cap .pin-go{opacity:0;transition:opacity .15s ease}.spot-card:hover .pin-go{opacity:1}' +
      '.spot-nav{display:flex;align-items:center;justify-content:center;gap:14px;margin-top:13px}' +
      '.spot-btn{width:34px;height:34px;border-radius:50%;background:var(--soft);color:var(--ink);font:400 20px/1 var(--ff);display:grid;place-items:center;border:1px solid var(--line)}.spot-btn:hover{background:var(--line)}' +
      '.spot-dots{display:flex;align-items:center;gap:7px}' +
      '.spot-dot{width:7px;height:7px;padding:0;border:0;border-radius:50%;background:var(--line);cursor:pointer;transition:background .15s ease,transform .15s ease}.spot-dot.on{background:var(--accent);transform:scale(1.25)}' +
      // list: a typographic blogroll — favicon · name · host, hairline dividers.
      '.pin-list-head{margin:0 0 2px;font:600 13px/1 var(--ff);color:var(--muted)}' +
      '.pin-row{display:flex;align-items:center;gap:11px;padding:12px 4px;border-top:1px solid var(--line);color:var(--ink);text-decoration:none}.pin-row:hover{background:var(--soft)}' +
      '.pin-row-name{flex:0 1 auto;font:600 15px/1.3 var(--ff);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.pin-row-host{flex:1 1 auto;text-align:right;font:500 13px/1.3 var(--ff);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.pin-row .pin-go{opacity:0;transition:opacity .15s ease}.pin-row:hover .pin-go{opacity:1}' +
      '.notes{display:grid;gap:22px}.note{display:flex;align-items:center;gap:14px}' +
      'a.note-link{position:relative;text-decoration:none;color:inherit;margin:-6px -10px;padding:6px 10px;border-radius:12px;transition:background .12s ease}a.note-link:hover{background:var(--soft)}' +
      '.note-go{flex:0 0 auto;margin-left:auto;color:var(--faint);opacity:0;font-size:16px;transition:opacity .12s ease}a.note-link:hover .note-go{opacity:1}' +
      // Empty state: a centered muted bubble icon + one quiet line.
      '.notes-empty{display:flex;flex-direction:column;align-items:center;gap:8px;padding:14px 0 6px;color:var(--muted)}.notes-empty-ic{display:grid;place-items:center;color:var(--muted);opacity:.5;font-size:26px}.notes-empty p{margin:0;font:400 14px/1 var(--ff)}' +
      '.note-av{position:relative;width:42px;height:42px;flex:0 0 auto;border-radius:50%;background:#e5e7eb center/cover no-repeat;display:grid;place-items:center;color:#111;font:600 16px/1 var(--ff)}' +
      '.private-av{background:var(--soft);overflow:hidden}.private-av svg{width:62%;height:62%;color:#b4b4b9}' +
      '.mail-badge{position:absolute;right:-5px;bottom:-5px;width:23px;height:23px;border-radius:50%;background:var(--bg);box-shadow:0 1px 4px rgba(0,0,0,.18);display:grid;place-items:center;color:#ff2d55;font-size:13px}' +
      '.note-copy{min-width:0}.note-line{font:400 16px/1.45 var(--ff);color:var(--ink);overflow-wrap:anywhere;opacity:.9}.author,.note-line b{color:var(--ink);font-weight:600;text-decoration:none}.author:hover{text-decoration:underline}' +
      '.act{color:var(--muted)}.react-emoji{font-size:1.25em;line-height:1;vertical-align:-.12em}.note-time{margin-left:6px;color:var(--muted);font-size:14px;white-space:nowrap}' +
      // Clamp a long comment to a few lines so one note can't dominate the card —
      // the row links through to the full comment on the profile.
      '.note p{margin:3px 0 0;font-size:15px;color:var(--ink);opacity:.8;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}' +
      '.badge{margin-left:7px;border:1px solid var(--line);border-radius:999px;padding:2px 8px;font-size:11px;font-weight:600;color:var(--muted)}.empty{color:var(--muted);font-size:14px}.see-all{justify-self:start;display:inline-flex;align-items:center;gap:5px;min-height:38px;margin-top:2px;padding:0 8px;color:var(--muted);text-decoration:none;font:600 14px/1 var(--ff)}.see-all::after{content:"→"}.see-all:hover{color:var(--ink);text-decoration:none}' +
      '.status{color:var(--muted);font-size:13px;margin-top:10px;overflow-wrap:anywhere}.status:empty{display:none}' +
      '.composer{display:flex;align-items:center;gap:4px;margin-top:24px;padding:6px;border:1px solid var(--line);border-radius:999px;background:var(--bg);box-shadow:0 10px 36px rgba(0,0,0,.07);transition:box-shadow .15s ease}.composer:focus-within{box-shadow:0 0 0 3px rgba(0,0,0,.05),0 10px 36px rgba(0,0,0,.07)}.composer[hidden]{display:none}' +
      '.signmysite button:focus{outline:none}.signmysite button:focus-visible{outline:2px solid rgba(0,0,0,.18);outline-offset:2px}' +
      '.input{flex:1;min-width:0;border:0;background:transparent;color:var(--ink);font:400 16px/1 var(--ff);padding:12px 8px 12px 14px;outline:none}.input::placeholder{color:var(--muted);font-weight:400}' +
      '.react{width:40px;height:40px;border-radius:50%;background:transparent;color:var(--muted);font-size:18px;display:grid;place-items:center}.react:hover{background:var(--soft);color:var(--ink)}.react.on{background:var(--soft);color:var(--ink)}.react[hidden]{display:none}' +
      '.tray{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:4px;margin-top:14px;padding:8px;border:1px solid var(--line);border-radius:999px;background:var(--bg);box-shadow:0 10px 36px rgba(0,0,0,.07)}.tray[hidden]{display:none}.tray:not([hidden]){animation:trayUp .2s cubic-bezier(.2,.7,.3,1)}.tray.closing{animation:trayDown .17s cubic-bezier(.4,0,.7,.3) forwards;pointer-events:none}@keyframes trayUp{from{opacity:0;transform:translateY(10px)}}@keyframes trayDown{to{opacity:0;transform:translateY(10px)}}' +
      '.emoji{height:46px;border-radius:14px;background:transparent;font-size:24px;line-height:1;display:grid;place-items:center;transition:transform .12s ease,background .12s ease}.emoji:hover{background:var(--soft);transform:translateY(-2px)}.emoji:active{transform:scale(.9)}' +
      '.send{width:42px;height:42px;border-radius:50%;background:var(--soft);color:var(--muted);font-size:22px;display:grid;place-items:center;transition:background .15s ease,color .15s ease}.send.ready{background:var(--accent);color:var(--accent-ink)}.send:hover{color:var(--ink)}.send.ready:hover{color:var(--accent-ink);opacity:.9}' +
      // The private-note switch: collapsed by default, slides down (max-height +
      // fade) once a signed-in visitor starts writing.
      '.privacy{display:flex;align-items:center;gap:10px;overflow:hidden;max-height:0;opacity:0;margin-top:0;padding:0 6px 0 14px;cursor:pointer;user-select:none;font:400 13px/1.2 var(--ff);color:var(--muted);transition:max-height .22s ease,opacity .2s ease,margin-top .22s ease}' +
      '.privacy.show{max-height:44px;opacity:1;margin-top:12px}' +
      // The private toggle: a custom rounded checkbox that fills with the accent and
      // shows a crisp tick when on, in place of the native control.
      '.priv-check{appearance:none;-webkit-appearance:none;position:relative;flex:0 0 auto;width:18px;height:18px;margin:0;border:1.5px solid var(--line);border-radius:6px;background-color:var(--bg);cursor:pointer}' +
      '.priv-check:hover{border-color:var(--muted)}' +
      '.priv-check:focus-visible{outline:2px solid var(--accent);outline-offset:2px}' +
      '.priv-check:checked{background-color:var(--accent);border-color:var(--accent)}' +
      '.priv-check:checked::after{content:"";position:absolute;left:6px;top:2px;width:4px;height:9px;border:solid var(--accent-ink);border-width:0 2px 2px 0;transform:rotate(45deg)}' +
      // Dev HUD — a thin monospace footer, only present against a local API.
      '.dev{display:flex;align-items:center;gap:8px;margin-top:18px;padding-top:12px;border-top:1px dashed var(--line);font:600 11px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted)}.dev[hidden]{display:none}' +
      '.dev-tag{flex:0 0 auto;padding:2px 6px;border-radius:6px;background:var(--accent);color:var(--accent-ink);font-weight:600;letter-spacing:.04em}' +
      '.dev-state{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.dev-out{flex:0 0 auto;padding:5px 11px;border-radius:999px;background:var(--soft);color:var(--ink);border:1px solid var(--line);font:inherit;font-weight:600;cursor:pointer}.dev-out:hover{background:var(--line)}.dev-out[hidden]{display:none}' +
      // Onboarding view (the generic /w.js front door). When .onboarding is on the
      // card, the profile chrome is hidden and this self-contained flow shows.
      '.onboard{display:none;text-align:center;padding:6px 2px 2px}.card.onboarding .onboard{display:block}' +
      '.card.onboarding>.top,.card.onboarding>.name,.card.onboarding>.social,.card.onboarding>.stats,.card.onboarding>.pins,.card.onboarding>.notes-head,.card.onboarding>.notes,.card.onboarding>.status,.card.onboarding>.tray,.card.onboarding>.composer,.card.onboarding>.privacy{display:none!important}' +
      '.ob-mark{width:56px;height:56px;margin:8px auto 18px;border-radius:50%;background:var(--accent);color:var(--accent-ink);display:grid;place-items:center}' +
      '.ob-mark.emoji{background:transparent;font-size:46px;line-height:1}' +
      '.ob-title{margin:0 0 10px;font:600 22px/1.2 var(--ff);letter-spacing:-.02em;color:var(--ink)}' +
      '.ob-body{margin:0 auto 22px;max-width:34ch;font:400 15px/1.55 var(--ff);color:var(--muted)}' +
      '.ob-cta{display:block;width:100%;height:52px;border-radius:999px;background:var(--accent);color:var(--accent-ink);font:600 16px/1 var(--ff)}.ob-cta:hover{opacity:.9}.ob-cta[hidden]{display:none}' +
      '.ob-alt{display:flex;align-items:center;justify-content:center;gap:7px;width:100%;margin-top:10px;height:42px;background:transparent;color:var(--muted);font:600 14px/1 var(--ff)}.ob-alt:hover{color:var(--ink)}.ob-alt[hidden]{display:none}.ob-alt svg{width:15px;height:15px}' +
      '.ob-tag{display:flex;align-items:center;gap:8px;margin-top:18px;padding:10px 10px 10px 14px;border:1px solid var(--line);border-radius:14px;background:var(--soft);text-align:left}.ob-tag[hidden]{display:none}' +
      // The tag wraps within the box — no horizontal scrollbar.
      '.ob-code{flex:1;min-width:0;overflow-wrap:anywhere;white-space:normal;font:500 12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--ink)}' +
      '.ob-copy{flex:0 0 auto;align-self:center;height:36px;padding:0 16px;border-radius:999px;background:var(--accent);color:var(--accent-ink);font:600 13px/1 var(--ff)}.ob-copy:hover{opacity:.9}' +
      // Onboarding footer: a subtle "Not working?" toggle (pre-signup only).
      '.ob-foot{display:flex;align-items:center;justify-content:center;gap:18px;margin-top:18px}.ob-foot[hidden]{display:none}' +
      '.ob-help{background:transparent;color:var(--muted);font:600 13px/1 var(--ff);padding:4px 2px}.ob-help:hover{color:var(--ink)}' +
      '.ob-help-panel{margin-top:12px;padding:14px 16px;border:1px solid var(--line);border-radius:14px;background:var(--soft);text-align:left}.ob-help-panel[hidden]{display:none}' +
      '.ob-steps{margin:0;padding-left:20px;font:400 13px/1.55 var(--ff);color:var(--muted)}.ob-steps li{margin:0 0 7px}.ob-steps code{font:500 12px/1 ui-monospace,SFMono-Regular,Menlo,monospace}' +
      '.ob-help-link{display:inline-block;margin-top:6px;color:var(--ink);font:600 13px/1 var(--ff);text-decoration:underline;text-underline-offset:2px}' +
      // .launch is the click target: a stable box (plus a -12px invisible ::before
      // halo) that never moves, so tapping the badge always lands. The inner
      // .launcher is the visible circle, and it GROWS on hover (scale) — never shifts.
      '.launch{position:relative;display:block;margin:0;padding:0;background:transparent;cursor:pointer}.launch::before{content:"";position:absolute;inset:-12px}' +
      '.launcher{position:relative;display:flex;align-items:center;gap:9px;border:1px solid var(--line);background:rgba(255,255,255,.8);color:#050505;border-radius:999px;padding:6px 16px 6px 6px;box-shadow:0 1px 2px rgba(0,0,0,.12),0 4px 8px rgba(0,0,0,.10),0 10px 22px rgba(0,0,0,.12),0 22px 40px rgba(0,0,0,.10);font:600 14px/1 var(--ff);transition:transform .16s ease,box-shadow .16s ease}.launch:hover .launcher{transform:scale(1.05)}' +
      // No-photo fallback: a soft neutral disc + a properly sized, tight-tracked
      // initial (the circle variant bumps this to 18px). Cleaner than a flat-gray
      // chip with a too-small letter.
      '.pill-avatar{width:30px;height:30px;border-radius:50%;background:linear-gradient(180deg,#eef0f3,#e1e3e9) center/cover no-repeat;display:grid;place-items:center;color:#1b1b1f;font:600 14px/1 var(--ff);letter-spacing:-.02em;flex:0 0 auto}' +
      // A small presence dot (not a count): "there's activity here". The ring
      // matches the badge so it reads cleanly on the avatar; dark launchers swap
      // the ring to ink below.
      '.notif{position:absolute;top:3px;right:3px;width:12px;height:12px;border-radius:50%;background:#ff2d55;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.25)}.notif[hidden]{display:none}' +
      '.logo{display:grid;place-items:center;font-weight:600;letter-spacing:-.02em}' +
      '.launcher-avatar .launcher,.launcher-circle .launcher,.launcher-logo .launcher,.launcher-mark .launcher,.launcher-halo .launcher{padding:6px;width:62px;height:62px;justify-content:center}.launcher-avatar .pill-avatar,.launcher-circle .pill-avatar,.launcher-halo .pill-avatar{width:50px;height:50px}.launcher-avatar .launcher,.launcher-avatar .pill-avatar{border-radius:18px}.launcher-circle .launcher,.launcher-circle .pill-avatar,.launcher-logo .launcher,.launcher-mark .launcher,.launcher-halo .launcher,.launcher-halo .pill-avatar{border-radius:50%}.launcher-circle .launcher{width:56px;height:56px}.launcher-circle .pill-avatar{width:42px;height:42px;font-size:18px}' +
      '.launcher-logo .launcher,.launcher-mark .launcher{padding:0;background:#000;color:#fff;border-color:#000}.launcher-logo .logo{font-size:17px}.launcher-mark .logo{font-size:26px}.launcher-glass .launcher{background:rgba(255,255,255,.72);backdrop-filter:blur(18px);border-color:rgba(255,255,255,.7)}.launcher-neon .launcher{border-color:#ffd1ef;box-shadow:0 0 0 1px #ffd1ef,0 12px 44px rgba(255,45,133,.28),0 0 38px rgba(117,92,255,.18)}.launcher-halo .launcher{box-shadow:0 0 0 7px rgba(255,45,85,.08),0 20px 70px rgba(0,0,0,.18)}.launcher-slab .launcher{border-radius:18px;padding:9px 16px;background:#050505;color:#fff;border-color:#050505}.launcher-slab .logo{width:26px;height:26px;border-radius:8px;background:#fff;color:#000}.launcher-slab .notif,.launcher-logo .notif,.launcher-mark .notif{border-color:#050505}' +
      '@media(max-width:520px){.signmysite{left:max(12px,env(safe-area-inset-left))!important;right:max(12px,env(safe-area-inset-right))!important;bottom:max(12px,env(safe-area-inset-bottom))!important;top:auto!important;flex-direction:column!important}.card{width:calc(100vw - 24px);max-width:none;max-height:calc(100dvh - 110px);padding:22px 20px;border-radius:26px}.avatar{width:78px;height:78px;font-size:28px}.follow,.save{height:46px}.save{width:46px}.follow{padding:0 22px;font-size:16px}.name{font-size:34px}}' +
      "</style>";
  }

  function ready(fn) { document.body ? fn() : document.addEventListener("DOMContentLoaded", fn); }
  // The widget's member id, or null for the generic onboarding front door.
  // "you" is a reserved placeholder — the friendly install line everyone copies
  // (/w/you.js, and the bare /w.js) means "no member yet, start signup here". A
  // real tag is /w/<16-hex>.js, which returns that id.
  function idOf(s) {
    var slug = (s.getAttribute("data-id") || "").replace(/^signmysite:/, "");
    if (!slug) {
      try { var m = new URL(s.src).pathname.match(/\/w\/([a-z0-9]+)(?:\.js)?$/i); slug = (m && m[1]) || ""; } catch (_) {}
    }
    slug = slug.toLowerCase();
    return slug && slug !== "you" ? "signmysite:" + slug : null;
  }
  function enc(s) { return encodeURIComponent(s); }
  function profileUrl(p) { return cfg.api + (p.handle ? "/@" + encodeURIComponent(p.handle) : "/"); }
  function store(k, v) { try { if (arguments.length > 1) return v ? localStorage.setItem(k, v) : localStorage.removeItem(k); return localStorage.getItem(k) || ""; } catch (_) { return ""; } }
  // A stable, opaque per-browser id. It anchors the duration beacon to its view and
  // lets the server count distinct visitors — never identifies anyone (the WHO comes
  // from the session/Bearer auth, not this). First-party on the host site.
  function sid() {
    var k = "signmysite_sid", s = store(k);
    if (!s) { s = Date.now().toString(36) + Math.random().toString(36).slice(2, 10); store(k, s); }
    return s;
  }
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
