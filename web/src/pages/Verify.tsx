import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { verifySite } from "../api";
import { useToast, useViewer } from "../providers";
import { Button, useCopy } from "../ui";
import { host } from "../lib";

/**
 * Dead-simple "add the widget" page. Shows the one-line script tag with a big
 * copy button, says where it goes, then checks the live site. Reached from the
 * dashboard's unverified nudge ("Verify").
 */
export function Verify() {
  const { viewer, setViewer } = useViewer();
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const tag = viewer ? `<script src="${location.origin}/w/${viewer.id.replace(/^den:/, "")}.js"></script>` : "";
  const { copied, copy } = useCopy(tag);
  if (!viewer) return null; // wrapped in <Protected>

  const verify = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await verifySite();
      if (r.verified) {
        setViewer({ ...viewer, verified: true });
        toast("Verified ✓");
        navigate("/");
      } else {
        toast("Not found yet. Make sure the line is published, then try again.");
      }
    } catch {
      toast("Couldn't verify. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="narrow verify-page">
      <h1>Add Den to your site</h1>
      <p className="verify-lead">
        Copy this one line and paste it into {viewer.url ? <b>{host(viewer.url)}</b> : "your site"}, then publish.
        It works on any site builder, drop it anywhere in your HTML or your builder's embed box.
      </p>

      <div className="snippet verify-snippet">{tag}</div>
      <Button className="pink lg verify-copy" onClick={copy}>{copied ? "Copied" : "Copy the line"}</Button>

      <p className="verify-foot">Added it and published? We'll check your live site and claim it.</p>
      <Button className="lg" loading={busy} onClick={verify}>Verify my site</Button>
    </div>
  );
}
