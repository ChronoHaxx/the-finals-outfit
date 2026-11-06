import { Link, useParams } from "react-router-dom";

export default function Outfit() {
  const { code } = useParams<{ code: string }>();
  return (
    <main className="stripes flex min-h-dvh flex-col items-start justify-center gap-5 px-6 sm:px-12">
      <p className="hud flex items-center gap-2 text-fg-muted"><span aria-hidden="true" className="h-3 w-1 bg-finals" />Shared outfit</p>
      <h1 className="display text-[clamp(56px,10vw,120px)]">Coming soon</h1>
      <p className="text-sm text-fg-muted">
        Code: <span className="font-mono text-fg">{code}</span>
      </p>
      <p className="text-sm text-fg-dim">Decoding + preview lands in M4.</p>
      <Link to="/" className="hud border border-ink-600 px-4 py-3 text-fg transition-colors hover:border-fg">
        &larr; Back to builder
      </Link>
    </main>
  );
}
