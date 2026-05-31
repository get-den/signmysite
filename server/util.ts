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

export function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string
  );
}
