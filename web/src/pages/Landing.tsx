import { GoogleIcon } from "../ui";
import { signinUrl } from "../lib";

export function Landing() {
  return (
    <>
      <div className="hero">
        <h1>Your corner of the internet — connected.</h1>
        <p>
          Den links personal websites into one social graph you can follow, save, and explore. Keep
          your own site. Add one line. Be discoverable.
        </p>
        <a className="google" href={signinUrl()}>
          <GoogleIcon />
          Continue with Google
        </a>
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
