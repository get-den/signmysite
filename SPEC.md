# Den Protocol — v1

Den turns siloed personal websites into a traversable social graph.

Every personal site publishes one small file, **`me.json`**, that says *who you are* and *who you link to*. Den indexes these files so people (and their AI agents) can **follow**, **save**, and **traverse** each other's sites — without anyone giving up ownership of their own site.

This spec is intentionally small enough to read in one sitting. If you are an AI agent adding Den to a site, you can also read [`llms.txt`](./llms.txt).

---

## 1. The mental model (three things)

| Thing | What it is | Changes? | Example |
|---|---|---|---|
| **id** | Your permanent identifier. The graph points here. | **Never** | `den:7f3a9c2e8b1d4f6a` |
| **handle** | Your human-readable name. A pointer to your id. | Anytime | `maya` → `maya.den.io`, or `maya.com` |
| **me.json** | The public file on your site declaring your id, name, and links. | Anytime | `https://maya.com/me.json` |

The single most important rule:

> **Graph edges point at the `id`, never at a URL or handle.**

This is what lets someone rename themselves or move hosts without breaking a single follower. Your friends followed *you* (`id`), not your address.

---

## 2. Identity & auth — no one manages a key

Under the hood, every `id` is backed by a keypair. **Humans never see it.** Two custody modes:

### Custodial (the default — and the only thing a kid ever needs)
- den.com holds the key for you.
- You prove you're you with **email + a magic link**. No passwords. No keys. No seed phrases.
- This is also your **recovery**: lost access on a new device? Click a magic link in your email. Done.

### Self-custody (advanced, opt-in)
- You (or your agent) hold the key and sign your own `me.json`.
- Fully portable — you can leave den.com entirely and the graph still works.
- You can still link an email for magic-link recovery.

**Design rule:** *email magic link is always available as auth and recovery, in every mode.* Keys are an implementation detail, never a user-facing requirement.

---

## 3. `me.json`

The whole protocol, from the publisher's side, is this one file. Minimal valid example:

```json
{
  "version": "den/v1",
  "id": "den:7f3a9c2e8b1d4f6a",
  "name": "Maya"
}
```

A realistic one:

```json
{
  "version": "den/v1",
  "id": "den:7f3a9c2e8b1d4f6a",
  "handle": "maya",
  "name": "Maya",
  "avatar": "https://maya.com/me.jpg",
  "bio": "13. i draw dinosaurs and build little games.",
  "url": "https://maya.com",
  "links": [
    { "id": "den:1a2b3c4d5e6f7a8b", "handle": "leo", "rel": "friend" },
    { "id": "den:9f8e7d6c5b4a3210", "handle": "priya.com", "rel": "follow" }
  ],
  "feed": "https://maya.com/feed.json"
}
```

### Fields

| Field | Required | Type | Notes |
|---|---|---|---|
| `version` | ✅ | string | Always `"den/v1"`. |
| `id` | ✅ | string | Your permanent id. `den:` + lowercase base32. Issued at registration. |
| `name` | ✅ | string | Display name. |
| `handle` | – | string | Human-readable. No dot ⇒ a Den handle (`maya` → `maya.den.io`). Has a dot ⇒ a domain (`maya.com`). |
| `avatar` | – | string (URL) | Square image. |
| `bio` | – | string | ≤ 280 chars. |
| `url` | – | string (URL) | Canonical home page. |
| `created` | – | string | ISO 8601 date. |
| `links` | – | array | Your graph edges. See below. |
| `feed` | – | string (URL) | Points to a `feed.json` of your posts (see §6). |
| `posts` | – | array | Inline posts, if you don't use a separate `feed`. |
| `proof` | – | object | Optional signature for self-custody / trustless verification (see §5). |

### Link object (an edge in the graph)

```json
{ "id": "den:1a2b3c4d5e6f7a8b", "handle": "leo", "rel": "friend", "url": "https://leo.den.io" }
```

| Field | Required | Notes |
|---|---|---|
| `id` | ✅ | The id you're linking to. The edge. |
| `handle` | – | A hint for display; always re-resolve via the id. |
| `name` | – | Display hint. |
| `rel` | – | `friend` \| `follow` \| `inspired-by` \| free text. Default `follow`. |
| `url` | – | Display hint. |

Only `id` matters for the graph. Everything else is a convenience hint that may go stale — resolvers must treat the `id` as truth.

---

## 4. Getting on Den (registration = publishing)

Because identity is anchored to an `id` (not your server), **publishing a `me.json` is enough to exist.** There is no required signup form.

### The default flow (an agent building a kid's site)

1. Agent asks: "Want friends to be able to follow this?" → yes.
2. Agent calls `POST /api/register` → den.com mints an `id` + a random `handle` (changeable later) and returns them. (Email optional here; can be added later for recovery.)
3. Agent writes `me.json` with that `id`, and drops the widget `<script>` tag (see §7) into the site.
4. Agent deploys the site to any host (Vercel / Netlify / GitHub Pages / anywhere).
5. First page load, the widget pings den.com, which fetches & indexes `me.json`. The site is now in the graph.
6. To manage or recover the account later → **email magic link**.

The kid never sees a key. The only thing they ever need to *secure* the account is an email, and even that can be added after the fact via "claim this site."

### Pure-publish (no API call)

