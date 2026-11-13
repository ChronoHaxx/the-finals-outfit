// Inline stroke icons in currentColor: no icon font, no extra requests, and they inherit
// the text colour of whatever state they sit in.
type IconProps = { className?: string; size?: number };
const base = (size: number, className?: string) => ({
  viewBox: "0 0 16 16", width: size, height: size, fill: "none", stroke: "currentColor",
  strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
  "aria-hidden": true, className,
});

export function HangerIcon({ className, size = 16 }: IconProps) {
  return <svg {...base(size, className)} strokeWidth={1.8}>
    <path d="M6.3 4.2a1.7 1.7 0 1 1 2.6 1.4c-.6.4-.9.8-.9 1.5v.4" />
    <path d="M8 7.5 1.8 11.6c-.5.4-.3 1.2.4 1.2h11.6c.7 0 .9-.8.4-1.2L8 7.5Z" />
  </svg>;
}

export function DiceIcon({ className, size = 16 }: IconProps) {
  return <svg {...base(size, className)}>
    <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
    <circle cx="5.5" cy="5.5" r=".6" fill="currentColor" />
    <circle cx="10.5" cy="10.5" r=".6" fill="currentColor" />
    <circle cx="8" cy="8" r=".6" fill="currentColor" />
  </svg>;
}

export function ResetIcon({ className, size = 16 }: IconProps) {
  return <svg {...base(size, className)}>
    <path d="M3 8a5 5 0 1 0 1.6-3.7" />
    <path d="M3 2.5v3h3" />
  </svg>;
}

export function SunIcon({ className, size = 16 }: IconProps) {
  return <svg {...base(size, className)}>
    <circle cx="8" cy="8" r="2.6" />
    <path d="M8 1.6v1.6M8 12.8v1.6M1.6 8h1.6M12.8 8h1.6M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M3.5 12.5l1.1-1.1M11.4 4.6l1.1-1.1" />
  </svg>;
}

export function ShareIcon({ className, size = 16 }: IconProps) {
  return <svg {...base(size, className)}>
    <path d="M6.5 9.5 9.5 6.5" />
    <path d="M7.5 4.5 9 3a2.8 2.8 0 0 1 4 4l-1.5 1.5" />
    <path d="M8.5 11.5 7 13a2.8 2.8 0 0 1-4-4l1.5-1.5" />
  </svg>;
}

export function FlagIcon({ className, size = 16 }: IconProps) {
  return <svg {...base(size, className)}>
    <path d="M3.5 14V2.5" />
    <path d="M3.5 3h8l-2 3 2 3h-8" />
  </svg>;
}

export function LockIcon({ closed, className, size = 14 }: IconProps & { closed: boolean }) {
  return <svg {...base(size, className)}>
    <rect x="3" y="7" width="10" height="7" rx="1.5" fill={closed ? "currentColor" : "none"} />
    <path d={closed ? "M5 7V5a3 3 0 0 1 6 0v2" : "M5 7V5a3 3 0 0 1 5.8-1"} />
  </svg>;
}

export function CloseIcon({ className, size = 16 }: IconProps) {
  return <svg {...base(size, className)}><path d="m4 4 8 8M12 4l-8 8" /></svg>;
}

// Full screen: viewfinder corners pointing out; exit: the same corners pointing in.
export function ExpandIcon({ className, size = 16 }: IconProps) {
  return <svg {...base(size, className)}><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" /></svg>;
}

export function CollapseIcon({ className, size = 16 }: IconProps) {
  return <svg {...base(size, className)}><path d="M6 2.5V6H2.5M13.5 6H10V2.5M10 13.5V10h3.5M2.5 10H6v3.5" /></svg>;
}

export function CheckIcon({ className, size = 12 }: IconProps) {
  return <svg {...base(size, className)} strokeWidth={2.4}><path d="m3.5 8.5 3 3 6-7" /></svg>;
}

export function ArrowIcon({ className, size = 16 }: IconProps) {
  return <svg {...base(size, className)}><path d="M3 8h10M9 4l4 4-4 4" /></svg>;
}

export function SearchIcon({ className, size = 14 }: IconProps) {
  return <svg {...base(size, className)}><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></svg>;
}

export function NotesIcon({ className, size = 16 }: IconProps) {
  return <svg {...base(size, className)}>
    <rect x="3" y="2" width="10" height="12" rx="1" />
    <path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" />
  </svg>;
}

export function GitHubIcon({ className, size = 16 }: IconProps) {
  return <svg viewBox="0 0 16 16" width={size} height={size} fill="currentColor" aria-hidden="true" className={className}>
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
  </svg>;
}

// Saved outfits.
export function ChevronIcon({ className, size = 12 }: IconProps) {
  return <svg {...base(size, className)} strokeWidth={2}><path d="m4 6 4 4 4-4" /></svg>;
}

export function PlusIcon({ className, size = 14 }: IconProps) {
  return <svg {...base(size, className)}><path d="M8 3v10M3 8h10" /></svg>;
}

export function PencilIcon({ className, size = 14 }: IconProps) {
  return <svg {...base(size, className)}><path d="m10.5 3 2.5 2.5L6 12.5 3 13l.5-3L10.5 3Z" /></svg>;
}

export function CopyIcon({ className, size = 14 }: IconProps) {
  return <svg {...base(size, className)}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1" />
    <path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
  </svg>;
}

export function TrashIcon({ className, size = 14 }: IconProps) {
  return <svg {...base(size, className)}>
    <path d="M2.5 4.5h11M6.5 4.5V3h3v1.5M4 4.5l.7 9h6.6l.7-9" />
  </svg>;
}

// Transport (the emote timeline): filled shapes read better than strokes at this size.
export function PlayIcon({ className, size = 14 }: IconProps) {
  return <svg {...base(size, className)} fill="currentColor" stroke="none"><path d="M4.5 2.8v10.4L13 8 4.5 2.8Z" /></svg>;
}

export function PauseIcon({ className, size = 14 }: IconProps) {
  return <svg {...base(size, className)} fill="currentColor" stroke="none"><path d="M4 3h3v10H4zM9 3h3v10H9z" /></svg>;
}

/** Repeat (the emote timeline's Loop): two arrows chasing each other round. */
export function LoopIcon({ className, size = 14 }: IconProps) {
  return <svg {...base(size, className)}>
    <path d="M2.5 7.5V6.5a2 2 0 0 1 2-2h8.5" />
    <path d="M11 2.5l2 2-2 2" />
    <path d="M13.5 8.5v1a2 2 0 0 1-2 2H3" />
    <path d="M5 13.5l-2-2 2-2" />
  </svg>;
}

/** One frame back (the bar on the left) or, with `forward`, one frame on. */
export function FrameStepIcon({ className, size = 14, forward }: IconProps & { forward?: boolean }) {
  return <svg {...base(size, className)} fill="currentColor" stroke="none">
    <g transform={forward ? "matrix(-1 0 0 1 16 0)" : undefined}><path d="M3 3h2v10H3zM13 3v10L6 8l7-5Z" /></g>
  </svg>;
}
