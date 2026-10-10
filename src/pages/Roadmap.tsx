import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import CatalogProgress from "../components/CatalogProgress";
import { REPOSITORY_URL } from "../components/ProjectLinks";
import { useReconstructionProgress } from "../context/ReconstructionProgress";
import { ROADMAP } from "../data/roadmap";

export default function Roadmap() {
  const location = useLocation();
  const heading = useRef<HTMLHeadingElement>(null);
  const { summary: { total } } = useReconstructionProgress();
  useEffect(() => {
    const title = document.title;
    document.title = "Progress & roadmap · THE FINALS Outfit";
    heading.current?.focus();
    window.scrollTo(0, 0);
    return () => { document.title = title; };
  }, []);
  return <main className="mx-auto max-w-4xl space-y-8 px-4 py-6 sm:px-6 sm:py-10">
    <nav aria-label="Roadmap navigation" className="flex flex-wrap justify-between gap-3 text-sm text-neutral-400">
      <Link to={{ pathname: "/", search: location.search }} className="hover:text-white">&larr; Back to your outfit</Link>
      <a href={REPOSITORY_URL} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-white">GitHub repository</a>
    </nav>
    <header className="space-y-3">
      <h1 ref={heading} tabIndex={-1} className="text-3xl font-semibold outline-none">Progress &amp; roadmap</h1>
      <p className="max-w-2xl text-sm leading-relaxed text-neutral-400">
        First goal: outfits that look broadly correct and work together on Medium.
        Fine visual detail, the remaining items and other body types follow.
      </p>
    </header>
    <div className="space-y-4 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 sm:p-5">
      <CatalogProgress />
      <p className="text-xs leading-relaxed text-neutral-500">
        Counts follow the same statuses as the item picker. Colour variants count separately.
        Naming improvements do not change 3D status. Green records a check in a specific outfit and body type.
      </p>
    </div>
    <section aria-labelledby="remaining-work">
      <h2 id="remaining-work" className="text-xl font-medium">What comes next</h2>
      <p className="mt-2 text-sm leading-relaxed text-neutral-400">
        The current 80% target is {Math.ceil(total * 0.8).toLocaleString()} of {total.toLocaleString()} items passing usable-Medium checks.
        These are priorities; dates will follow measured batch results.
      </p>
      <ol className="mt-4 divide-y divide-neutral-800">
        {ROADMAP.map((step, index) => <li key={step.title} className="py-5">
          <details open={index === 0}>
            <summary className="cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-400">
              <span className="ml-1 text-base font-medium">{index + 1}. {step.title}</span>
              <span className={`ml-5 mt-1 block text-xs ${index === 0 ? "text-emerald-400" : "text-neutral-500"}`}>{step.stage}</span>
            </summary>
            <div className="ml-5 mt-3 space-y-3 text-sm leading-relaxed text-neutral-400">
              <p>{step.description}</p>
              <ul className="list-disc space-y-1 pl-5">
                {step.tasks.map(task => <li key={task}>{task}</li>)}
              </ul>
              <p><span className="font-medium text-neutral-300">Done when: </span>{step.finish}</p>
            </div>
          </details>
        </li>)}
      </ol>
    </section>
    <footer className="space-y-2 border-t border-neutral-800 pt-5 text-sm text-neutral-400">
      <p>Found something broken or want to help? <a href={`${REPOSITORY_URL}/issues`} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-white">View or report an issue on GitHub</a>.</p>
      <p className="text-xs text-neutral-500">Fan-made project, unaffiliated with Embark Studios. Physics and discovery tools above are planned work.</p>
    </footer>
  </main>;
}
