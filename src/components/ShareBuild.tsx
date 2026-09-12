import { useState } from "react";
import { useBuildStore } from "../store/useBuildStore";
import { buildShareUrl, type ShareStyle } from "../lib/share-url";

export default function ShareBuild() {
  const build = useBuildStore(s => s.build);
  const [message, setMessage] = useState("");
  const [showLink, setShowLink] = useState(false);
  const [copiedLink, setCopiedLink] = useState("");
  const [style, setStyle] = useState<ShareStyle>("short");
  // Derive from the current selection so an already-open copy box never goes stale.
  const link = buildShareUrl(window.location.href, build, style);
  return <div className="flex flex-wrap items-center gap-2">
    <button className="rounded-lg bg-neutral-800 px-3 py-2 text-xs text-neutral-100 hover:bg-neutral-700"
      onClick={async () => {
        setShowLink(true);
        try { await navigator.clipboard.writeText(link); setCopiedLink(link); setMessage("Link copied"); }
        catch { setMessage("Copy the link below"); }
      }}>Share outfit</button>
    <select aria-label="Share link style" value={style} onChange={e => setStyle(e.target.value as ShareStyle)}
      className="rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-2 text-xs text-neutral-300">
      <option value="short">Short link</option>
      <option value="names">Item names in link</option>
    </select>
    <span role="status" className="text-xs text-neutral-400">{message === "Link copied" && copiedLink !== link ? "Link changed · copy again" : message}</span>
    {showLink && <input aria-label="Outfit share link" readOnly value={link} onFocus={e => e.currentTarget.select()}
      className="min-w-0 flex-1 basis-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-300 sm:basis-0" />}
  </div>;
}
