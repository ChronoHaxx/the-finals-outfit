import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <main className="stripes flex min-h-dvh flex-col items-start justify-center gap-5 px-6 sm:px-12">
      <p className="hud flex items-center gap-2 text-finals"><span aria-hidden="true" className="h-3 w-1 bg-finals" />Off air</p>
      <h1 className="display text-[clamp(64px,12vw,140px)]">Not found</h1>
      <Link to="/" className="hud border border-ink-600 px-4 py-3 text-fg transition-colors hover:border-fg">
        &larr; Back to builder
      </Link>
    </main>
  );
}
