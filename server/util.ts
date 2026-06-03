import { randomBytes, randomInt } from "node:crypto";

export const now = (): string => new Date().toISOString();

// A permanent member id: "den:" + 16 hex chars. Satisfies ^den:[a-z0-9]{8,}$.
export function newId(): string {
  return "den:" + randomBytes(8).toString("hex");
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

export function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string
  );
}
