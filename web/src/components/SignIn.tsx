import { useState, type FormEvent } from "react";
import { Button, GoogleIcon } from "../ui";
import { signinUrl } from "../lib";
import { requestMagicLink } from "../api";
import { useToast } from "../providers";

/**
 * The one sign-in control: Continue with Google on top (the higher-conversion
 * path), an email magic link underneath. The link doubles as sign-up — a new
 * email just gets an account — so this covers both join and log in. Shown on the
 * focused /auth page. `returnTo` is where the server sends the member back once
 * they're signed in (default: wherever this is shown).
 */
export function SignIn({ returnTo = location.href }: { returnTo?: string }) {
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
      const r = await requestMagicLink(addr, returnTo);
      setSent({ devLink: r.dev_link });
    } catch {
      toast("Couldn't send the link. Check the address.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="signin">
      <a className="google" href={signinUrl(returnTo)}>
        <GoogleIcon />
        Continue with Google
      </a>
      {sent ? (
        <div className="signin-sent">
          <b>Check your email.</b> Sign-in link sent to {email.trim()}.
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
            autoComplete="email"
            required
          />
          <Button className="pink" type="submit" loading={busy}>Email me a sign-in link</Button>
        </form>
      )}
    </div>
  );
}
