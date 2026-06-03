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

// Placeholder site thumbnails (in /site/thumbnails) to cycle through when a site
// has no real preview image. Kept in sync with server/profile.ts.
const PLACEHOLDER_THUMBS = ["andrew", "ilayda", "james", "justin"].map((n) => `/site/thumbnails/${n}.png`);

/**
 * The thumbnail a site card shows: its real one, else a placeholder picked
 * stably from the site id (same site → same placeholder, no flicker).
 */
export function siteThumb(site: { id: string; thumbnail?: string | null }): string {
  if (site.thumbnail) return site.thumbnail;
  let h = 0;
  const id = site.id || "";
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) >>> 0;
  return PLACEHOLDER_THUMBS[h % PLACEHOLDER_THUMBS.length];
}

/** The Google OAuth start URL, returning to the current page (the Landing CTA). */
export function signinUrl(): string {
  return "/api/auth/google?return=" + encodeURIComponent(location.href);
}

/** The combined sign-in page (Google + email magic link), returning here after. */
export function authUrl(): string {
  return "/auth?return=" + encodeURIComponent(location.href);
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
