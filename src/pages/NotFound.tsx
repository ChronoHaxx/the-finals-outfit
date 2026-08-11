import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-full max-w-3xl flex-col items-start gap-4 px-5 py-10">
      <h1 className="text-2xl font-semibold">Not found</h1>
      <Link to="/" className="text-sm text-neutral-400 hover:text-neutral-200">
        &larr; Back to builder
      </Link>
    </main>
  );
}
