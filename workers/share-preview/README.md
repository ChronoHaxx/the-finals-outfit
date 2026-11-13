# Outfit link previews (Cloudflare Worker)

GitHub Pages serves one static `index.html`, and the outfit lives in the URL fragment (`#/?o=…`). Link crawlers
never send the fragment, so every shared outfit unfurls as the same generic card. This Worker gives each shared outfit
its own page and image:

1. When someone clicks **Share outfit** with **Link with preview image**, the app renders the current outfit from four
   angles (front, three-quarter, side, back). It uses the viewer's own lights and tone curve
   (`src/rig/SharePreviewRender.ts`). The result is a 1200×630 JPEG of about 60–80 KB, uploaded to `POST /api/share?o=<code>`.
2. The Worker stores it in KV under a random 12-character id and returns `https://<worker>/s/<id>?o=<code>`.
3. A crawler fetching that link gets `og:image` and `twitter:card=summary_large_image`. A person is sent straight on
   to the builder with the outfit loaded.

**Poses (10 Nov 2026).** When an emote is on screen (playing or paused), the card shows that frame with a caption, and
the upload adds the app's pose parameters: `POST /api/share?o=<code>&emote=<clip id>&t=<seconds>[&paused=1]`. The
Worker validates them (a clip slug, seconds to the millisecond, `paused=1`), stores them in the entry's metadata beside
`o`, returns them in the link, and its page sends people to `#/?o=<code>&emote=...` so the builder opens on that frame.
og:description says "frozen 1.567 s into an emote" (identifiers and numbers only, never free text). Entries and links
made before poses have none and behave as before; an old app never sends a pose.

If anything fails (Worker down, quota reached, outfit still loading), the app copies the plain short link instead.

## Safeguards

| Risk | Limit |
| --- | --- |
| Overwriting someone's preview | Ids are random, 62¹² ≈ 3×10²¹; nothing is ever overwritten. A link's own `?o=` is used only after its entry has expired. |
| Hosting arbitrary files | Only JPEGs whose frame header says exactly 1200×630, at most 250 KB, served as `image/jpeg` with `nosniff` and `default-src 'none'`. |
| Scripted uploads | The `Origin` must be in `ALLOWED_ORIGINS`, and the rate limit is 6 uploads a minute per IP (Workers rate-limit binding). |
| Injection | Outfit codes must match the app's short-link grammar, and poses its pose grammar (`src/lib/share-pose.ts`); everything put into HTML is escaped. Redirects only go to `APP_URL`. |
| Swapping a pose under a card | Like the code, a stored pose wins over the link's own; a link's pose is used only once its entry expired. |
| Storage growth | Every entry expires after a year (`expirationTtl`). An expired link still opens its outfit, with the generic card. |
| Cost | The Free plan has no overage billing. Past 1,000 KV writes a day or 1 GB, uploads fail and the app falls back to plain links. |
| Emergency stop | Set `UPLOADS_DISABLED` to `"1"` and redeploy. Existing links keep working. |

No personal data is stored. The client IP is used only as the rate-limit key and is not saved.

## Run it locally

Git Bash, in `workers/share-preview`:

```bash
WRANGLER_SEND_METRICS=false npx --yes wrangler@4.131.1 dev --port 8787 --ip 127.0.0.1 --var ALLOWED_ORIGINS:http://127.0.0.1:4344 --var APP_URL:http://127.0.0.1:4344/the-finals-outfit/
```

`wrangler dev` simulates KV and the rate limiter locally; nothing touches the Cloudflare account. Build the app with
`VITE_SHARE_PREVIEW_BASE=http://127.0.0.1:8787` and serve it on port 4344. Unit tests:
`node --import tsx --test tests/share-preview-worker.test.ts`.

## Deploy (account-side; ask first)

