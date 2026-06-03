import { useState, type FormEvent } from "react";
import { GoogleIcon } from "../ui";
import { signinUrl } from "../lib";
import { requestMagicLink } from "../api";
import { useToast } from "../providers";

export function Landing() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ devLink?: string } | null>(null);
  const toast = useToast();

  async function emailLink(e: FormEvent) {
    e.preventDefault();
    const addr = email.trim();
    if (!addr || busy) return;
    setBusy(true);
    try {
      const r = await requestMagicLink(addr, location.href);
      setSent({ devLink: r.dev_link });
    } catch {
      toast("Couldn't send the link — check the address and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="hero">
        <h1>Your corner of the internet — connected.</h1>
        <p>
          Den links personal websites into one social graph you can follow, save, and explore. Keep
          your own site. Add one line. Be discoverable.
        </p>

        <div className="signin">
          <a className="google" href={signinUrl()}>
            <GoogleIcon />
            Continue with Google
          </a>
          <div className="signin-or"><span>or</span></div>
          {sent ? (
            <div className="signin-sent">
              <b>Check your email</b> for a sign-in link.
              {sent.devLink && <> <a href={sent.devLink}>Continue →</a></>}
            </div>
          ) : (
            <form className="signin-email" onSubmit={emailLink}>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                aria-label="Email address"
                required
              />
              <button className="btn primary" type="submit" disabled={busy}>
                {busy ? "Sending…" : "Email me a link"}
              </button>
            </form>
          )}
          <p className="signin-fine">No passwords, no keys — just Google or a one-time email link.</p>
        </div>
      </div>
      <div className="section">
        <h2>How it works</h2>
        <div className="note">
          Sign in, then paste one line into your site (any platform). A small badge appears so
          visitors can follow you — and you show up in everyone's graph.
        </div>
      </div>
    </>
  );
}
