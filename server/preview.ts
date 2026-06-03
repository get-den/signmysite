/*
 * Fetch a site and pull out a preview image + a content hash.
 *
 * Today the preview is the page's own og:image (or twitter:image / favicon) —
 * free, no rendering, no storage. Later this is the seam where a headless
 * screenshot worker would slot in: same return shape, just a different source.
 */
import { createHash } from "node:crypto";

export type SitePreview = {
  thumbnail: string | null;
  avatar: string | null;   // best-guess profile picture (icon → favicon)
  hash: string;
  title: string | null;
  excerpt: string | null;
};

// Fetch a URL with a timeout; returns the HTML (capped) or null.
async function fetchHtml(url: string, ms = 6000): Promise<string | null> {
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), ms);
    const r = await fetch(url, { signal: ac.signal, redirect: "follow" });
    clearTimeout(timer);
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    // Cap at 512KB — we only need the <head> for meta tags.
    return new TextDecoder().decode(buf.slice(0, 512 * 1024));
  } catch {
    return null;
  }
}

function meta(html: string, prop: string): string | null {
  // matches <meta property="og:image" content="..."> in either attribute order
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']` +
    `|<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`,
    "i"
  );
  const m = html.match(re);
  return m ? (m[1] || m[2] || null) : null;
}

function absolutize(src: string, base: string): string {
  try { return new URL(src, base).toString(); } catch { return src; }
}

// Strip the volatile bits before hashing so a rotating CSRF token, a per-request
// nonce, an inline analytics blob, or changing whitespace doesn't read as a "new
// version". What survives is the structural text of the page — a real edit moves
// it, routine churn doesn't.
function normalizeForHash(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")   // inline JS (analytics, hydration state)
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")     // inline CSS
    .replace(/<!--[\s\S]*?-->/g, "")                       // comments (build ids, etc.)
    .replace(/\s(?:nonce|integrity|data-nonce|data-csrf|csrf-token)=["'][^"']*["']/gi, "")
    .replace(/<meta[^>]+(?:csrf|nonce)[^>]*>/gi, "")       // <meta name="csrf-token" ...>
    .replace(/\s+/g, " ")                                   // collapse whitespace
    .trim();
}

// The page's human title and a short description, captured per version so the
// history timeline reads as more than a list of hashes.
function pageTitle(html: string): string | null {
  const og = meta(html, "og:title");
  if (og) return og;
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
}

// Best-guess profile picture for a site: a real square icon if one is declared
// (apple-touch-icon wins, then the largest rel="icon", skipping monochrome
// mask-icons), else the host's favicon via Google's resolver — which always
// returns *something* crisp at 128px.
export function inferAvatar(html: string, url: string): string {
  const attr = (tag: string, name: string) =>
    tag.match(new RegExp(`\\b${name}=["']([^"']+)["']`, "i"))?.[1] || "";
  let best: { href: string; score: number } | null = null;
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const rel = attr(tag, "rel").toLowerCase();
    const href = attr(tag, "href");
    if (!href) continue;
    let score: number;
    if (/\bapple-touch-icon\b/.test(rel)) score = 100;
    else if (/\bicon\b/.test(rel) && !/mask-icon/.test(rel)) score = 40;
    else continue;
    score += Math.min(parseInt(attr(tag, "sizes")) || 0, 512) / 10; // prefer bigger
    if (!best || score > best.score) best = { href, score };
  }
  if (best) return absolutize(best.href, url);
  let host = url;
  try { host = new URL(url).host; } catch { /* keep raw */ }
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`;
}

// Does this site embed the given member's widget id? That's our proof of
// ownership — only someone who controls the page could have pasted their own id.
export async function siteHasWidget(url: string, idShort: string): Promise<boolean> {
  const html = await fetchHtml(url);
  return !!html && !!idShort && html.includes(idShort);
}

// Inspect a site: grab a preview image, a normalized content hash, and the
// title/description for this version.
export async function inspectSite(url: string): Promise<SitePreview | null> {
  const html = await fetchHtml(url);
  if (html == null) return null;

  const img =
    meta(html, "og:image") ||
    meta(html, "twitter:image") ||
    meta(html, "twitter:image:src");
  const thumbnail = img ? absolutize(img, url) : null;
  const avatar = inferAvatar(html, url);

  // Hash the <body> if we can isolate it, else the whole doc — normalized so we
  // only react to real edits, not the head's dynamic noise.
  const bodyMatch = html.match(/<body[\s\S]*<\/body>/i);
  const basis = normalizeForHash(bodyMatch ? bodyMatch[0] : html);
  const hash = createHash("sha256").update(basis).digest("hex");

  const title = pageTitle(html)?.slice(0, 200) ?? null;
  const excerpt = (meta(html, "og:description") || meta(html, "description"))?.slice(0, 300) ?? null;

  return { thumbnail, avatar, hash, title, excerpt };
}
