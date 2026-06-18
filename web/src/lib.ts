/* Small pure helpers, framework-free. */

/** 1234 → "1.2K", 1_500_000 → "1.5M". */
export function compact(n: number | null | undefined): string {
  const v = Number(n) || 0;
  if (v < 1000) return String(v);
  if (v < 1e6) return (v / 1e3).toFixed(v < 1e4 ? 1 : 0).replace(/\.0$/, "") + "K";
  return (v / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
}

/** Human view duration, matching the widget's fmtDuration exactly: "–" for none /
 *  sub-second, "45s", "2m", "2m 30s". Keep in sync with widget.js. */
export function fmtDuration(ms: number | null | undefined): string {
  if (!ms || ms < 1000) return "–";
  const total = Math.round(ms / 1000);
  if (total < 60) return total + "s";
  const m = Math.floor(total / 60), s = total % 60;
  return m + "m" + (s ? " " + s + "s" : "");
}

/** First letter for avatar fallback. */
export function initials(s: string | null | undefined): string {
  return (s || "?").trim().charAt(0).toUpperCase() || "?";
}

/** Hostname of a URL, or the raw string if it doesn't parse. */
export function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Where an avatar + name links: the member's signmysite profile (/@handle) if we know
 * their handle, else their linked site, else nowhere. One source of truth so
 * every identity chip points to the same place.
 */
export const profileHref = (of: { handle?: string | null; url?: string | null }): string =>
  of.handle ? `/@${of.handle}` : of.url || "#";

/**
 * The router path to a member's profile — /@<handle>, the one profile URL (shareable
 * AND in-app; the feed shell renders it). Null when we have no handle to route to
 * (the caller then falls back to their external site). See <IdentityLink>.
 */
export const profilePath = (of: { handle?: string | null }): string | null =>
  of.handle ? `/@${of.handle}` : null;

/**
 * Where your OWN "Profile" links point: your shareable /@<handle>, falling back to
 * /profile only until you've claimed a handle. So every in-app route to your own
 * profile is a URL you can copy and send — never the un-shareable /profile.
 */
export const ownProfilePath = (viewer: { handle?: string | null } | null | undefined): string =>
  profilePath(viewer ?? {}) ?? "/profile";

/**
 * A HashRouter-era route (the part after #) → today's path: "#/u/justin" → "/@justin",
 * "#/edit" → "/edit". Old emails and bookmarks keep these alive; main.tsx translates
 * them at boot, Auth.tsx when they ride in as ?return= targets.
 */
export function legacyHashPath(hash: string): string {
  const p = hash.slice(1); // drop "#"
  const u = p.match(/^\/u\/([^/?#]+)(.*)$/);
  return u ? `/@${u[1]}${u[2]}` : p;
}

/** Compact relative time for note feeds: now, 5m, 15h, 2d, 3w, 4mo, 1y. */
export function relTime(s: string | null | undefined): string {
  const t = Date.parse(s || "");
  if (!t) return "";
  const d = Date.now() - t, m = 6e4, h = 36e5, day = 864e5;
  if (d < m) return "now";
  if (d < h) return Math.floor(d / m) + "m";
  if (d < day) return Math.floor(d / h) + "h";
  if (d < 7 * day) return Math.floor(d / day) + "d";
  if (d < 30 * day) return Math.floor(d / (7 * day)) + "w";
  if (d < 365 * day) return Math.floor(d / (30 * day)) + "mo";
  return Math.floor(d / (365 * day)) + "y";
}

/** True when a note body is just emoji — render it as a "reacted with …" line. */
export function isReaction(s: string | null | undefined): boolean {
  const v = (s || "").trim();
  if (!v) return false;
  try {
    if (Array.from(v).length > 4) return false;
    return /^(?:\p{Extended_Pictographic}|️|‍|[\u{1F3FB}-\u{1F3FF}])+$/u.test(v);
  } catch {
    return v.length <= 4 && /^[^\w\s.,!?'"()\-]+$/.test(v);
  }
}

// Shown when a site has no real preview image (og:image): a flat, neutral
// flat grayscale wireframe of a webpage, inlined as a data URI — no network
// request, nothing to keep on disk. One canonical placeholder, no variants and no
// text. Sized to the canonical og:image ratio (1200×630) so it drops into the same
// box as a real preview, and deliberately plain so a real og:image stands out.
const PLACEHOLDER_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">` +
  `<rect width="1200" height="630" fill="#f3f3f4"/>` +
  `<rect x="220" y="140" width="760" height="350" rx="20" fill="#ffffff"/>` +
  `<rect x="270" y="190" width="660" height="170" rx="14" fill="#ececef"/>` +
  `<rect x="270" y="392" width="660" height="20" rx="10" fill="#ececef"/>` +
  `<rect x="270" y="430" width="420" height="20" rx="10" fill="#ececef"/>` +
  `</svg>`;
/** Canonical fallback preview, used anywhere a site has no real thumbnail. */
export const PLACEHOLDER_THUMB = `data:image/svg+xml;utf8,${encodeURIComponent(PLACEHOLDER_SVG)}`;

/** The thumbnail a site card shows: its real preview (og:image), else the canonical placeholder. */
export function siteThumb(site: { thumbnail?: string | null }): string {
  return site.thumbnail || PLACEHOLDER_THUMB;
}

/** The Google OAuth start URL, returning to `to` after (default: this page). */
export function signinUrl(to: string = location.href): string {
  return "/api/auth/google?return=" + encodeURIComponent(to);
}

/** The in-app sign-in page (Google + email magic link), returning to `to` after. */
export function authUrl(to: string = location.href): string {
  return "/auth?return=" + encodeURIComponent(to);
}

/* ---- usernames + websites (the onboarding funnel) ----------------------- */

/** Back-compat: older landing pages stashed a pasted site here before auth. */
export const JOIN_SITE_KEY = "signmysite:join-site";

/** Username typed before auth; onboarding claims it server-side once signed in. */
export const SIGNUP_HANDLE_KEY = "signmysite:signup-handle";

const HANDLE_MAX = 30;

/** Normalize text into a handle, mirroring the server so what you see is what you get. */
export function normHandle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, HANDLE_MAX);
}

// Live, exhaustive validation for a pasted website — runs as you type, so the
// button never has to be the thing that tells you it's wrong.
export type SiteCheck = { ok: boolean; url?: string; error?: string };
export function validateSite(raw: string): SiteCheck {
  const trimmed = (raw || "").trim();
  if (!trimmed) return { ok: false }; // empty: not an error, just not ready
  if (/\s/.test(trimmed)) return { ok: false, error: "Web addresses can't contain spaces." };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : "https://" + trimmed;
  let u: URL;
  try { u = new URL(withScheme); } catch { return { ok: false, error: "That doesn't look like a web address." }; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, error: "Only http and https sites work." };
  const hostname = u.hostname.toLowerCase();
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname.endsWith(".local"))
    return { ok: false, error: "Use your site's public address, not localhost." };
  if (!hostname.includes(".")) return { ok: false, error: "Enter a full domain, like yoursite.com." };
  if (!/^[a-z0-9.-]+$/.test(hostname) || hostname.includes("..") || hostname.startsWith(".") || hostname.endsWith(".") || hostname.startsWith("-"))
    return { ok: false, error: "That domain doesn't look right." };
  const tld = hostname.split(".").pop() || "";
  if (!/^[a-z]{2,}$/.test(tld)) return { ok: false, error: "That domain doesn't look right." };
  return { ok: true, url: u.toString() };
}

// Multi-label public suffixes we recognize, so the SLD of jane.co.uk reads "jane".
const MULTI_SUFFIX = new Set([
  "co.uk", "org.uk", "me.uk", "ac.uk", "gov.uk",
  "com.au", "net.au", "org.au", "co.nz", "co.jp", "co.kr", "co.in", "co.za",
  "com.br", "com.mx", "com.ar", "com.tr", "com.sg", "com.hk", "com.tw",
]);

// Platforms where the member is the leftmost subdomain (jane.substack.com → jane).
const SUBDOMAIN_HOSTS = [
  "substack.com", "github.io", "gitlab.io", "medium.com", "wordpress.com",
  "blogspot.com", "tumblr.com", "bearblog.dev", "mataroa.blog", "notion.site",
  "super.site", "webflow.io", "framer.website", "framer.app", "bandcamp.com",
  "gumroad.com", "myshopify.com", "netlify.app", "vercel.app", "pages.dev",
  "web.app", "firebaseapp.com", "neocities.org", "carrd.co", "weebly.com",
  "wixsite.com", "square.site", "ghost.io", "hashnode.dev", "bsky.social",
  "micro.blog", "glitch.me", "surge.sh", "replit.app", "itch.io", "gitbook.io",
  "telegra.ph", "beehiiv.com",
];

// Platforms where the member lives in the URL path; map host → segments → handle.
const atName = (s?: string) => (s && s.startsWith("@") ? s.slice(1) : undefined);
const PATH_HOSTS: Record<string, (segs: string[]) => string | undefined> = {
  "github.com": (s) => s[0],
  "gitlab.com": (s) => s[0],
  "twitter.com": (s) => s[0],
  "x.com": (s) => s[0],
  "instagram.com": (s) => s[0],
  "facebook.com": (s) => s[0],
  "threads.net": (s) => atName(s[0]) || s[0],
  "threads.com": (s) => atName(s[0]) || s[0],
  "medium.com": (s) => atName(s[0]),
  "substack.com": (s) => atName(s[0]),
  "youtube.com": (s) => atName(s[0]),
  "tiktok.com": (s) => atName(s[0]),
  "linktr.ee": (s) => s[0],
  "about.me": (s) => s[0],
  "patreon.com": (s) => s[0],
  "ko-fi.com": (s) => s[0],
  "buymeacoffee.com": (s) => s[0],
  "behance.net": (s) => s[0],
  "dribbble.com": (s) => s[0],
  "soundcloud.com": (s) => s[0],
  "mastodon.social": (s) => atName(s[0]),
  "linkedin.com": (s) => (s[0] === "in" || s[0] === "company" ? s[1] : undefined),
  "bsky.app": (s) => (s[0] === "profile" ? s[1]?.split(".")[0] : undefined),
};

function publicSuffix(labels: string[]): string {
  if (labels.length >= 2 && MULTI_SUFFIX.has(labels.slice(-2).join("."))) return labels.slice(-2).join(".");
  return labels[labels.length - 1] || "";
}

/**
 * Best guess at a username from a personal website. Three shapes, tried in order:
 *   subdomain platform — jane.substack.com, jane.github.io        → "jane"
 *   path platform      — github.com/jane, medium.com/@jane        → "jane"
 *   their own domain   — janedoe.com, blog.jane.co.uk             → "janedoe" / "jane"
 * Returns "" when there's nothing usable (e.g. a bare platform root).
 */
export function handleFromSite(raw: string): string {
  const v = (raw || "").trim().toLowerCase();
  if (!v) return "";
  let u: URL;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(v) ? v : "https://" + v); } catch { return ""; }
  const hostname = u.hostname.replace(/^www\./, "");
  const segs = u.pathname.split("/").filter(Boolean);

  // 1) Member is the leftmost label under a known platform (jane.substack.com).
  for (const p of SUBDOMAIN_HOSTS) {
    if (hostname.endsWith("." + p)) return normHandle(hostname.slice(0, -(p.length + 1)).split(".")[0]);
  }
  // 2) Member is in the path of a known platform (github.com/jane). Don't fall
  //    through to the domain rule — a platform's own SLD is never the member.
  if (hostname in PATH_HOSTS) return normHandle(PATH_HOSTS[hostname](segs) || "");
  // 3) Their own domain: the label just left of the public suffix.
  const labels = hostname.split(".");
  const sufLen = publicSuffix(labels).split(".").length;
  return normHandle(labels[labels.length - sufLen - 1] || "");
}

