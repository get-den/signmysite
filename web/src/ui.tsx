import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import { useToast, useViewer } from "./providers";
import { host, initials, profilePath, siteThumb, PLACEHOLDER_THUMB } from "./lib";
import { verifySite, type Site } from "./api";

/** Wrap the app once so tooltips share hover-intent timing. */
export const TooltipProvider = RadixTooltip.Provider;

/**
 * A small text tooltip on hover/focus — headless Radix, styled by .tip to match
 * the app. `asChild` attaches to the child element directly, so it never adds a
 * wrapper that could disturb layout. The child must be focusable for keyboard
 * users (e.g. a button, or a div with tabIndex={0}).
 */
export function Tip({
  label,
  side = "top",
  children,
}: {
  label: string;
  side?: "top" | "bottom" | "left" | "right";
  children: ReactNode;
}) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content className="tip" side={side} sideOffset={6} collisionPadding={10}>
          {label}
          <RadixTooltip.Arrow className="tip-arrow" width={12} height={6} />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

/**
 * Canonical loading spinner — an SVG arc that rotates. Uses `currentColor`, so it
 * takes on the surrounding text color (white in a primary button, faint in a
 * field). Size is px; the 24×24 viewBox keeps the 2px stroke crisp at any size.
 */
export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span className="svg-spinner-container" style={{ width: size, height: size }}>
      <svg viewBox="0 0 24 24" width="100%" height="100%">
        <circle
          className="svg-spinner-circle"
          cx="12" cy="12" r="10"
          fill="none" stroke="currentColor" strokeWidth="2"
          strokeDasharray="56.5487" strokeDashoffset="15.7" strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

/**
 * The app's button. When `loading`, the label stays in place (hidden) and the
 * spinner overlays it centered — so the width never jumps. Pass the same class
 * modifiers as a raw `.btn` (e.g. "primary lg", "sm pink").
 */
export function Button({
  loading = false,
  className = "",
  type = "button",
  disabled,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  return (
    <button
      type={type}
      className={("btn " + className).trim()}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      <span className="btn-lbl" data-hidden={loading || undefined}>{children}</span>
      {loading && <span className="btn-spin"><Spinner /></span>}
    </button>
  );
}

/** Copy-to-clipboard state: the trigger flips to "Copied" for a beat. */
export function useCopy(text: string, ms = 1400): { copied: boolean; copy: () => void } {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), ms);
    }).catch(() => {});
  };
  return { copied, copy };
}

/** A code snippet with a primary copy button below that flips to "Copied". */
export function CopyField({ text, label = "Copy" }: { text: string; label?: string }) {
  const { copied, copy } = useCopy(text);
  return (
    <div className="copyfield">
      <div className="snippet">{text}</div>
      <Button className="primary lg" onClick={copy}>
        {copied ? "Copied" : label}
      </Button>
    </div>
  );
}

/**
 * The canonical "add the widget" control: the one-line script shown in full (but
 * truncated to one line, never scrolling) with a Copy button. Used wherever someone
 * installs signmysite. `onCopied` lets a caller (the verify flow) react to a copy.
 */
