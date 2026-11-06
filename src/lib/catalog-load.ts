import { CATALOG_URLS } from "virtual:catalog-assets";
import { installCatalog } from "./catalog";
import type { CatalogData } from "./catalog-files";

// The catalog ships as separate content-hashed JSON files rather than inside the entry
// chunk, so it is cached independently of code changes and parsed as JSON, not as script.
// index.html preloads each file (vite.config.ts): the download starts while the HTML is
// still parsing, in parallel with the JavaScript, and these fetches pick up those
// responses. Without the preload they would start only after the entry chunk had
// downloaded and every module it imports had evaluated, queuing behind the JavaScript.
export async function loadCatalog(): Promise<void> {
  const files = await Promise.all(Object.entries(CATALOG_URLS).map(async ([key, url]) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Catalog file ${url} returned HTTP ${response.status}`);
    return [key, await response.json()] as const;
  }));
  installCatalog(Object.fromEntries(files) as CatalogData);
}
