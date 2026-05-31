# Den server

The reference backend for the [Den protocol](../SPEC.md). TypeScript on
[Hono](https://hono.dev) + Postgres. Raw SQL, no ORM. Run directly with Node —
no build step (Node strips the types).

## Run

```bash
npm install
createdb den          # one-time: create the Postgres database (or: npm run db:create)
npm start             # → http://localhost:8787  (serves the API + the demo)
```

Open **http://localhost:8787** — it redirects to the widget demo, and the widget
talks to the API on the same origin. Sign-in is by email magic link; with no
mailer configured the link is printed to the server console and returned as
`dev_link` so you can complete it locally.

## Layout

| File | Role |
|---|---|
| `db.ts` | The only file that touches Postgres. Swap storage here; nothing else changes. |
| `app.ts` | The API + the magic-link auth pages (the table from SPEC.md §8). |
| `index.ts` | Starts the server and serves the repo's static files. |
| `util.ts` | ids, handles, tokens, html-escaping. |

## Config (env)

| Var | Default | Notes |
|---|---|---|
| `PORT` | `8787` | |
| `DATABASE_URL` | `postgres:///den` | Local unix socket (peer auth). Set for production. |
| `DEN_BASE_URL` | `http://localhost:$PORT` | Public origin. Over `https`, session cookies become `SameSite=None; Secure` so cross-site widget follows work. |
| `DEN_EMAIL` | _(unset)_ | Set to `smtp` once a real mailer is wired (stops returning `dev_link`). |

## Try the flow

```bash
# 1. register (mint an id + handle)
curl -s -XPOST localhost:8787/api/register -d '{"name":"Maya"}' -H content-type:application/json

# 2. index a site by fetching its me.json (imports its links as edges)
curl -s -XPOST localhost:8787/api/discover -d '{"url":"http://localhost:8787/examples/me.json"}' -H content-type:application/json

# 3. read stats
curl -s localhost:8787/api/profile/den:7f3a9c2e8b1d4f6a/stats
```

## Production notes (deliberately left open-ended)

- **Email:** wire a real sender in `/api/auth/magic-link`, then set `DEN_EMAIL=smtp`.
- **Cookies cross-site:** serve over HTTPS so `SameSite=None; Secure` applies; the widget sends credentials.
- **Caching/scale:** put Redis in front of `stats` and precompute feeds when reads grow.
- **Crawler:** `/api/discover` is fetch-on-demand; add a queue + periodic re-crawl later.
- **Verification:** today a site is trusted via the `id → url` binding; add `me.json` signatures (SPEC.md §5) for trustless checks.
