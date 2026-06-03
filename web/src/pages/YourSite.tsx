import { Link } from "react-router-dom";
import { useToast, useViewer } from "../providers";
import { Avatar } from "../ui";
import { host } from "../lib";

/** Your site: how your profile looks, the one-line widget, and quick edits. */
export function YourSite() {
  const { viewer } = useViewer();
  const toast = useToast();
  if (!viewer) return null;

  const idShort = viewer.id.replace(/^den:/, "");
  const tag = `<script src="${location.origin}/w/${idShort}.js"></script>`;
  const copy = () => navigator.clipboard.writeText(tag).then(() => toast("Copied"));

  return (
    <>
      <div className="phead">
        <Avatar of={viewer} />
        <div>
          <div className="pname">{viewer.name || "You"}</div>
          <div className="phandle">@{viewer.handle || ""}</div>
          {viewer.url && (
            <div className="purl">
              <a href={viewer.url} target="_blank" rel="noopener">
                {host(viewer.url)}
              </a>
            </div>
          )}
        </div>
      </div>

      {viewer.bio && <p className="pbio">{viewer.bio}</p>}

      <div className="row">
        <Link className="btn" to="/edit">
          Edit profile
        </Link>
        {viewer.handle && (
          <a className="btn" href={`/@${viewer.handle}`} target="_blank" rel="noopener">
            View public page ↗
          </a>
        )}
      </div>

      <div className="section">
        <h2>Your widget</h2>
        <p className="muted-p">
          Paste this one line into your site — footer, header, any HTML block. Works on Squarespace,
          WordPress, Wix, Jekyll, Lovable, or hand-written HTML.
        </p>
        <div className="snippet">
          {tag}
          <button className="btn sm copy" onClick={copy}>
            Copy
          </button>
        </div>
        <div className="note" style={{ marginTop: 12 }}>
          Vibe-coding your site? Tell your AI agent: <b>“add Den — see {location.origin}/skill.md”</b>{" "}
          and it'll insert the line for you.
        </div>
      </div>
    </>
  );
}
