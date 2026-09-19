import { readFileSync, existsSync } from "node:fs";
import { Agent, request as httpsRequest } from "node:https";
import { collectAssetRefs } from "./lib/asset-refs.mjs";
import { RECONSTRUCTION_ROOTS } from "./lib/reconstruction-assets.mjs";
import { catalogHostGroups } from "./lib/catalog-host-groups.mjs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { CatalogSchema, SponsorsSchema } from "../src/lib/item.ts";
import { SLOTS } from "../src/lib/slots.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const itemsPath = resolve(ROOT, "src/data/items.json");
const sponsorsPath = resolve(ROOT, "src/data/sponsors.json");
const publicDir = resolve(ROOT, "public");

const errors: string[] = [];
const warnings: string[] = [];

const rawItems = JSON.parse(readFileSync(itemsPath, "utf8"));
const rawSponsors = JSON.parse(readFileSync(sponsorsPath, "utf8"));

const itemsResult = CatalogSchema.safeParse(rawItems);
const sponsorsResult = SponsorsSchema.safeParse(rawSponsors);

if (!sponsorsResult.success) {
  for (const issue of sponsorsResult.error.issues) {
    errors.push(`sponsors.json ${issue.path.join(".")}: ${issue.message}`);
  }
}
if (!itemsResult.success) {
  for (const issue of itemsResult.error.issues) {
    errors.push(`items.json ${issue.path.join(".")}: ${issue.message}`);
  }
}

