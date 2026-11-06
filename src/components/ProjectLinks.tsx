import { Link, useLocation } from "react-router-dom";
import { buildShareUrl } from "../lib/share-url";
import { DEVELOPER_CATALOG } from "../lib/catalog-mode";
import { useBuildStore } from "../store/useBuildStore";
import { useIntroStore } from "../store/useIntroStore";
import CatalogUpdateNote from "./CatalogUpdateNote";
import { GitHubIcon, HangerIcon, NotesIcon } from "./Icons";

export const REPOSITORY_URL = "https://github.com/ChronoHaxx/the-finals-outfit";

const navItem = "flex h-8 items-center gap-1.5 px-2.5 hud text-fg-muted transition-colors hover:text-fg aria-[current=page]:text-fg";

function Wordmark() {
  return <span className="flex items-center gap-2.5">
    <span aria-hidden="true" className="chamfer grid size-8 place-items-center bg-finals text-white [--cut:8px]">
      <HangerIcon size={18} />
    </span>
    <span className="leading-none">
      <span className="display block text-[22px] tracking-[0.01em]">Outfit Builder</span>
      <span className="hud mt-0.5 block text-[8.5px] text-fg-dim">Fan-made · for THE FINALS</span>
    </span>
  </span>;
}

// The app's one header. On the builder the wordmark is plain text: the picker does not write the
// edited outfit into the address bar, so a "home" link there could reload an older shared outfit.
export default function TopBar({ page }: { page: "builder" | "roadmap" }) {
  const build = useBuildStore(state => state.build);
  const showNotes = useIntroStore(state => state.show);
  const location = useLocation();
  // Carry the edited outfit in the route so Back still works after a roadmap reload.
  const query = page === "builder" ? new URL(buildShareUrl(window.location.href, build)).hash.slice(2) : "";
  return <header className="relative z-30 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-ink-950 px-3 sm:px-4">
    {page === "builder"
      ? <h1 aria-label={DEVELOPER_CATALOG ? "Developer cosmetic catalog" : "Cosmetic outfit builder"}><Wordmark /></h1>
      : <Link to={{ pathname: "/", search: location.search }} aria-label="Back to your outfit"><Wordmark /></Link>}
    {DEVELOPER_CATALOG && <span title="Full extracted catalog · internal names · may include unreleased items. Unlisted, publicly accessible."
      className="hud hidden border border-kept/40 px-1.5 py-1 text-kept sm:block">Dev catalog</span>}
    <div className="ml-auto hidden pr-2 xl:block"><CatalogUpdateNote /></div>
    <nav aria-label="Project links" className="-mr-1.5 ml-auto flex items-center xl:ml-0 xl:border-l xl:border-line xl:pl-2">
      <button type="button" onClick={showNotes} className={navItem}>
        <NotesIcon size={14} /><span className="hidden sm:inline">Patch notes</span><span className="sm:hidden">Notes</span>
      </button>
      <Link to={page === "builder" ? `/roadmap${query}` : { pathname: "/roadmap", search: location.search }}
        aria-current={page === "roadmap" ? "page" : undefined} className={navItem}>Roadmap</Link>
      <a href={REPOSITORY_URL} target="_blank" rel="noreferrer" aria-label="GitHub repository" className={navItem}>
        <GitHubIcon size={16} />
      </a>
    </nav>
  </header>;
}
