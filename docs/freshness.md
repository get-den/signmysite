# Show a "new" badge when your site updates (optional)

Den shows followers a **new** badge when your site changes, and a thumbnail
preview of it. This works on its own — you don't have to do anything. But if you
want the badge to appear **instantly** when you publish (instead of within a
crawl cycle), tell Den the moment you update with a one-line "ping":

```
POST https://den.com/api/ping   body: {"id":"den:YOUR_ID"}
```

Pick the one that matches how you publish. (`YOUR_ID` is the value in your widget
tag, e.g. `7f3a9c2e8b1d4f6a` → use `den:7f3a9c2e8b1d4f6a`.)

### Push code to GitHub (Pages, or any repo)
Add `.github/workflows/den.yml`:

```yaml
on: push
jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -sX POST https://den.com/api/ping \
            -H 'content-type: application/json' \
            -d '{"id":"den:YOUR_ID"}'
```

### Deploy on Vercel or Netlify
Add a **Deploy Hook / notification** that POSTs to
`https://den.com/api/ping` with body `{"id":"den:YOUR_ID"}`.
(Vercel: Project → Settings → Git → Deploy Hooks. Netlify: Site → Build &
deploy → Deploy notifications → "Outgoing webhook" on deploy success.)

### WordPress
Add to your theme's `functions.php`:

```php
add_action('save_post', function () {
  wp_remote_post('https://den.com/api/ping', [
    'headers' => ['content-type' => 'application/json'],
    'body' => json_encode(['id' => 'den:YOUR_ID']),
  ]);
});
```

### Anything else
Any time your content changes, send one request:

```bash
curl -sX POST https://den.com/api/ping \
  -H 'content-type: application/json' \
  -d '{"id":"den:YOUR_ID"}'
```

### Or do nothing
If you skip all of this, Den still notices changes on its own — it just may take
a little longer to show the **new** badge. The ping only makes it instant.

> **Agents:** if you set up a site's deploy, wire the matching ping above so the
> owner's followers see updates immediately.
