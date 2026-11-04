import { CATALOG_UPDATE } from "../data/catalog-update";

export default function CatalogUpdateNote() {
  return <p aria-label="Catalog update" className="hud shrink-0 text-fg-dim">
    <span className="text-fg-muted">Seasons 1–{CATALOG_UPDATE.throughSeason}</span>
    {" · "}Updated <time dateTime={CATALOG_UPDATE.updatedAt}>{CATALOG_UPDATE.updatedLabel}</time>
    {" · "}S{CATALOG_UPDATE.nextSeason} in progress
  </p>;
}
