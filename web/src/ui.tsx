import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useToast, useViewer } from "./providers";
import { host, initials } from "./lib";
import type { Site } from "./api";

/** A code snippet with a rounded copy button in the corner. */
export function CopyField({ text, label = "Copy" }: { text: string; label?: string }) {
  const toast = useToast();
  const copy = () => navigator.clipboard.writeText(text).then(() => toast("Copied"));
  return (
    <div className="snippet">
      {text}
      <button className="btn sm copy" onClick={copy}>
        {label}
      </button>
    </div>
  );
}

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

/* Lucide icons (https://lucide.dev), inlined as small components. */
function Lucide({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}
export const SearchIcon = () => (
  <Lucide><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></Lucide>
);
export const HeartIcon = () => (
  <Lucide><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z" /></Lucide>
);
export const EyeIcon = () => (
  <Lucide><path d="M2.06 12.35a1 1 0 0 1 0-.7 10.94 10.94 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.94 10.94 0 0 1-19.88 0" /><circle cx="12" cy="12" r="3" /></Lucide>
);
export const PinIcon = ({ filled = false }: { filled?: boolean }) => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 17v5" /><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
  </svg>
);

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

/** A followed/saved site as a list row, linking to the member's Den profile. */
export function BlogRow({ blog }: { blog: Site }) {
  const href = blog.handle ? `/@${blog.handle}` : blog.url || "#";
  return (
    <a className="blog" href={href} rel="noopener">
      <Avatar of={blog} />
      <div className="meta">
        <div className="bn">
          {blog.name || "—"}
          {blog.isNew && <span className="newdot" title="Updated since you last looked" />}
        </div>
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
