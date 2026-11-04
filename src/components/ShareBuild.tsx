import { useEffect, useRef, useState } from "react";
import { useBuildStore } from "../store/useBuildStore";
import { buildShareUrl, type ShareStyle } from "../lib/share-url";
import { previewLink, SHARE_PREVIEW_BASE, sharePreviewAvailable, shortCode } from "../lib/share-preview";
import { CloseIcon, ShareIcon } from "./Icons";

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

// One click copies the link. The panel that opens shows what was copied and lets you switch style.
export default function ShareBuild() {
  const build = useBuildStore(s => s.build);
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const [copiedLink, setCopiedLink] = useState("");
  const [style, setStyle] = useState<LinkStyle>(SHARE_PREVIEW_BASE ? "preview" : "short");
  const [preview, setPreview] = useState<{ code: string; url: string } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  // Derive from the current selection so an already-open copy box never goes stale.
  const short = buildShareUrl(window.location.href, build, "short");
  const code = shortCode(short);
  const link = style === "preview" ? (preview && preview.code === code ? preview.url : short)
    : buildShareUrl(window.location.href, build, style);
  const status = message.startsWith("Link copied") && copiedLink !== link ? "Link changed · copy again" : message;

  const share = async () => {
    setOpen(true);
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

  // Close on Escape or a press outside the control.
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);

  return <div ref={root} className="relative">
    <button type="button" onClick={share} aria-expanded={open}
      className="chamfer flex h-11 items-center gap-2 whitespace-nowrap bg-finals pl-3.5 pr-4 sm:pl-4 sm:pr-5 text-[18px] font-extrabold uppercase tracking-[0.02em] text-white transition-colors [--cut:11px] [font-stretch:70%] hover:bg-finals-hi active:translate-y-px">
      <ShareIcon size={16} /><span className="sm:hidden">Share</span><span className="hidden sm:inline">Share outfit</span>
    </button>
    {/* Always mounted, so screen readers hear each copy result even while the panel is closed. */}
    <span role="status" className="sr-only">{status}</span>
    {open && <div className="absolute bottom-[calc(100%+8px)] right-0 z-40 w-[min(calc(100vw-1.5rem),23rem)] animate-rise border border-ink-600 bg-ink-850 p-3 shadow-[0_18px_40px_-12px_rgb(0_0_0/0.8)]">
      <div className="flex items-center justify-between gap-3">
        <p aria-hidden="true" className={`text-sm font-medium ${status.startsWith("Link copied") ? "text-fg" : "text-fg-muted"}`}>{status || "Share outfit"}</p>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close share panel" className="-mr-1 grid size-7 place-items-center text-fg-dim hover:text-fg">
          <CloseIcon size={14} />
        </button>
      </div>
      <div className="mt-3 flex gap-1.5">
        <input aria-label="Outfit share link" readOnly value={link} onFocus={e => e.currentTarget.select()}
          className="h-9 min-w-0 flex-1 border border-line bg-ink-950 px-2 font-mono text-xs text-fg-muted outline-none focus:border-ink-600" />
        <button type="button" onClick={share} className="hud h-9 shrink-0 bg-fg px-3 text-ink-950 hover:bg-white">Copy</button>
      </div>
      <label className="mt-3 flex items-center justify-between gap-3">
        <span className="hud text-fg-dim">Link style</span>
        <select aria-label="Share link style" value={style} onChange={e => setStyle(e.target.value as LinkStyle)}
          className="select-plain h-9 border border-line bg-ink-950 pl-2.5 text-xs text-fg-muted">
          {SHARE_PREVIEW_BASE && <option value="preview">Link with preview image</option>}
          <option value="short">Short link</option>
          <option value="names">Item names in link</option>
        </select>
      </label>
    </div>}
  </div>;
}
