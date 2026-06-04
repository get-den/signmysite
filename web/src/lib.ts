/* Small pure helpers, framework-free. */

/** 1234 → "1.2K", 1_500_000 → "1.5M". */
export function compact(n: number | null | undefined): string {
  const v = Number(n) || 0;
  if (v < 1000) return String(v);
  if (v < 1e6) return (v / 1e3).toFixed(v < 1e4 ? 1 : 0).replace(/\.0$/, "") + "K";
  return (v / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
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
 * Where an avatar + name links: the member's Den profile (/@handle) if we know
 * their handle, else their linked site, else nowhere. One source of truth so
 * every identity chip points to the same place.
 */
export const profileHref = (of: { handle?: string | null; url?: string | null }): string =>
  of.handle ? `/@${of.handle}` : of.url || "#";

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
// wireframe of a webpage, inlined as a data URI — no network request, nothing to
// keep on disk. Sized to the canonical og:image ratio (1200×630) so it drops into
// the same box as a real preview. Deliberately generic so a real og:image stands
// out beside it.
const PLACEHOLDER_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">` +
  `<rect width="1200" height="630" fill="#f3f3f4"/>` +
  `<rect x="220" y="115" width="760" height="400" rx="24" fill="#fff" stroke="#e6e6e9" stroke-width="2"/>` +
  `<circle cx="256" cy="149" r="7" fill="#dcdce0"/><circle cx="282" cy="149" r="7" fill="#dcdce0"/><circle cx="308" cy="149" r="7" fill="#dcdce0"/>` +
  `<line x1="220" y1="183" x2="980" y2="183" stroke="#ededf0" stroke-width="2"/>` +
  `<rect x="260" y="220" width="680" height="170" rx="16" fill="#e9e9ec"/>` +
  `<rect x="260" y="420" width="680" height="18" rx="9" fill="#e9e9ec"/>` +
  `<rect x="260" y="452" width="430" height="18" rx="9" fill="#e9e9ec"/>` +
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
  return "#/auth?return=" + encodeURIComponent(to);
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
