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

If anything fails (Worker down, quota reached, outfit still loading), the app copies the plain short link instead.

## Safeguards

| Risk | Limit |
| --- | --- |
| Overwriting someone's preview | Ids are random, 62¹² ≈ 3×10²¹; nothing is ever overwritten. A link's own `?o=` is used only after its entry has expired. |
| Hosting arbitrary files | Only JPEGs whose frame header says exactly 1200×630, at most 250 KB, served as `image/jpeg` with `nosniff` and `default-src 'none'`. |
| Scripted uploads | The `Origin` must be in `ALLOWED_ORIGINS`, and the rate limit is 6 uploads a minute per IP (Workers rate-limit binding). |
| Injection | Outfit codes must match the app's short-link grammar; everything put into HTML is escaped. Redirects only go to `APP_URL`. |
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

## Live deployment (20 Oct 2026)

- Worker `the-finals-outfit-share` at https://the-finals-outfit-share.chronohaxx.workers.dev (account subdomain renamed from the
  email-derived default so share links carry no personal name).
- KV namespace SHARES `2d6f309206e647138dbed7fbc474f33b`; the rate-limit binding works on the Free plan.
- Smoke-tested after deploy: root redirect, foreign origin 403, wrong size 415, real upload 201, crawler page with og:image and
  summary_large_image, image served byte-identical with nosniff and a one-year cache.
