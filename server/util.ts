import { randomBytes, randomInt, createHmac, timingSafeEqual } from "node:crypto";

export const now = (): string => new Date().toISOString();

// A permanent member id: "signmysite:" + 16 hex chars. Satisfies ^signmysite:[a-z0-9]{8,}$.
export function newId(): string {
  return "signmysite:" + randomBytes(8).toString("hex");
}

// Canonical-domain key for a site URL: the bare host, lowercased, without a scheme,
// a leading "www.", a path, query, or fragment. The ONE identity a pasted link reduces
// to — "https://nabeelqu.co/principles", "nabeelqu.co", and "www.nabeelqu.co/x?y" all
// key to "nabeelqu.co" — so a site has at most one row. Null for anything that isn't a
// dotted hostname. Mirrored by web/src/lib.ts domainOf so client + server agree.
export function domainKey(url: string | null | undefined): string | null {
  const raw = (url || "").trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : "https://" + raw;
  let h: string;
  try { h = new URL(withScheme).hostname; } catch { return null; }
  h = h.replace(/^www\./i, "").toLowerCase();
  return h.includes(".") ? h : null;
}

// Tolerant canonicalization of a pasted address → { url, key }, or null if it isn't a
// real public website. `url` is a clean "https://<host>" to store + link to; `key` is
// its domainKey, used for dedupe and ownership matching. Rejects localhost / IPs.
export function canonicalDomain(raw: string): { url: string; key: string } | null {
  const key = domainKey(raw);
  if (!key) return null;
  if (key === "localhost" || key.endsWith(".local") || /^\d+\.\d+\.\d+\.\d+$/.test(key)) return null;
  return { url: "https://" + key, key };
}

const ADJ = ["swift", "sunny", "brave", "clever", "tiny", "cosmic", "mellow", "zesty",
  "lucky", "fuzzy", "nimble", "quiet", "bold", "jolly", "rapid", "witty"];
const ANIMAL = ["otter", "fox", "koala", "raven", "lynx", "panda", "heron", "gecko",
  "tapir", "newt", "finch", "moth", "wren", "seal", "ibis", "crane"];

// A friendly, changeable handle, e.g. "swift-otter-a3f2".
export function newHandle(): string {
  return `${ADJ[randomInt(ADJ.length)]}-${ANIMAL[randomInt(ANIMAL.length)]}-${randomBytes(2).toString("hex")}`;
}

// An opaque, url-safe secret (session + magic-link tokens).
export function token(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

// A cohort ("crew") id: "coh_" + 16 hex. Deliberately a DIFFERENT shape from a
// member id ("signmysite:" + hex) so the two can never be confused in a route param or a
// follow edge (a cohort id won't match ^signmysite:[a-z0-9]{8,}$).
export function newCohortId(): string {
  return "coh_" + randomBytes(8).toString("hex");
}

// A short, shareable invite code for a crew link (/join/<code>). Drawn from
// lowercase letters + digits MINUS look-alikes (0/o, 1/l/i) so it's easy to read
// aloud and type on a phone. 7 chars over a 31-symbol alphabet ≈ 27 billion
// combinations — unguessable enough for an invite, short enough to share.
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0 o 1 l i
export function newInviteCode(len = 7): string {
  let s = "";
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

// Handles live in URLs (signmysite.com/@handle), so keep them lowercase, url-safe, and
// human. Normalize lossily as the user types; validate the result before saving.
export const HANDLE_MIN = 3;
export const HANDLE_MAX = 30;

export function normHandle(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // spaces / punctuation → a single hyphen
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, HANDLE_MAX);
}

// Why a normalized handle isn't usable yet (or null if it's fine).
export function handleProblem(h: string): string | null {
  if (h.length < HANDLE_MIN) return `At least ${HANDLE_MIN} characters.`;
  if (h.length > HANDLE_MAX) return `At most ${HANDLE_MAX} characters.`;
  if (!/^[a-z0-9-]+$/.test(h)) return "Letters, numbers and hyphens only.";
  return null;
}

// A short emoji-only string is a "reaction" (a tap), as opposed to a written
// note. Mirrors the widget's isReaction so the server can accept anonymous,
// always-public reactions without trusting the client's classification.
export function isReaction(s: string): boolean {
  s = (s || "").trim();
  if (!s || Array.from(s).length > 8) return false;
  try {
    return /^(?:\p{Extended_Pictographic}|️|‍|[\u{1F3FB}-\u{1F3FF}])+$/u.test(s);
  } catch {
    return /^[^\w\s.,!?'"()\-]+$/.test(s);
  }
}

// Compact relative time for note feeds: now, 5m, 15h, 2d, 3w, 4mo, 1y. Mirrors
// web/src/lib.ts so server-rendered comments read the same as the widget's notes.
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

export function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string
  );
}

// A stateless per-member token for email links (the /notify manage page), so a
// recipient can change prefs WITHOUT signing in — yet a stranger can't mute someone
// else's mail. HMAC of the id under SIGNMYSITE_SECRET; set SIGNMYSITE_SECRET in prod so links
// survive restarts (a dev default keeps local links working).
const NOTIFY_SECRET = process.env.SIGNMYSITE_SECRET || "signmysite-dev-notify-secret";
export function notifyToken(memberId: string): string {
  return createHmac("sha256", NOTIFY_SECRET).update(memberId).digest("base64url").slice(0, 22);
}
export function checkNotifyToken(memberId: string, tok: string): boolean {
  const a = Buffer.from(notifyToken(memberId));
  const b = Buffer.from(String(tok || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}
