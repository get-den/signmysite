import { Link } from "react-router-dom";

// The site footer, kept deliberately minimal: the wordmark on the left, the three
// links that matter on the right. No tagline, no copyright.
export function Footer() {
  return (
    <footer className="foot">
      <span className="foot-brand">signmysite</span>
      <nav className="foot-links">
        <Link to="/verify">Add to my site</Link>
        <a href="/widget/demo.html">Demo</a>
        <a href="/skill.md">For agents</a>
      </nav>
    </footer>
  );
}
