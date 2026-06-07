# signmysite

Personal websites are islands. signmysite links them into one social graph you can
follow, save, and explore — without anyone giving up their own site.

You keep your site. You add one line:

```html
<script src="https://signmysite.com/w.js"></script>
```

By default it renders nothing — a quiet presence and analytics layer: you show up
in everyone's graph, people can follow you from signmysite, and you see who's
reading. Want a visible badge people can open to follow and leave comments? Add
`data-ui="card"`:

```html
<script src="https://signmysite.com/w/YOUR_ID.js" data-ui="card"></script>
```

The generic tag is the safest bootstrap for local/preview installs. After you
sign in, signmysite gives you a permanent tag like `https://signmysite.com/w/YOUR_ID.js`;
use that for production when you can.

## How it works

- **Your site stays yours.** signmysite is an index, not a host. Your content never moves.
- **One `<script>` tag** is the whole integration — it's the only thing every
  platform allows, so the widget works on WordPress, Squarespace, Wix, Ghost,
  a framework, or hand-written HTML alike. It mounts in a shadow DOM, so it
  never clashes with your styles.
- **Identity is a permanent id**, not your domain — rename or move hosts and your
  followers stay attached. Sign in is **Google or email magic link**; no keys,
  no passwords. Built so a kid (and their AI agent) can use it.
- **Agent-native onboarding.** Vibe-coding your site? Tell your AI agent
  *"add signmysite, see signmysite.com/skill.md"* and it pastes the line for you. You only
  handle Google/email authentication; the agent can replace the generic tag
  with the permanent one afterward.

## Run it locally

Needs Node 22+ and Postgres.

```bash
npm install
createdb signmysite
npm run seed     # load a small demo graph
npm start        # → http://localhost:8787
```

Open <http://localhost:8787> for the main site, or
<http://localhost:8787/widget/demo.html> to see the widget on a sample page.

Sign-in uses a dev stub until you set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

## Layout

```
skill.md         how an AI agent adds signmysite to a site
llms.txt         condensed agent-facing spec
schema/          JSON Schema for me.json
widget/          the embeddable widget (vanilla JS, zero deps, shadow DOM)
site/            the main signmysite.com site (vanilla SPA)
server/          reference backend — Hono + Postgres (see server/README.md)
docs/            short install guides, one per platform
```

## Docs

- **Install the widget** → [docs/](docs/) (pick your platform, or the catchall)
- **For AI agents** → [skill.md](skill.md)
- **The backend** → [server/README.md](server/README.md)

---

signmysite is an open protocol. The spec is small on purpose.
