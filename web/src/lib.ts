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
