import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { useBuildStore } from "../store/useBuildStore";
import { buildShareUrl, type ShareStyle } from "../lib/share-url";
import { previewKeptView, previewLink, SHARE_PREVIEW_BASE, sharePreviewAvailable, shortCode, uploadQuery } from "../lib/share-preview";
import { formatView, shareableView, subscribeCamera, type CameraView } from "../lib/camera-view";
import { formatPoseTime, poseKey, type PoseCapture } from "../lib/share-pose";
import { getPoseCapture, subscribePose } from "../lib/viewer-handle";
import { bodyTypeShareCode } from "../lib/body-type";
import { playerNumberShareCode } from "../lib/player-number";
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

// The cache identity of a preview: the outfit code, the body type, the player number, the exact frame its card shows
// and the camera the link opens on.
const previewKey = (code: string | null, pose: PoseCapture | null, bodyType: string | undefined,
  playerNumber: string | undefined, view: CameraView | null) =>
  code === null ? "" : uploadQuery(code, pose, bodyType, playerNumber, view);
const noSubscription = () => () => {};
const viewKey = (view: CameraView | null) => view ? formatView(view) : "";
/** "0.62, 1.42, 3.1 · roll −8°" */
const describeView = (view: CameraView) => `${view.position.join(", ")}${view.roll
  ? ` · roll ${view.roll < 0 ? "−" : ""}${Math.abs(view.roll)}°` : ""}`;

