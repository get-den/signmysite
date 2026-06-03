/*
 * Fetch a site and pull out a preview image + a content hash.
 *
 * Today the preview is the page's own og:image (or twitter:image / favicon) —
 * free, no rendering, no storage. Later this is the seam where a headless
 * screenshot worker would slot in: same return shape, just a different source.
 */
import { createHash } from "node:crypto";

export type SitePreview = { thumbnail: string | null; hash: string };

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

// Inspect a site: grab a preview image and a hash of its main content.
export async function inspectSite(url: string): Promise<SitePreview | null> {
  const html = await fetchHtml(url);
  if (html == null) return null;

  const img =
    meta(html, "og:image") ||
    meta(html, "twitter:image") ||
    meta(html, "twitter:image:src");
  const thumbnail = img ? absolutize(img, url) : null;

  // Hash the <body> if we can isolate it, else the whole doc — stable enough to
  // detect real edits while ignoring tiny dynamic noise in the <head>.
  const bodyMatch = html.match(/<body[\s\S]*<\/body>/i);
  const basis = bodyMatch ? bodyMatch[0] : html;
  const hash = createHash("sha256").update(basis).digest("hex");

  return { thumbnail, hash };
}
