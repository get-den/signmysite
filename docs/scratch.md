# Add signmysite to a site you built yourself

For hand-written HTML or any framework (React, Vue, Svelte, Astro, Next, plain HTML…).

Paste your line (from [signmysite.com](https://signmysite.com) → **Get your widget**) just before
the closing `</body>` tag:

```html
    <script src="https://signmysite.com/w/YOUR_ID.js"></script>
  </body>
</html>
```

Publish. Done — the badge appears bottom-right.

**Frameworks:** the tag works as-is in any template. You don't need a package, an
import, or a component — it's a plain script that mounts itself in a shadow DOM, so
it never clashes with your styles or your framework's rendering. Put it in your root
layout (e.g. `index.html`, `App`, `_document`, `layout.tsx`) so it's on every page.

**Options:** `data-theme="light|dark"` (default `auto`), `data-position="bottom-left"` etc.