if (itemsResult.success && sponsorsResult.success) {
  const items = itemsResult.data;
  const sponsors = sponsorsResult.data;
  const sponsorIds = new Set(sponsors.map((s) => s.id));

  const seenIds = new Set<string>();
  const duplicates = new Set<string>();
  for (const item of items) {
    if (seenIds.has(item.id)) duplicates.add(item.id);
    seenIds.add(item.id);
  }
  for (const id of duplicates) errors.push(`duplicate item id: ${id}`);

  // Asset paths are base-relative (no leading slash) so they resolve either under the
  // site's own base or against VITE_ASSETS_BASE when assets are served off-repo.
  //
  // Two separate checks, because they answer different questions:
  //
  //   Shape   — a leading slash, or a non-relative path, is a catalog defect wherever
  //             it runs. Always an error.
  //   Presence— a missing *local* file is only a warning. Extracted assets are
  //             gitignored and never committed, so a CI checkout legitimately has none
  //             of them; failing here would mean the catalog could only be validated on
  //             a machine that already holds the extraction.
  //
  // Presence is instead enforced against the real host: set ASSETS_BASE and every
  // referenced path is fetched. That is the check that actually protects a deploy,
  // because a well-formed path pointing at nothing is exactly what local validation
  // cannot see. CI passes ASSETS_BASE, so a broken path fails the build rather than
  // shipping a 404.
  // Shared with stage-assets.mjs on purpose — see scripts/lib/asset-refs.mjs. When the
  // two derived their own lists, both missed the same six schema fields and the
  // validator vouched for an upload that was 6,245 files short.
  const referenced = collectAssetRefs(items) as Set<string>;

  for (const item of items) {
    if (item.sponsor && !sponsorIds.has(item.sponsor)) {
      errors.push(`item '${item.id}' references unknown sponsor '${item.sponsor}'`);
    }
    if (item.source === "Sponsor" && !item.sponsor) {
      warnings.push(`item '${item.id}' has source=Sponsor but no sponsor id`);
    }
    // Shape only. Presence is checked below, over the complete reference set rather
    // than over the handful of fields this loop happens to name.
    if (!/^https?:\/\//.test(item.imageUrl) && item.imageUrl.startsWith("/")) {
      errors.push(
        `item '${item.id}' imageUrl '${item.imageUrl}' must be base-relative (no leading slash)`,
      );
    }
  }

  const missingLocally = [...referenced].filter((p) => !existsSync(resolve(publicDir, p)));
  if (missingLocally.length > 0) {
    warnings.push(
      `${missingLocally.length} of ${referenced.size} referenced assets not present locally ` +
        `(served off-repo? e.g. ${missingLocally.slice(0, 3).join(", ")})`,
    );
  }

  const assetsBase = process.env.ASSETS_BASE?.trim();
  if (!assetsBase) {
    warnings.push(
      "ASSETS_BASE not set — asset presence was NOT verified against a host. " +
        "A well-formed path pointing at nothing will pass this run.",
    );
  } else {
    for (const { base, paths, reconstruction } of catalogHostGroups(referenced, assetsBase, process.env.MODELS_BASE)) {
      const reconstructionRoots = reconstruction ? RECONSTRUCTION_ROOTS : [];

      // Checked against a published manifest rather than by fetching every path.
      //
      // The exhaustive version was tried first and does not work at this scale: ~4,500
      // rapid requests trip Netlify's rate limiting, which answers 403, which reads as
      // "the asset is missing" and fails the build over files that return 200 the moment
      // you ask for one on its own. Retrying just made it slow as well as wrong. A gate
      // that cries wolf gets switched off, which is worse than no gate.
      //
      // So the host publishes manifest.json next to the assets and this diffs against it
      // — one request, exact, and immune to rate limiting. A manifest could in principle
      // lie about what was uploaded, so a small random sample is still fetched for real;
      // that is few enough requests to stay well under any limit.
      const agent = new Agent({ keepAlive: true, maxSockets: 4 });
      // node:https sends no User-Agent unless told to, and some hosts answer an
      // anonymous client differently. Be identifiable.
      const UA = "the-finals-outfit-catalog-validator";

      const head = (url: string) =>
        new Promise<number>((resolvePromise, reject) => {
          const opts = { method: "HEAD", agent, headers: { "user-agent": UA } };
          const req = httpsRequest(url, opts, (res) => {
            res.resume(); // drain, or the socket is never released back to the pool
            resolvePromise(res.statusCode ?? 0);
          });
          req.on("error", reject);
          req.setTimeout(20_000, () => req.destroy(new Error("timeout")));
          req.end();
        });

      const attempt = async (url: string): Promise<{ ok: true } | { ok: false; why: string }> => {
        let last = "";
        for (let tries = 0; tries < 4; tries++) {
          if (tries > 0) await new Promise((r) => setTimeout(r, 250 * 2 ** (tries - 1)));
          try {
            const status = await head(url);
            if (status >= 200 && status < 300) return { ok: true };
            if (status < 429) return { ok: false, why: String(status) };
            last = String(status); // 429 / 5xx — host is struggling, worth retrying
          } catch (err) {
            last = (err as Error).message;
          }
        }
        return { ok: false, why: last };
      };

      const getText = (url: string) =>
        new Promise<{ status: number; body: string }>((resolvePromise, reject) => {
          const req = httpsRequest(
            url,
            { method: "GET", agent, headers: { "user-agent": UA } },
            (res) => {
              let body = "";
              res.setEncoding("utf8");
              res.on("data", (c) => (body += c));
              res.on("end", () => resolvePromise({ status: res.statusCode ?? 0, body }));
            },
          );
          req.on("error", reject);
          req.setTimeout(30_000, () => req.destroy(new Error("timeout")));
          req.end();
        });

      const broken: string[] = [];
      const manifestUrl = `${base}manifest.json`;
      console.log(`checking ${paths.length} assets against ${manifestUrl} …`);

      let hosted: Set<string> | null = null;
      let reconstructionPaths: string[] = [];
      try {
        const res = await getText(manifestUrl);
        if (res.status !== 200) {
          errors.push(
            `manifest ${manifestUrl} returned ${res.status} — cannot verify assets. ` +
              `Run 'npm run stage:assets' and publish _assets-upload/ before deploying.`,
          );
        } else {
          const manifest = JSON.parse(res.body);
          hosted = new Set<string>(manifest.paths);
          reconstructionPaths = reconstruction ? manifest.reconstructionPaths ?? [] : [];
          if (reconstruction && (!Array.isArray(reconstructionPaths) || !reconstructionPaths.length ||
              reconstructionPaths.some((path: unknown) => typeof path !== 'string'))) {
            errors.push('Hosted release has no reconstruction asset manifest. Stage and publish the new runtime assets before deployment.');
            reconstructionPaths = [];
          }
        }
      } catch (err) {
        errors.push(`manifest ${manifestUrl} unreachable: ${(err as Error).message}`);
      }

      if (hosted) {
        for (const p of paths) {
          if (!hosted.has(p.replace(/^\/+/, ""))) broken.push(`not in manifest: ${p}`);
        }
        for (const p of [...reconstructionRoots, ...reconstructionPaths]) {
          if (!hosted.has(p)) broken.push(`reconstruction dependency not in manifest: ${p}`);
        }

        // The manifest is only as trustworthy as the upload it claims to describe, so
        // confirm a random handful really are served before believing the rest.
        const sample = [...new Set([
          ...paths.sort(() => Math.random() - 0.5).slice(0, 12),
          ...reconstructionRoots,
          ...reconstructionPaths.filter(p => /\.(glsl|bin)$/.test(p)).sort(() => Math.random() - 0.5).slice(0, 8),
        ])];
        for (const p of sample) {
          const res = await attempt(base + p.replace(/^\/+/, ""));
          if (!res.ok) broken.push(`${res.why} ${p} (manifest claims it is published)`);
        }
        console.log(`manifest lists ${hosted.size} files; spot-checked ${sample.length}`);
      }

      if (broken.length > 0) {
        broken.sort();
        for (const b of broken.slice(0, 10)) errors.push(`asset not published: ${b}`);
        if (broken.length > 10) {
          errors.push(`…and ${broken.length - 10} more assets not published`);
        }
      } else if (hosted) {
        console.log(`all ${paths.length} referenced assets are published at ${base}`);
      }
      agent.destroy();
    }
  }

  const perSlot: Record<string, number> = Object.fromEntries(
    SLOTS.map((s) => [s, 0]),
  );
  for (const item of items) perSlot[item.slot] = (perSlot[item.slot] ?? 0) + 1;

  console.log(`catalog: ${items.length} items across ${SLOTS.length} slots`);
  console.log(`sponsors: ${sponsors.length}`);
  console.log("items per slot:");
  for (const slot of SLOTS) {
    console.log(`  ${slot.padEnd(12)} ${perSlot[slot]}`);
  }
}

for (const w of warnings) console.warn(`warn: ${w}`);
for (const e of errors) console.error(`error: ${e}`);

if (errors.length > 0) {
  console.error(`\n${errors.length} error(s) — catalog invalid`);
  process.exit(1);
}
console.log(`\nOK${warnings.length ? ` (${warnings.length} warning(s))` : ""}`);
