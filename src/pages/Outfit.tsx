import { Link, useParams } from "react-router-dom";

export default function Outfit() {
  const { code } = useParams<{ code: string }>();
  return (
    <main className="mx-auto flex min-h-full max-w-3xl flex-col gap-6 px-5 py-10">
      <Link to="/" className="text-sm text-neutral-400 hover:text-neutral-200">
        &larr; Back to builder
      </Link>
      <h1 className="text-2xl font-semibold">Shared outfit</h1>
      <p className="text-sm text-neutral-400">
        Code: <span className="font-mono">{code}</span>
      </p>
      <p className="text-sm text-neutral-500">
        Decoding + preview lands in M4.
      </p>
    </main>
  );
}