1. `npx --yes wrangler@4.131.1 kv namespace create SHARES`, then put the printed id in `wrangler.jsonc`.
2. `npx --yes wrangler@4.131.1 deploy` from this folder. Note the `https://the-finals-outfit-share.<subdomain>.workers.dev` URL.
3. Set `SHARE_PREVIEW_BASE` to that URL in `.github/workflows/deploy.yml` (passed to the build as `VITE_SHARE_PREVIEW_BASE`)
   and merge. Until then the app hides the preview option.

## Redeploying for poses (10 Nov 2026)

The pose change is backward compatible both ways, but deploy the Worker **before** merging the app change: an old
Worker ignores the pose, so its links would open the outfit without the frame the card shows. From this folder
(PowerShell or Git Bash), with the account already logged in from 20 Oct:

```bash
npx --yes wrangler@4.131.1 deploy
```

Then check: `https://the-finals-outfit-share.chronohaxx.workers.dev/s/AAAAAAAAAAAA?o=2.&emote=wave&t=1&paused=1`
should answer a page whose `location.replace` ends in `#/?o=2.&emote=wave&t=1&paused=1` (an unknown id falls back to
the link's own pose). No KV or binding changes.

**Deployed 10 Nov 2026, 22:59 London** (on the user's "go"): version `3a05274f-fbd0-4bed-b1a6-a279d7e6a37a`, replacing
`051be245-2d15-4dba-bdc5-e86280e2df2f` (20 Oct; `npx --yes wrangler@4.131.1 rollback 051be245-2d15-4dba-bdc5-e86280e2df2f`
restores it). Live checks after the deploy: the pose URL above now keeps the pose (before: `#/?o=2.`); the 20 Oct link
`/s/XkVfZU1EMmnr` still opens its outfit and serves its 73 KB card; root redirect; foreign origin 403; a malformed pose
400 `bad pose` (refused before anything is stored). Bindings unchanged.

## Redeploying for body types (13 Nov 2026)

The app's Body Type picker (PR #41) adds `bt=<code>` beside the outfit code. `bt=a` means Androgynous; Masculine has no
`bt`. The Worker validates it (`^[a-z]{1,2}$`, else 400 `bad body type`), stores it in the entry's metadata as `bt`,
returns it in the link and sends people to `#/?o=<code>&bt=a[&emote=...]`. A stored `bt` wins over the link's own while
the entry lives. Entries made before this have none, which means Masculine. The app refuses a preview link that comes
back without the `bt` it sent and copies the plain link instead, so the deploy order does not matter for correctness.

**Deployed 13 Nov 2026** (on the user's "Deploy it"): version `f9f734a6-4ab8-4623-b448-47c043f64fe1`, replacing
`3a05274f-fbd0-4bed-b1a6-a279d7e6a37a`. To restore the previous version:
`npx --yes wrangler@4.131.1 rollback 3a05274f-fbd0-4bed-b1a6-a279d7e6a37a`. Bindings are unchanged.

Live checks after the deploy, all read-only (nothing stored):
- `/s/AAAAAAAAAAAA?o=2.&bt=a` opens `#/?o=2.&bt=a`.
- The same with `&emote=wave&t=1&paused=1` keeps both.
- A junk `bt` is dropped.
- The 20 Oct link `/s/XkVfZU1EMmnr` still opens its outfit and serves its 73 KB card.
- The root redirects.
- An upload with `bt=ABC` gets 400 `bad body type`, and a foreign origin gets 403.

## Live deployment (20 Oct 2026)

- Worker `the-finals-outfit-share` at https://the-finals-outfit-share.chronohaxx.workers.dev (account subdomain renamed from the
  email-derived default so share links carry no personal name).
- KV namespace SHARES `2d6f309206e647138dbed7fbc474f33b`; the rate-limit binding works on the Free plan.
- Smoke-tested after deploy: root redirect, foreign origin 403, wrong size 415, real upload 201, crawler page with og:image and
  summary_large_image, image served byte-identical with nosniff and a one-year cache.
