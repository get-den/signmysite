import { useViewer, useToast } from "../providers";

export function Embed() {
  const { viewer } = useViewer();
  const toast = useToast();
  if (!viewer) return null;

  const idShort = viewer.id.replace(/^den:/, "");
  const tag = `<script src="${location.origin}/w/${idShort}.js"></script>`;

  function copy() {
    navigator.clipboard.writeText(tag).then(() => toast("Copied"));
  }

  return (
    <>
      <h2 className="section">Your widget</h2>
      <p>
        Paste this once into your site — footer, header, or any HTML block. Works on Squarespace,
        WordPress, Wix, Jekyll, Lovable, or hand-written HTML.
      </p>
      <div className="snippet">
        {tag}
        <button className="btn sm copy" onClick={copy}>
          Copy
        </button>
      </div>
      <div className="section">
        <h2>Vibe-coding your site?</h2>
        <div className="note">
          Tell your AI agent: <b>“add Den — see {location.origin}/skill.md”</b>. It'll insert the
          line for you.
        </div>
      </div>
    </>
  );
}
