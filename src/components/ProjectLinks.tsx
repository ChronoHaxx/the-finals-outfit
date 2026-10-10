import { Link } from "react-router-dom";
import { buildShareUrl } from "../lib/share-url";
import { useBuildStore } from "../store/useBuildStore";

export const REPOSITORY_URL = "https://github.com/ChronoHaxx/the-finals-outfit";

export default function ProjectLinks() {
  const build = useBuildStore(state => state.build);
  // Carry the edited outfit in the route so Back still works after a roadmap reload.
  const query = new URL(buildShareUrl(window.location.href, build)).hash.slice(2);
  return <nav aria-label="Project links" className="flex justify-end gap-4 text-xs text-neutral-400">
    <Link to={`/roadmap${query}`} className="underline underline-offset-2 hover:text-neutral-100">Progress &amp; roadmap</Link>
    <a href={REPOSITORY_URL} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-neutral-100">GitHub</a>
  </nav>;
}
