import { SignIn } from "../../components/SignIn";
import { Button, CheckIcon, CopyIcon, useCopy } from "../../ui";
import { ScriptTag, SCRIPT_TAG } from "./shared";

/**
 * Variant 1 — the line. Fullscreen, one artifact: the install tag itself, with a
 * pulsing Copy. The product is explained by how small the install is. Sign-in
 * sits quietly underneath.
 */
export function V1() {
  const { copied, copy } = useCopy(SCRIPT_TAG);
  return (
    <div className="lv">
      <h1>A guestbook for your website</h1>
      <p className="lv-sub">
        One line of HTML shows who's reading your site. Visitors sign it, and your
        site joins the network of personal sites.
      </p>
      <div className="lv-line-block">
        <ScriptTag />
        <Button className={"pink lg copy-prompt" + (copied ? " is-copied" : "")} onClick={copy}>
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? "Copied" : "Copy"}
        </Button>
        <p className="lv-fine">Paste it before &lt;/body&gt;. That's the whole install.</p>
      </div>
      <div className="lv-signin">
        <div className="signin-or"><span>sign up and the line becomes yours</span></div>
        <SignIn returnTo="/" />
      </div>
    </div>
  );
}
