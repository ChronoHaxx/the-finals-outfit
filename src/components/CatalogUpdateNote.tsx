import { CATALOG_UPDATE } from "../data/catalog-update";

export default function CatalogUpdateNote() {
  return <div aria-label="Catalog update" className="space-y-0.5 text-xs text-neutral-400">
    <p>Catalog updated <time dateTime={CATALOG_UPDATE.updatedAt}>{CATALOG_UPDATE.updatedLabel}</time></p>
    <p className="text-[11px] text-neutral-500">
      Includes Seasons 1–{CATALOG_UPDATE.throughSeason} · Season {CATALOG_UPDATE.nextSeason} update in progress
    </p>
  </div>;
}
