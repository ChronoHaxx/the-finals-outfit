import { useState } from "react";
import { useBuildStore } from "../store/useBuildStore";
import { buildShareUrl, type ShareStyle } from "../lib/share-url";
import { previewLink, SHARE_PREVIEW_BASE, sharePreviewAvailable, shortCode } from "../lib/share-preview";

type LinkStyle = ShareStyle | "preview";

// Copies a link that may still be on its way. ClipboardItem takes a promise, which keeps the click's permission
// in Safari while the preview renders and uploads; elsewhere it falls back to writing the finished text.
async function copyText(text: Promise<string>): Promise<string> {
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": text.then(t => new Blob([t], { type: "text/plain" })) })]);
      return await text;
    } catch { /* fall through */ }
  }
  const value = await text;
  await navigator.clipboard.writeText(value);
  return value;
}

export default function ShareBuild() {
  const build = useBuildStore(s => s.build);
  const [message, setMessage] = useState("");
  const [showLink, setShowLink] = useState(false);
  const [copiedLink, setCopiedLink] = useState("");
  const [style, setStyle] = useState<LinkStyle>(SHARE_PREVIEW_BASE ? "preview" : "short");
  const [preview, setPreview] = useState<{ code: string; url: string } | null>(null);
  // Derive from the current selection so an already-open copy box never goes stale.
  const short = buildShareUrl(window.location.href, build, "short");
  const code = shortCode(short);
  const link = style === "preview" ? (preview && preview.code === code ? preview.url : short)
    : buildShareUrl(window.location.href, build, style);

  const share = async () => {
    setShowLink(true);
    let result: Promise<{ url: string; note: string }>;
    if (style !== "preview" || !code) result = Promise.resolve({ url: link, note: "Link copied" });
    else if (!sharePreviewAvailable()) result = Promise.resolve({ url: short, note: "Outfit still loading · plain link copied" });
    else {
      setMessage("Making preview…");
      result = previewLink(code).then(url => { setPreview({ code, url }); return { url, note: "Link copied · with preview image" }; },
        error => { console.warn("[share preview]", error); return { url: short, note: "Preview unavailable · plain link copied" }; });
    }
    try {
      const copied = await copyText(result.then(r => r.url));
      setCopiedLink(copied);
      setMessage((await result).note);
    } catch {
      await result;
      setMessage("Copy the link below");
    }
  };

  return <div className="flex flex-wrap items-center gap-2">
    <button className="rounded-lg bg-neutral-800 px-3 py-2 text-xs text-neutral-100 hover:bg-neutral-700"
      onClick={share}>Share outfit</button>
    <select aria-label="Share link style" value={style} onChange={e => setStyle(e.target.value as LinkStyle)}
      className="rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-2 text-xs text-neutral-300">
      {SHARE_PREVIEW_BASE && <option value="preview">Link with preview image</option>}
      <option value="short">Short link</option>
      <option value="names">Item names in link</option>
    </select>
    <span role="status" className="text-xs text-neutral-400">{message.startsWith("Link copied") && copiedLink !== link ? "Link changed · copy again" : message}</span>
    {showLink && <input aria-label="Outfit share link" readOnly value={link} onFocus={e => e.currentTarget.select()}
      className="min-w-0 flex-1 basis-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-300 sm:basis-0" />}
  </div>;
}
