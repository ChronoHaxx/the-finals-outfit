import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { ROADMAP } from "virtual:roadmap";
import CatalogProgress from "../components/CatalogProgress";
import PatchNotes from "../components/PatchNotes";
import TopBar, { REPOSITORY_URL } from "../components/ProjectLinks";
import { useReconstructionProgress } from "../context/ReconstructionProgress";
import { formatPatchDate } from "../data/changelog";
import { fillRoadmapText, roadmapTokenValues, type RoadmapItem, type RoadmapSection } from "../lib/roadmap";

// Everything this page says about plans comes from ROADMAP.md (see vite.config.ts); only the
// layout and the live figures filled into its placeholders live here.
const sectionId = (stage: string) => `roadmap-${stage.toLowerCase().replace(/[^a-z]+/g, "-")}`;

function RoadmapEntry({ item, index, section, fill }: {
  item: RoadmapItem; index: number; section: RoadmapSection; fill: (text: string) => string;
}) {
  const current = section.stage === "Current focus";
  const done = section.stage === "Done";
  return <li className="border-b border-line">
    <details open={current && index === 0} className="group">
      <summary className="flex cursor-pointer list-none items-baseline gap-4 py-5 focus-visible:outline-offset-4 [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className={`display w-12 shrink-0 text-[34px] tabular-nums ${current ? "text-finals" : "text-ink-600"}`}>
          {done ? "✓" : String(index + 1).padStart(2, "0")}
        </span>
        <span className="min-w-0 flex-1 text-[20px] font-bold uppercase leading-tight tracking-[0.01em] [font-stretch:75%]">{fill(item.title)}</span>
        <span aria-hidden="true" className="hud text-fg-dim transition-transform group-open:rotate-45">+</span>
      </summary>
      <div className="space-y-3 pb-6 pl-16 text-sm leading-relaxed text-fg-muted">
        {item.description.map(paragraph => <p key={paragraph}>{fill(paragraph)}</p>)}
        {item.tasks.length > 0 && <ul className="space-y-1.5">
          {item.tasks.map(task => <li key={task} className="relative pl-4">
            <span aria-hidden="true" className="absolute left-0 top-[0.7em] h-px w-2 bg-finals" />{fill(task)}
          </li>)}
        </ul>}
        {item.doneWhen && <p><span className="font-semibold text-fg">Done when: </span>{fill(item.doneWhen)}</p>}
      </div>
    </details>
  </li>;
}

export default function Roadmap() {
  const location = useLocation();
  const heading = useRef<HTMLHeadingElement>(null);
  const { summary: { total, counts }, state } = useReconstructionProgress();
  const values = roadmapTokenValues(total, counts, state === "ready");
  const fill = (text: string) => fillRoadmapText(text, values);
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
        {ROADMAP.intro.map(paragraph => <p key={paragraph} className="max-w-2xl text-[15px] leading-relaxed text-fg-muted">{fill(paragraph)}</p>)}
        <p className="hud text-fg-dim">Roadmap reviewed <time dateTime={ROADMAP.reviewed}>{formatPatchDate(ROADMAP.reviewed)}</time></p>
      </header>

      <div className="space-y-4 border border-line bg-ink-900 p-4 sm:p-6">
        <CatalogProgress />
        <p className="text-xs leading-relaxed text-fg-dim">
          Counts follow the same statuses as the item picker. Colour variants count separately.
          Naming improvements do not change 3D status. Green records a check in a specific outfit and body type.
        </p>
      </div>

      {ROADMAP.sections.map(section => <section key={section.stage} aria-labelledby={sectionId(section.stage)}>
        <h2 id={sectionId(section.stage)} className="display text-[40px]">{section.stage}</h2>
        <ol className="mt-4 border-t border-line">
          {section.items.map((item, index) => <RoadmapEntry key={item.id} item={item} index={index} section={section} fill={fill} />)}
        </ol>
      </section>)}

      <section aria-label="All patch notes">
        <PatchNotes headingId="roadmap-notes" fresh={0} />
      </section>

      <footer className="space-y-2 border-t border-line pt-6 text-sm text-fg-muted">
        <p>Found something broken or want to help? <a href={`${REPOSITORY_URL}/issues`} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-fg">View or report an issue on GitHub</a>.</p>
        <p className="text-xs text-fg-dim">Fan-made project, unaffiliated with Embark Studios. THE FINALS is a trademark of Embark Studios AB.</p>
      </footer>
    </main>
  </div>;
}