You can skip step 2 entirely: publish a `me.json` (with a self-custody `id` your agent generated, or no `id` at all), and Den will discover it via the widget ping or a backlink, then create a **provisional** identity you can later claim with an email. Default to the API-assisted flow for kids — it gives custody + recovery from the start.

### Discovery — how den.com finds a site

Any one of:
- The widget phones home on first load (automatic), or
- `POST /api/discover { url }` (instant), or
- Someone links you (`links[].id`) and the indexer follows the edge.

---

## 5. Anti-impersonation

What stops `evil.com` from copying Maya's `me.json` (same `id`) onto their site?

**The id → canonical-url binding is authoritative and owner-controlled.** When an `id` is registered, den.com records its canonical site URL. That mapping can only be changed by the email-authenticated owner (or, in self-custody, by a signature). A site is **verified** only if the URL serving the `me.json` matches the canonical URL for the `id` it claims. A copycat serving the same file from another URL is not verified, and the widget/index mark it accordingly.

**Trustless option (`proof`):** self-custody members can include a detached signature over `me.json`, letting anyone verify the id↔site binding *without trusting den.com at all*:

```json
"proof": {
  "alg": "ed25519",
  "key": "<public key>",
  "sig": "<signature over the canonicalized me.json minus this field>"
}
```

v1 clients may rely on the den.com binding; `proof` is the upgrade path to full decentralization.

---

## 6. Posts (light, optional)

`me.json` is about identity + graph. Content is optional and can live inline (`posts`) or in a separate `feed.json` (`feed`). A post is deliberately free-form to fit photos, short/long video, tweets, longform, and artifacts:

```json
{
  "id": "p_2026_05_31_dino",
  "type": "photo",
  "title": "new drawing",
  "content": "spent all weekend on this stegosaurus",
  "media": ["https://maya.com/img/stego.jpg"],
  "url": "https://maya.com/posts/stego",
  "created": "2026-05-31T18:02:00Z"
}
```

`type` is an open vocabulary; common values: `note`, `photo`, `video`, `link`, `artifact`. Unknown types render as a generic card.

---

## 7. The widget

One line, works in **any** framework (it mounts itself in a shadow DOM, so it can't touch the site's CSS):

```html
<script src="https://den.com/widget.js" data-site="/me.json"></script>
```

It floats bottom-right. Collapsed = a small pill. Hover/click = a card showing the person's name, handle, **follower/following counts**, and **Follow** + **Save** buttons.

Two data sources, by design:
- **Identity** (name, avatar, handle) ← the static `me.json`.
- **Live social state** (counts, whether *you* already follow) ← den.com API.

This split is the whole architecture in miniature: *the static file is who you are; den.com holds the live, shared counters.* "Who follows whom" is mutable shared state and cannot live in a static file.

To **follow** or **save**, the viewer must themselves be a Den member — their browser carries a den.com session from a one-time magic-link sign-in. If they're not signed in, the buttons open a sign-in popup.

Attributes:

| Attribute | Default | Notes |
|---|---|---|
| `data-site` | `/me.json` | Path/URL to this site's `me.json`. |
| `data-id` | – | Skip the fetch by hard-coding the id. |
| `data-api` | `https://den.com` | API origin (override for local dev). |
| `data-theme` | `auto` | `auto` \| `light` \| `dark`. |
| `data-position` | `bottom-right` | Corner to float in. |

---

## 8. API reference (v1)

Origin: `https://den.com`. All bodies JSON. Auth via session cookie set by the magic-link flow.

| Method | Path | Purpose | Auth |
|---|---|---|---|
| `POST` | `/api/register` | Mint a new `id` + handle. Body: `{ email?, handle?, url? }`. | none |
| `POST` | `/api/auth/magic-link` | Email a sign-in/recovery link. Body: `{ email }`. | none |
| `GET` | `/api/profile/:id` | Public profile (resolved from latest `me.json`). | none |
| `GET` | `/api/profile/:id/stats` | `{ followers, following, viewerFollows, viewerSaved }`. | optional |
| `POST` | `/api/follow` | Follow/unfollow. Body: `{ id }`. | required |
| `POST` | `/api/save` | Save/unsave. Body: `{ id }`. | required |
| `POST` | `/api/discover` | Submit a site for indexing. Body: `{ url }`. | none |
| `GET` | `/api/viewer` | The current signed-in member (or `null`). | optional |

---

## 9. Versioning

- `version` is always present. v1 is `"den/v1"`.
- Changes are **additive and backward-compatible**; old `me.json` files never stop working.
- Unknown fields are ignored by clients, never an error. This keeps the format a stable target agents can safely bake in.

---

## 10. Why it's built this way (design principles)

1. **Anchor identity in an id, not an address** — so renames and moves never break the graph.
2. **Custodial-by-default, email magic link always** — a kid never touches a key; recovery is always one email away.
3. **Publishing is registration** — the lowest-friction path to existing; agents love it.
4. **One file, one script tag, one well-known shape** — every removed decision is a mistake an agent can't make. This is how the format becomes the *default* agents reach for.
5. **Static file = identity, server = live state** — the only things centralized are the things that *must* be (shared, mutable counters), and even identity verification has a trustless upgrade path.
6. **Reuse familiar shapes** — JSON, ISO dates, feed-like posts — so it's already in an agent's prior.
