/*
 * The single source of truth for where signmysite is hosted.
 *
 * BASE_URL is the ONE knob that names our public origin. Set it in prod
 * (e.g. https://signmysite.com); it defaults to http://localhost:$PORT in dev. Every
 * absolute URL the server emits — email links, the widget script tag, the OAuth
 * redirect URI, server-rendered profile pages — derives from BASE, so moving to
 * a new domain is a one-line env change with nothing hardcoded to chase.
 *
 * Shipped static text (widget.js, llms.txt, skill.md, the platform guides under
 * docs/) can't read env, so it carries the ORIGIN_SENTINEL placeholder instead
 * and is rewritten to BASE at serve time — see rewriteOrigin() in meta.ts. The
 * browser SPA is same-origin and reads location.origin directly. Between those
 * three, no file ever names the live domain literally.
 */

export const PORT = Number(process.env.PORT || 8787);

// Public origin, normalized without a trailing slash. Whether it's https here
// also drives session-cookie security (SameSite=None; Secure) — see app.ts.
export const BASE = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
