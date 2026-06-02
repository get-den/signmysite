import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useViewer } from "./providers";
import { host, initials } from "./lib";
import type { Member } from "./api";

/** Round avatar — image if present, else the name/handle's first letter. */
export function Avatar({
  of,
}: {
  of: { name?: string | null; handle?: string | null; avatar?: string | null };
}) {
  if (of.avatar) {
    return <div className="avatar" style={{ backgroundImage: `url(${JSON.stringify(of.avatar)})` }} />;
  }
  return <div className="avatar">{initials(of.name || of.handle)}</div>;
}

export function Loading() {
  return <div className="loading">…</div>;
}

/** Google "G" mark for the sign-in button. */
export function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.9 2.4 30.3 0 24 0 14.6 0 6.4 5.4 2.5 13.3l7.9 6.1C12.3 13.2 17.7 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.1 5.3-4.6 7l7.1 5.5c4.2-3.9 6.6-9.6 6.6-16.5z"
      />
      <path
        fill="#FBBC05"
        d="M10.4 28.6c-.5-1.5-.8-3-.8-4.6s.3-3.1.8-4.6l-7.9-6.1C.9 16.5 0 20.1 0 24s.9 7.5 2.5 10.7l7.9-6.1z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.3 0 11.6-2.1 15.5-5.6l-7.1-5.5c-2 1.4-4.6 2.2-8.4 2.2-6.3 0-11.7-3.7-13.6-9.4l-7.9 6.1C6.4 42.6 14.6 48 24 48z"
      />
    </svg>
  );
}

/** A followed blog as a list row, linking to its site (or its Den page). */
export function BlogRow({ blog }: { blog: Member }) {
  const href = blog.url || (blog.handle ? `/@${blog.handle}` : "#");
  const external = !!blog.url;
  return (
    <a className="blog" href={href} target={external ? "_blank" : undefined} rel="noopener">
      <Avatar of={blog} />
      <div className="meta">
        <div className="bn">{blog.name || "—"}</div>
        <div className="bh">{blog.url ? host(blog.url) : "@" + (blog.handle || "")}</div>
      </div>
    </a>
  );
}

/** Gate a route on being signed in; bounce home otherwise. */
export function Protected({ children }: { children: ReactNode }) {
  const { viewer, loading } = useViewer();
  if (loading) return <Loading />;
  if (!viewer) return <Navigate to="/" replace />;
  return <>{children}</>;
}
