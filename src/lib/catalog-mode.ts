export const DEVELOPER_CATALOG_PATH = "thesecret-dev-mode-ganyu-only";

export function isDeveloperCatalogPath(pathname: string): boolean {
  return pathname.replace(/\/$/, "").split("/").at(-1) === DEVELOPER_CATALOG_PATH;
}

export const DEVELOPER_CATALOG = isDeveloperCatalogPath(
  (globalThis as { location?: { pathname: string } }).location?.pathname ?? "",
);