export function WidgetInstall({
  viewer, onCopied, className = "",
}: {
  viewer: { id: string };
  onCopied?: () => void;
  className?: string;
}) {
  const tag = `<script src="${location.origin}/w/${viewer.id.replace(/^signmysite:/, "")}.js"></script>`;
  const { copied, copy } = useCopy(tag);
  return (
    <div className={("widget-install " + className).trim()}>
      <input
        className="widget-install-tag"
        value={tag}
        readOnly
        spellCheck={false}
        aria-label="Your widget script tag"
        title={tag}
        onFocus={(e) => e.currentTarget.select()}
      />
      <Button className="pink" onClick={() => { copy(); onCopied?.(); }}>
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

/**
 * The one "Verify my site" control — looks for your widget on your live site, flips
 * you to verified in place, and toasts. Shared by the onboarding / /verify setup and
 * the home right-rail CTA, so both behave identically: black button that spins while
 * it checks, label flips to "Verify again" after a miss. `onVerified` fires on
 * success; `onMiss` lets the caller add its own next step (a help link, a hint).
 */
export function VerifyButton({
  className = "primary lg",
  onVerified,
  onMiss,
}: {
  className?: string;
  onVerified?: () => void;
  onMiss?: () => void;
}) {
  const { viewer, setViewer, refreshViewer } = useViewer();
  const toast = useToast();
  const [checking, setChecking] = useState(false);
  const [missed, setMissed] = useState(false);

  const check = async () => {
    if (checking || !viewer) return;
    setChecking(true);
    try {
      const r = await verifySite();
      if (r.verified) {
        // Verifying can also CLAIM a placeholder for this site (the real owner inheriting
        // e.g. @pg), which changes our handle + identity server-side. Flip the flag
        // optimistically, then refetch so the inherited identity shows without a reload.
        setViewer({ ...viewer, verified: true });
        await refreshViewer();
        toast("Verified ✓");
        onVerified?.();
      } else {
        setMissed(true);
        onMiss?.();
      }
    } catch {
      setMissed(true);
      onMiss?.();
    } finally {
      setChecking(false);
    }
  };

  return (
    <Button className={className} loading={checking} onClick={check}>
      {missed ? "Verify again" : "Verify"}
    </Button>
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

/**
 * A website's preview image, locked to the og:image aspect ratio (1200×630). Shows
 * the site's real og:image when we have one, otherwise the canonical wireframe
 * placeholder — and swaps to that same placeholder if a real image fails to load.
 * One component, so every site thumbnail across the app shares the shape + fallback.
 */
export function SiteThumbnail({
  site,
  className = "",
}: {
  site: { thumbnail?: string | null };
  className?: string;
}) {
  return (
    <img
      className={("site-thumb " + className).trim()}
      src={siteThumb(site)}
      alt=""
      loading="lazy"
      decoding="async"
      onError={(e) => {
        const img = e.currentTarget;
        if (img.dataset.fallback) return; // already on the fallback — don't loop
        img.dataset.fallback = "1";
        img.src = PLACEHOLDER_THUMB;
      }}
    />
  );
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
/** Canonical back chevron — one icon, used everywhere we go back. */
export const BackIcon = ({ size = 18 }: { size?: number }) => (
  <Lucide size={size}><path d="m15 18-6-6 6-6" /></Lucide>
);
/** Canonical dismiss ✕ — the close glyph for sheets and overlays. */
export const CloseIcon = ({ size = 18 }: { size?: number }) => (
  <Lucide size={size}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></Lucide>
);

/**
 * Canonical round nav button: a back chevron or a close ✕ inside a soft circle.
 * The single back/dismiss affordance for the whole app — sheet overlays, the
 * onboarding wizard, the public profile. Renders a router <Link> when given
 * `to`, otherwise a <button> that calls `onClick`.
 */
export function IconButton({
  icon,
  to,
  onClick,
  label,
  className = "",
}: {
  icon: "back" | "close";
  to?: string;
  onClick?: () => void;
  label?: string;
  className?: string;
}) {
  const cls = ("iconbtn" + (className ? ` ${className}` : "")).trim();
  const aria = label ?? (icon === "back" ? "Back" : "Close");
  const glyph = icon === "back" ? <BackIcon /> : <CloseIcon />;
  return to ? (
    <Link className={cls} to={to} aria-label={aria}>
      {glyph}
    </Link>
  ) : (
    <button className={cls} type="button" onClick={onClick} aria-label={aria}>
      {glyph}
    </button>
  );
}

/**
 * The standard header for a page reached from the feed (Settings, Chat, Profile):
 * the canonical round back button + a title. Back goes to wherever you came from, or
 * home if there's no history to pop. Mirrors the column header pattern in
 * Twitter/LinkedIn — present even alongside the nav rail.
 */
export function PageHead({ title, children }: { title: string; children?: ReactNode }) {
  const navigate = useNavigate();
  const back = () => (window.history.length > 1 ? navigate(-1) : navigate("/"));
  return (
    <header className="page-head">
      <IconButton icon="back" onClick={back} label="Back" />
      <h1 className="page-title">{title}</h1>
      {children && <div className="page-head-actions">{children}</div>}
    </header>
  );
}

/** Lucide "inbox" — the default empty-state glyph. */
export const InboxIcon = ({ size = 40 }: { size?: number }) => (
  <Lucide size={size}>
    <path d="M22 12h-6l-2 3h-4l-2-3H2" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </Lucide>
);

/**
 * The canonical empty state: a centered icon over one short line, filling the column.
 * Used wherever a list is empty (feed, saved, messages, notes). Defaults to the inbox
 * glyph; pass `icon` for a context-specific one.
 */
export function EmptyState({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-state-ico">{icon ?? <InboxIcon />}</span>
      <p className="empty-state-text">{children}</p>
    </div>
  );
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

/**
 * Links an identity (an avatar/name chip) to its profile: in-app to /u/<handle> inside
 * the feed shell when we know the handle, else out to their external site, else inert.
 * One source of truth so every name + avatar across the app opens the same in-shell
 * profile — the "Twitter layout" for anyone, not just you.
 */
export function IdentityLink({
  of, className, children, ariaLabel,
}: {
  of: { handle?: string | null; url?: string | null };
  className?: string;
  children: ReactNode;
  ariaLabel?: string;
}) {
  const path = profilePath(of);
  if (path) return <Link className={className} to={path} aria-label={ariaLabel}>{children}</Link>;
  if (of.url) return <a className={className} href={of.url} target="_blank" rel="noopener" aria-label={ariaLabel}>{children}</a>;
  return <span className={className}>{children}</span>;
}

/** A followed/saved site as a list row, linking to the member's signmysite profile. */
export function BlogRow({ blog }: { blog: Site }) {
  return (
    <IdentityLink of={blog} className="blog">
      <Avatar of={blog} />
      <div className="meta">
        <div className="bn">
          {blog.name || "Untitled"}
          {blog.isNew && <span className="newdot" title="Updated since you last looked" />}
        </div>
        <div className="bh">{blog.url ? host(blog.url) : "@" + (blog.handle || "")}</div>
      </div>
    </IdentityLink>
  );
}

/**
 * Gate a route on being signed in; bounce home otherwise. By default it also
 * requires a finished signup, but setup pages reachable mid-onboarding (e.g.
 * /verify, opened by "Add to my site" before a new member has picked a username)
 * pass requireOnboarded={false} so a freshly signed-in visitor isn't kicked out.
 */
export function Protected({
  children,
  requireOnboarded = true,
}: {
  children: ReactNode;
  requireOnboarded?: boolean;
}) {
  const { viewer, loading } = useViewer();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!viewer) {
    const ret = location.pathname + location.search + location.hash;
    return <Navigate to={`/auth?return=${encodeURIComponent(ret)}`} replace />;
  }
  if (requireOnboarded && !viewer.onboarded) return <Navigate to="/" replace />; // finish signup first
  return <>{children}</>;
}
