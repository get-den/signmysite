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

/** Where "Sign in" sends the browser: Google OAuth, returning to the current page. */
export function signinUrl(): string {
  return "/api/auth/google?return=" + encodeURIComponent(location.href);
}
