import { Navigate } from "react-router-dom";

/**
 * /embed and /verify were merged into one "Add to your site" page. Keep the URL alive
 * (old links, the agent docs) by redirecting it to the canonical /verify.
 */
export function Embed() {
  return <Navigate to="/verify" replace />;
}
