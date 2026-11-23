import { useLayoutEffect, useRef, useState } from "react";
import { analyticsOptedOut, browserAnalyticsContext, setAnalyticsOptOut } from "../lib/analytics";
import { onOptOutChanged } from "../lib/track";
import { usePrivacyStore } from "../store/usePrivacyStore";
import { EyeOffIcon } from "./Icons";
import { PanelHeader } from "./ViewerPanel";

// The privacy note (23 Nov 2026; docs/analytics-tracking-plan.md, "Opt-out and privacy note"): what the site counts,
// with which tools, for how long, how to opt out, and where to ask. Opened from the welcome screen and the Guide sheet,
// over them. Keep its words in step with the plan and README.md ("Monitoring and visitor analytics").

const ISSUES_URL = "https://github.com/ChronoHaxx/the-finals-outfit/issues";

export default function PrivacyNote() {
  const open = usePrivacyStore(state => state.open);
  const hide = usePrivacyStore(state => state.hide);
  return open ? <PrivacySheet onClose={hide} /> : null;
}

function PrivacySheet({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [optedOut, setOptedOut] = useState(() => analyticsOptedOut());
  const [unsaved, setUnsaved] = useState(false);
  // The browser itself already asks not to be tracked: nothing is counted whatever the switch says.
  const [browserAsks] = useState(() => {
    try { const c = browserAnalyticsContext(); return c.globalPrivacyControl === true || c.doNotTrack === "1"; } catch { return false; }
  });

  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!element.open) element.showModal();
    return () => element.close();
  }, []);

  const toggle = () => {
    const next = !optedOut;
    setUnsaved(!setAnalyticsOptOut(next));
    setOptedOut(next);
    onOptOutChanged();
  };

  return (
    <dialog ref={dialog} aria-labelledby="privacy-title"
      onCancel={event => { event.preventDefault(); onClose(); }}
      onClose={() => { if (!dialog.current?.open) onClose(); }}
      className="fixed inset-0 m-0 size-full max-h-none max-w-none overflow-hidden bg-transparent p-0 text-fg">
      <div className="flex size-full items-end justify-center bg-ink-950/60 sm:items-center"
        onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
        <div className="panel flex max-h-[min(100dvh,40rem)] w-full animate-drop flex-col overflow-hidden motion-reduce:animate-none sm:w-[30rem]">
          <PanelHeader title="Privacy" icon={<EyeOffIcon size={13} />} onClose={onClose} closeLabel="Close the privacy note">
            <h2 id="privacy-title" className="sr-only">Privacy</h2>
          </PanelHeader>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4 text-[13px] leading-relaxed text-fg-muted">
            <p className="text-fg">This site counts how it is used, so I can see which features help and which nobody finds. It sets
              no cookies and stores nothing that identifies you.</p>
            <p><b className="text-fg">What is recorded:</b> which features you open and use; which items, emotes and looks you pick;
              whether you share or export; whether you are on a phone, tablet or computer; and errors, counted but not described.
              Never anything you type, and never what is in your links.</p>
            <p><b className="text-fg">Tools:</b> events go to Cloudflare Workers Analytics Engine, through a small counter I run.
              Page views, the referring site and load times go to Cloudflare Web Analytics.</p>
            <p><b className="text-fg">Daily visitors:</b> to count visitors without remembering anyone, your IP address and browser
              are mixed with a random key that is deleted the next day. Your IP address is never stored.</p>
            <p><b className="text-fg">How long:</b> events are deleted after 3 months. Monthly totals (counts, no individual events)
              are kept in the project's public documentation. Web Analytics keeps page views for the period in Cloudflare's own
              limits.</p>
            <p><b className="text-fg">Opt out:</b> turn on Global Privacy Control or Do Not Track in your browser, or use the switch
              below.</p>

            <label className="flex cursor-pointer items-start gap-3 border border-line bg-ink-900 p-3 text-fg">
              <input type="checkbox" checked={optedOut || browserAsks} disabled={browserAsks} onChange={toggle}
                className="mt-0.5 size-4 shrink-0 accent-[var(--color-finals)]" />
              <span>
                <span className="block font-semibold">Don't count my visits</span>
                <span className="block text-xs text-fg-muted">
                  {browserAsks ? "Your browser already asks sites not to track you, so nothing is counted."
                    : optedOut ? "Nothing more is sent from this page. Page views stop from your next visit."
                    : "Remembered in this browser by one setting that is the same for everyone who chooses it."}
                  {unsaved && " This browser would not keep the setting, so it lasts until you close the page."}
                </span>
              </span>
            </label>

            <p><b className="text-fg">Questions:</b> <a href={ISSUES_URL} target="_blank" rel="noreferrer"
              className="text-fg underline underline-offset-2 hover:text-white">open an issue on GitHub</a>.</p>
          </div>
        </div>
      </div>
    </dialog>
  );
}
