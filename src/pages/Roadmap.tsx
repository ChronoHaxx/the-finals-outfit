import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import CatalogProgress from "../components/CatalogProgress";
import PatchNotes from "../components/PatchNotes";
import TopBar, { REPOSITORY_URL } from "../components/ProjectLinks";
import { useReconstructionProgress } from "../context/ReconstructionProgress";
import { ROADMAP } from "../data/roadmap";

export default function Roadmap() {
  const location = useLocation();
  const heading = useRef<HTMLHeadingElement>(null);
  const { summary: { total } } = useReconstructionProgress();
  useEffect(() => {
    const title = document.title;
    document.title = "Progress & roadmap · Outfit Builder";
    heading.current?.focus();
    window.scrollTo(0, 0);
    return () => { document.title = title; };
  }, []);
  return <div className="min-h-dvh">
    <TopBar page="roadmap" />
    <main className="mx-auto max-w-5xl space-y-12 px-4 py-8 sm:px-6 sm:py-12">
      <header className="space-y-4">
        <Link to={{ pathname: "/", search: location.search }} className="hud inline-block text-fg-muted transition-colors hover:text-fg">&larr; Back to your outfit</Link>
        <p className="hud flex items-center gap-2 text-fg-muted"><span aria-hidden="true" className="h-3 w-1 bg-finals" />Behind the scenes</p>
        <h1 ref={heading} tabIndex={-1} className="display text-[clamp(52px,9vw,96px)] outline-none">
          Progress <span className="text-finals">&amp;</span> roadmap
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-fg-muted">
          First goal: outfits that look broadly correct and work together on Medium.
          Fine visual detail, the remaining items and other body types follow.
        </p>
      </header>

      <div className="space-y-4 border border-line bg-ink-900 p-4 sm:p-6">
        <CatalogProgress />
        <p className="text-xs leading-relaxed text-fg-dim">
          Counts follow the same statuses as the item picker. Colour variants count separately.
          Naming improvements do not change 3D status. Green records a check in a specific outfit and body type.
        </p>
      </div>

      <section aria-labelledby="remaining-work">
        <h2 id="remaining-work" className="display text-[40px]">What comes next</h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-fg-muted">
          The current 80% target is {Math.ceil(total * 0.8).toLocaleString()} of {total.toLocaleString()} items passing usable-Medium checks.
          These are priorities; dates will follow measured batch results.
        </p>
        <ol className="mt-6 border-t border-line">
          {ROADMAP.map((step, index) => <li key={step.title} className="border-b border-line">
            <details open={index === 0} className="group">
              <summary className="flex cursor-pointer list-none items-baseline gap-4 py-5 focus-visible:outline-offset-4 [&::-webkit-details-marker]:hidden">
                <span aria-hidden="true" className={`display w-12 shrink-0 text-[34px] tabular-nums ${index === 0 ? "text-finals" : "text-ink-600"}`}>
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[20px] font-bold uppercase leading-tight tracking-[0.01em] [font-stretch:75%]">{step.title}</span>
                  <span className={`hud mt-1.5 block ${index === 0 ? "text-finals" : "text-fg-dim"}`}>{step.stage}</span>
                </span>
                <span aria-hidden="true" className="hud text-fg-dim transition-transform group-open:rotate-45">+</span>
              </summary>
              <div className="space-y-3 pb-6 pl-16 text-sm leading-relaxed text-fg-muted">
                <p>{step.description}</p>
                <ul className="space-y-1.5">
                  {step.tasks.map(task => <li key={task} className="relative pl-4">
                    <span aria-hidden="true" className="absolute left-0 top-[0.7em] h-px w-2 bg-finals" />{task}
                  </li>)}
                </ul>
                <p><span className="font-semibold text-fg">Done when: </span>{step.finish}</p>
              </div>
            </details>
          </li>)}
        </ol>
      </section>

      <section aria-label="All patch notes">
        <PatchNotes headingId="roadmap-notes" fresh={0} />
      </section>

      <footer className="space-y-2 border-t border-line pt-6 text-sm text-fg-muted">
        <p>Found something broken or want to help? <a href={`${REPOSITORY_URL}/issues`} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-fg">View or report an issue on GitHub</a>.</p>
        <p className="text-xs text-fg-dim">Fan-made project, unaffiliated with Embark Studios. THE FINALS is a trademark of Embark Studios AB. Physics and discovery tools above are planned work.</p>
      </footer>
    </main>
  </div>;
}
