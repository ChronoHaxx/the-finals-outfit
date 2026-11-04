// The browser fetches the catalog (src/lib/catalog-load.ts); Node tests install the same
// shipped data from disk, through the same validation and projection as the build.
// Import this before anything that reads the catalog.
import { readFileSync } from "node:fs";
import { CATALOG_FILES, shippedCatalogJson, type CatalogData, type CatalogFileKey } from "../../src/lib/catalog-files";
import { installCatalog } from "../../src/lib/catalog";

const root = new URL("../../", import.meta.url);
installCatalog(Object.fromEntries(Object.entries(CATALOG_FILES).map(([key, { path }]) =>
  [key, JSON.parse(shippedCatalogJson(key as CatalogFileKey, readFileSync(new URL(path, root), "utf8")))])) as CatalogData);
