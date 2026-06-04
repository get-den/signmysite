import { Link } from "react-router-dom";
import { useViewer } from "../providers";

/**
 * The canonical "Add to my site" call to action — the growth hook a visitor sees
 * right after reacting or commenting on someone else's widget. Self-gating: it
 * renders only for a signed-in member who hasn't linked their own site yet, so it
 * can be dropped in anywhere and simply disappears once they have one. Points at
 * /verify, the focused "paste the one-line widget on your site" page. One
 * component so the button reads and behaves the same everywhere it appears.
 */
export function AddToSite({ className = "" }: { className?: string }) {
  const { viewer } = useViewer();
  if (!viewer || viewer.url) return null; // not signed in, or already has a site
  return (
    <Link className={("btn add-site " + className).trim()} to="/verify">
      <span className="add-site-ic" aria-hidden="true">＋</span>
      Add to my site
    </Link>
  );
}
