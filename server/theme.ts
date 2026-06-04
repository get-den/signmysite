/*
 * Den brand tokens — the ONE source of truth for the brand palette across all three
 * surfaces. Nothing else hardcodes these values:
 *   • the email service (mail.ts) inlines them as constants (email strips <style>);
 *   • the React app reads them from GET /theme.css → :root (see rootVars()), which
 *     replaces what used to be duplicated in site/app.css :root;
 *   • the widget gets them injected into its shadow root at serve time (see
 *     widgetVars(), applied in server/index.ts), replacing its old inline copies.
 * Change a value here and every surface updates together.
 */
export const theme = {
  accent: "#fe2858", // --accent — the one brand action color (Follow, primary CTA)
  accentInk: "#ffffff", // --accent-ink — text on accent
  ink: "#0a0a0a", // --ink — near-black headings + the wordmark
  text: "#2b2b2b", // --text — body copy
  muted: "#6e6e73", // --muted — secondary copy, timestamps, footnotes
  line: "#ececec", // --line — hairline borders
  surface: "#ffffff", // --surface — the card
  surface3: "#fafafa", // --surface-3 — avatar / quote fill
  pageBg: "#f3f3f4", // --surface-2 — the recessed page behind the card
  radius: "16px", // --radius
  radiusSm: "12px", // --radius-sm
  // The app's exact font stack. 'Söhne' is self-hosted in the app and won't load in
  // email, so it falls through to the SAME system stack the app uses as its own
  // fallback — identical typography everywhere Söhne is unavailable.
  font: "'Söhne', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
} as const;

// The brand tokens as a CSS custom-property block, in the names the React app uses
// (site/app.css :root). Served at GET /theme.css and linked by the app + the
// server-rendered pages — so app.css no longer declares these itself.
export function rootVars(): string {
  return [
    `--accent:${theme.accent}`, `--accent-ink:${theme.accentInk}`,
    `--ink:${theme.ink}`, `--text:${theme.text}`, `--muted:${theme.muted}`,
    `--line:${theme.line}`, `--surface:${theme.surface}`,
    `--surface-2:${theme.pageBg}`, `--surface-3:${theme.surface3}`,
    `--radius:${theme.radius}`, `--radius-sm:${theme.radiusSm}`,
  ].join(";");
}

// The same tokens in the names the widget's shadow-root CSS uses (it calls the card
// background --bg, and keeps its own --soft/--shadow/--ff besides these). Injected
// into the served widget's :host so the widget reads one source too.
export function widgetVars(): string {
  return [
    `--accent:${theme.accent}`, `--accent-ink:${theme.accentInk}`,
    `--ink:${theme.ink}`, `--muted:${theme.muted}`,
    `--line:${theme.line}`, `--bg:${theme.surface}`,
  ].join(";");
}