// One click copies the link. The panel that opens shows what was copied and lets you switch style.
//
// Poses (10 Nov 2026): when an emote is on screen (playing or paused), or the idle is paused, the link records that
// frame and the preview card shows it. The frame is read at the click, in the same task as the card's render, so the
// two always agree even while the emote plays on. "Include this frame" leaves it out.
//
// Camera views (21 Nov 2026): when the camera is off the default framing, the link opens on the camera you see (its
// position, target and roll: lib/camera-view.ts), so someone else can start from your shot. "Include camera view"
// leaves it out. The preview card stays the same four views either way.
export default function ShareBuild() {
  const build = useBuildStore(s => s.build);
  const bodyType = useBuildStore(s => s.bodyType);
  const playerNumber = useBuildStore(s => s.playerNumber);
  const look = { build, bodyType, playerNumber };
  const bt = bodyTypeShareCode(bodyType);
  const pn = playerNumberShareCode(playerNumber);
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const [copiedLink, setCopiedLink] = useState("");
  const [style, setStyle] = useState<LinkStyle>(SHARE_PREVIEW_BASE ? "preview" : "short");
  const [preview, setPreview] = useState<{ key: string; url: string } | null>(null);
  const [withPose, setWithPose] = useState(true);
  // The pose of the last copy (a playing emote moves on; the panel keeps showing the frame that was copied).
  const [copiedPose, setCopiedPose] = useState<PoseCapture | null>(null);
  const [withView, setWithView] = useState(true);
  // The camera of the last copy, and the camera now (followed only while the panel is open: it moves every frame).
  const [copiedView, setCopiedView] = useState<CameraView | null>(null);
  const liveView = useSyncExternalStore(open ? subscribeCamera : noSubscription, () => viewKey(shareableView()));
  // What is on screen now, as "has it changed": a clip and its paused frame, or a clip playing (see poseKey).
  const livePose = useSyncExternalStore(subscribePose, () => poseKey(getPoseCapture()));
  const root = useRef<HTMLDivElement>(null);
  const pose = withPose ? copiedPose : null;
  const view = withView ? copiedView : null;
  // Derive from the current selection so an already-open copy box never goes stale.
  const short = buildShareUrl(window.location.href, look, "short", pose, view);
  const code = shortCode(short);
  const link = style === "preview" ? (preview && preview.key === previewKey(code, pose, bt, pn, view) ? preview.url : short)
    : buildShareUrl(window.location.href, look, style, pose, view);
  const poseMoved = withPose && livePose !== poseKey(copiedPose);
  const viewMoved = withView && open && liveView !== viewKey(copiedView);
  const status = message.startsWith("Link copied") && (copiedLink !== link || poseMoved || viewMoved)
    ? "Link changed · copy again" : message;

  const share = async () => {
    // Everything up to the first await runs in this click's task: the pose read here and the card rendered by
    // previewLink are the same frame, whatever the animation does next.
    const capture = getPoseCapture();
    const now = withPose ? capture : null;
    setCopiedPose(capture);
    const camera = shareableView();
    const viewNow = withView ? camera : null;
    setCopiedView(camera);
    setOpen(true);
    const shortNow = buildShareUrl(window.location.href, look, "short", now, viewNow);
    const codeNow = shortCode(shortNow);
    let result: Promise<{ url: string; note: string }>;
    if (style !== "preview" || !codeNow)
      result = Promise.resolve({ url: buildShareUrl(window.location.href, look, style === "preview" ? "short" : style, now, viewNow),
        note: now ? `Link copied · opens on frame ${now.frame}` : "Link copied" });
    else if (!sharePreviewAvailable()) result = Promise.resolve({ url: shortNow, note: "Outfit still loading · plain link copied" });
    else {
      setMessage("Making preview…");
      result = previewLink(codeNow, now, bt, pn, viewNow).then(url => {
        setPreview({ key: previewKey(codeNow, now, bt, pn, viewNow), url });
        // A share Worker from before camera views opens the right outfit on the default framing: say so.
        if (viewNow && !previewKeptView(url)) return { url, note: "Link copied · preview links can’t keep the camera yet (Short link can)" };
        return { url, note: now ? `Link copied · preview shows frame ${now.frame}` : "Link copied · with preview image" };
      }, error => { console.warn("[share preview]", error); return { url: shortNow, note: "Preview unavailable · plain link copied" }; });
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

  // In the items drawer the panel can open past the drawer's visible part (on a phone the Share button can sit at the
  // sheet's bottom edge): scroll the drawer just enough to show it, never past its top. Only the drawer's own scroller
  // moves; nothing else on the page scrolls.
  const popover = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const panel = popover.current, scroller = panel?.closest<HTMLElement>("[data-drawer-scroll]");
    if (!open || !panel || !scroller || !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) return;
    const p = panel.getBoundingClientRect(), s = scroller.getBoundingClientRect(), gap = 8;
    const down = Math.min(p.bottom + gap - s.bottom, p.top - gap - s.top), up = s.top - (p.top - gap);
    const top = down > 0 ? down : up > 0 ? -up : 0;
    if (top) scroller.scrollBy({ top, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [open]);

  return <div ref={root} className="relative">
    <button type="button" onClick={share} aria-expanded={open}
      className="chamfer flex h-11 items-center gap-2 whitespace-nowrap bg-finals pl-3.5 pr-4 sm:pl-4 sm:pr-5 text-[18px] font-extrabold uppercase tracking-[0.02em] text-white transition-colors [--cut:11px] [font-stretch:70%] hover:bg-finals-hi active:translate-y-px">
      <ShareIcon size={16} /><span className="sm:hidden">Share</span><span className="hidden sm:inline">Share outfit</span>
    </button>
    {/* Always mounted, so screen readers hear each copy result even while the panel is closed. */}
    <span role="status" className="sr-only">{status}</span>
    {/* Opens upwards over the picker on desktop (the outfit sits at the drawer's foot); on phones the outfit heads the
        items sheet, whose top would clip it, so it opens downwards. */}
    {open && <div ref={popover} className="absolute bottom-[calc(100%+8px)] right-0 z-40 max-lg:bottom-auto max-lg:top-[calc(100%+8px)] w-[min(calc(100vw-1.5rem),23rem)] animate-rise border border-ink-600 bg-ink-850 p-3 shadow-[0_18px_40px_-12px_rgb(0_0_0/0.8)]">
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
      {copiedPose && <label className="mt-3 flex items-center gap-2.5 text-xs text-fg-muted">
        <input type="checkbox" checked={withPose} onChange={e => setWithPose(e.target.checked)} className="size-4 accent-finals" />
        <span className="min-w-0">Include this frame
          <span className="block truncate text-fg-dim">
            {copiedPose.label} · {formatPoseTime(copiedPose.time)} s · frame {copiedPose.frame}{copiedPose.paused ? " · paused" : ""}
          </span>
        </span>
      </label>}
      {copiedView && <label className="mt-3 flex items-center gap-2.5 text-xs text-fg-muted">
        <input type="checkbox" checked={withView} onChange={e => setWithView(e.target.checked)} className="size-4 accent-finals" />
        <span className="min-w-0">Include camera view
          <span className="block truncate text-fg-dim">Opens from {describeView(copiedView)}</span>
        </span>
      </label>}
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
