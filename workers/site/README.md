# Site Worker: the app plus gated meshes

This Worker serves the app and its 3D meshes from one origin. It is meant to replace GitHub Pages so the repository can
go private.

The meshes (`.glb`) rebuild a cosmetic in 3D, so they are the part worth protecting. They have no public URL: the only
way to get one is through this Worker, from the app, in a browser session that passed a Cloudflare Turnstile check.
Textures, shader data and icons stay on the public Pages shards. Gating those as well would cost about 150 Worker
requests per outfit instead of about 7, which Workers Free cannot carry (see Limits).

## What a request goes through

| Step | Rule | Answer when it fails |
| --- | --- | --- |
| Path | `/m/<host label>/models/….glb`. No dot or empty segments. | 404 |
| Origin | `Sec-Fetch-Site: same-origin`, so not another site, the address bar or a bare script. | 403 `cross-site` |
| Ban list | The client's IP tag or session is in the `bans` KV entry. | 403 `blocked` |
| Session | A signed `tfo_m` cookie from `POST /api/session`: HttpOnly, `Path=/m/`, `SameSite=Strict`, 6 h. | 401 `session` |
| Rate | 120 meshes a minute per session and 240 per IP (rate-limit bindings). | 429 `rate`, `Retry-After: 30` |
| Budget | 300 meshes per session (`Budget` Durable Object). | 401 `budget`; the cookie is cleared and the app passes a new check |
| Sessions | 6 new sessions a minute and 12 a day per IP. | 429 `rate` / `daily` |

- Meshes are served `Cache-Control: private` and `Cross-Origin-Resource-Policy: same-origin`. The browser keeps them,
  shared caches do not, and other sites cannot embed them.
- A missing mesh is a 404, never the app page the single-page-app fallback would return.
- If the Durable Object fails, the mesh is still served and the failure is logged (`budget-unavailable`). An outage
  must not take every mesh down.

The app side lives in `src/lib/mesh-gate.ts` and `src/lib/asset-fetch.ts`.
- With `VITE_MESH_BASE=/m/`, every mesh URL keeps its public-host form as its identity in the rig. Only the download is
  redirected to `/m/<host label>/<path>` (`gatedMeshPath` in `src/lib/asset-routing.mjs`).
- Turnstile runs in invisible mode. A small box appears only if Cloudflare asks for a click.

## Detection

Every mesh request, session and refusal writes one Analytics Engine row to the `tfo_mesh_log` dataset. The row holds
the session id, a salted IP tag, the country, the path, the refusal reason and the bytes. Raw IPs are never stored.

Two cron triggers run (`src/detect.ts`):
- **Every 10 minutes:** any IP tag or session with more than 300 meshes in the last hour is banned for 24 h, and so is
  any IP tag with more than 600 refusals. New bans post to the Discord webhook.
- **08:00 UTC daily:** a digest of the last 24 h (counts per event and reason, MB served, top 5 addresses) posts to
  Discord.

Detection is off until `ACCOUNT_ID` and `ANALYTICS_TOKEN` are set.

To unban, edit the `bans` JSON in KV and remove the key (`ip:<tag>` or `sid:<id>`). Git Bash, in `workers/site`:

```bash
npx --yes wrangler@4.131.1 kv key get bans --binding BANS --remote
npx --yes wrangler@4.131.1 kv key put bans '{}' --binding BANS --remote
```

## Limits (Workers Free, checked 5 Nov 2026)

| Resource | Free allowance | Use here |
| --- | --- | --- |
| Worker requests | 100,000 a day | Only `/m/*` and `/api/*`; app files are free static assets. A default outfit is 7 meshes. |
| Durable Object requests / rows written | 100,000 a day each | One request per mesh; a write every 5 meshes. |
| Analytics Engine | 100,000 rows a day, 10,000 queries | One row per mesh; 3 queries every 10 minutes. |
| Static assets | 20,000 files per version, 25 MiB each | About 2,450 (13 app files plus 2,425 meshes, largest 20.4 MB). |

Past the daily request quota, Cloudflare answers 429 before the Worker runs. The app then says 3D models have reached
today's free hosting limit. The quota resets at 00:00 UTC.

The same quota is also an attack surface: anyone can spend it with junk requests, and only a custom domain can block
them before they count (WAF rate-limit rule). That is the main thing a domain would add.

## What it does not stop

- Someone patient in a real browser can view items one at a time and save what loads. The aim is to make bulk
  collection slow, noisy and banned, not impossible.
- Textures, shader programs and reconstruction data remain public. The old Pages deployments also still hold every
  mesh until they are deleted, and each one publishes a `manifest.json` listing its files.

## Deploy (account-side steps; each needs the owner's go-ahead)

Git Bash in `workers/site`, unless noted. Before steps 4 and 5, check with the session that owns releases: an asset release
changes the hosts this stages from, and the site health check reads hosts from `deploy.yml`.

1. Done 6 Nov 2026: KV namespace `BANS`, id in `wrangler.jsonc`.
2. Done 10 Nov 2026: the Turnstile widget "the-finals-outfit mesh gate" (Managed, hostname
   `the-finals-outfit.chronohaxx.workers.dev`). Its public site key is `vars.TURNSTILE_SITEKEY` in `wrangler.jsonc`, and
   the staging script builds it in by default.
3. Secrets go up with the first deploy, so the Worker never runs without them. `.secrets.production.env` (gitignored)
   holds `SESSION_SECRET` (any long random string) and `TURNSTILE_SECRET` (the widget's secret key, pasted by the owner).
   Delete the file once the deploy succeeds; Cloudflare keeps the values.
4. Stage from the repo root. Each `--source` pairs a production host (from `deploy.yml` and the routes file) with the
   folder that was uploaded to it:

   ```bash
   node scripts/stage-site-worker.mjs --build --source <host>=<folder> ...
   ```

5. Deploy in `GATE_MODE: "log"`: nothing is refused, and every would-be refusal is recorded.

   ```bash
   npx --yes wrangler@4.131.1 deploy --secrets-file .secrets.production.env
   ```

6. Check the site, then turn detection on:
   - Create an API token with Account Analytics Read and set it with `secret put ANALYTICS_TOKEN`.
   - Set `ACCOUNT_ID`.
   - Optionally add a Discord webhook with `secret put DISCORD_WEBHOOK_URL`.
7. Once a day of logs shows no false refusals, including from hardened browsers (LibreWolf, Brave strict, Edge), set
   `GATE_MODE` to `"enforce"` and deploy again.

The app never blocks a download on Turnstile (`src/lib/mesh-gate.ts`). It gives the check a head start of up to 4 s,
then fetches anyway, and waits for a session only after a 401. A failed check is retried at most once a minute. So in
log mode a browser that fails Turnstile still gets every mesh. In enforce mode it sees the reason ("Cloudflare's bot
check failed…") instead of a hang.

Local run, with Turnstile's test keys:
- `.dev.vars` holds `SESSION_SECRET=<anything>` and `TURNSTILE_SECRET=1x0000000000000000000000000000000AA`.
- Stage with `--sitekey 1x00000000000000000000BB` (always passes) or `2x00000000000000000000AB` (always fails, which
  simulates a hardened browser).
- Start the Worker:

  ```bash
  npx --yes wrangler@4.131.1 dev --port 8799 --var GATE_MODE:enforce --var TURNSTILE_HOSTNAME_CHECK:0
  ```

  Pick a free port: other sessions' `wrangler dev` may hold 8787.
- Unit tests: `node --import tsx --test tests/site-worker.test.ts`.
