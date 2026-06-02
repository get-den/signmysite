/*
 * Sign in with Google — the human-facing auth for den.com.
 *
 * Real OAuth 2.0 when GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are set.
 * When they're absent (local dev), a stub stands in that walks the identical
 * flow with a fake account — so the whole site is runnable with zero setup,
 * and flips to real Google by setting two env vars. No other code changes.
 *
 * Either path ends the same way: we have a Google profile (sub, email, name,
 * picture) → find-or-create a member → start a session → return to the app.
 */
import type { Context } from "hono";
import { setCookie } from "hono/cookie";
import * as db from "./db.ts";
import { newId, newHandle, token } from "./util.ts";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
export const GOOGLE_LIVE = !!(CLIENT_ID && CLIENT_SECRET);

type GoogleProfile = { sub: string; email?: string; name?: string; picture?: string };

// Find or create the member behind a Google profile, then session them.
// Returns the member AND the raw session token, so the popup can also hand the
// token to the widget via postMessage (first-party auth for cross-site embeds).
export async function signInWithGoogle(c: Context, p: GoogleProfile, opts: {
  cookie: string; secure: boolean;
}): Promise<{ member: db.Member; token: string }> {
  let m =
    (await db.getMemberByGoogleSub(p.sub)) ||
    (p.email ? await db.getMemberByEmail(p.email.toLowerCase()) : undefined);

  if (m) {
    // Link google_sub / backfill avatar on first Google login for an email member.
    const patch: Partial<db.Member> = {};
    if (!m.google_sub) patch.google_sub = p.sub;
    if (!m.avatar && p.picture) patch.avatar = p.picture;
    if (Object.keys(patch).length) m = (await db.updateMember(m.id, patch))!;
  } else {
    m = await db.createMember({
      id: newId(),
      handle: await uniqueHandle(),
      name: p.name || (p.email ? p.email.split("@")[0] : "New member"),
      email: p.email ? p.email.toLowerCase() : null,
      google_sub: p.sub,
      avatar: p.picture || null,
    });
  }

  const tok = await db.createSession(m.id);
  setCookie(c, opts.cookie, tok, {
    httpOnly: true, path: "/", maxAge: 60 * 60 * 24 * 30,
    sameSite: opts.secure ? "None" : "Lax", secure: opts.secure,
  });
  return { member: m, token: tok };
}

async function uniqueHandle(): Promise<string> {
  for (let i = 0; i < 6; i++) {
    const h = newHandle();
    if (!(await db.getMemberByHandle(h))) return h;
  }
  return newHandle();
}

// Build the Google consent URL we redirect the user to.
export function googleAuthUrl(redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  return "https://accounts.google.com/o/oauth2/v2/auth?" + q.toString();
}

// Exchange the auth code for tokens and decode the id_token's profile.
export async function exchangeGoogleCode(code: string, redirectUri: string): Promise<GoogleProfile> {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      redirect_uri: redirectUri, grant_type: "authorization_code",
    }),
  });
  if (!r.ok) throw new Error("token exchange failed: " + r.status);
  const tok = await r.json();
  return decodeIdToken(tok.id_token);
}

// Minimal JWT payload decode (we trust the token because it came straight from
// Google's token endpoint over TLS; no need to verify the signature here).
function decodeIdToken(jwt: string): GoogleProfile {
  const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
  return { sub: payload.sub, email: payload.email, name: payload.name, picture: payload.picture };
}

// ---- dev stub ------------------------------------------------------------
// A deterministic fake "Google account" so local dev needs no credentials.
export function stubProfile(email?: string): GoogleProfile {
  const e = (email || "you@example.com").toLowerCase();
  return { sub: "stub:" + e, email: e, name: titleCase(e.split("@")[0]), picture: "" };
}
function titleCase(s: string): string {
  return s.replace(/[._-]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

export { token };