/* ---- social links ------------------------------------------------------- */

/** A user-typed social link, normalized to a clean http(s) URL — or null if junk. */
export function normalizeLink(raw: string): string | null {
  const t = (raw || "").trim();
  if (!t) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : "https://" + t;
  let u: URL;
  try { u = new URL(withScheme); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (!u.hostname.includes(".")) return null;
  return u.toString();
}

// A friendly label for a social link; unknown hosts fall back to the bare host.
// (Mirror of the server copy in server/profile.ts — keep the two lists in sync.)
const SOCIALS: Array<[string, string]> = [
  ["instagram.com", "Instagram"], ["x.com", "X"], ["twitter.com", "X"],
  ["linkedin.com", "LinkedIn"], ["github.com", "GitHub"], ["youtube.com", "YouTube"],
  ["tiktok.com", "TikTok"], ["facebook.com", "Facebook"], ["threads.net", "Threads"],
  ["threads.com", "Threads"], ["bsky.app", "Bluesky"], ["mastodon.social", "Mastodon"],
  ["substack.com", "Substack"], ["medium.com", "Medium"], ["twitch.tv", "Twitch"],
  ["dribbble.com", "Dribbble"], ["behance.net", "Behance"], ["soundcloud.com", "SoundCloud"],
  ["spotify.com", "Spotify"], ["bandcamp.com", "Bandcamp"], ["t.me", "Telegram"],
  ["reddit.com", "Reddit"], ["pinterest.com", "Pinterest"], ["patreon.com", "Patreon"],
  ["ko-fi.com", "Ko-fi"], ["goodreads.com", "Goodreads"], ["letterboxd.com", "Letterboxd"],
];
/** Display name for a social link (e.g. "Instagram"); bare host for anything else. */
export function socialLabel(url: string): string {
  let h: string;
  try { h = new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return url; }
  for (const [d, label] of SOCIALS) if (h === d || h.endsWith("." + d)) return label;
  return h;
}

/**
 * Crop + shrink an image file to a centered square of `size`px, re-encoded as
 * WebP. Re-encoding through a canvas drops EXIF and any embedded SVG/script, so
 * what we upload is plain raster bytes — small (~10–20KB) and safe.
 */
export async function squareImage(file: File, size = 256): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas 2d context");
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/webp", 0.85),
  );
}

/* ---- reactions ----------------------------------------------------------- */

/** The canonical emoji reaction set — mirrors the widget's REACTIONS so a tap means
 *  the same thing in a DM, a note, and the widget. Extend here to grow the tray. */
export const REACTIONS = ["❤️", "🔥", "😂", "👏", "🎉", "✨", "👀", "🙌"];
