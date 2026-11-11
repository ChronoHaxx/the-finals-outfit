// Client side of the mesh gate (workers/site). With VITE_MESH_BASE set, every .glb is downloaded from the site Worker
// instead of its public host (gatedMeshPath: <base><host label>/<path>), and the Worker only serves a browser holding a
// session cookie. The cookie comes from POST /api/session after a Cloudflare Turnstile check, which is invisible for
// almost everyone: a small box appears only when Cloudflare wants a click.
//
// The cookie is HttpOnly (scripts cannot read or copy it) and scoped to /m/, so this module only tracks when the
// session it asked for expires. A 401 from the gate (missing, expired or spent session) asks for a new one once.

import { gatedMeshPath } from "./asset-routing.mjs";

// Optional chaining: Node runs the asset-fetch tests without Vite, where import.meta.env does not exist.
const MESH_BASE = import.meta.env?.VITE_MESH_BASE?.trim() ?? "";
const SITEKEY = import.meta.env?.VITE_TURNSTILE_SITEKEY?.trim() ?? "";
const ACTION = "mesh-session";
const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface Turnstile {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  remove(widgetId: string): void;
}
declare global { interface Window { turnstile?: Turnstile } }

/** A refusal the user can act on, worded for the loading/error UI rather than for a log. */
export class MeshGateError extends Error {}

/** Where a mesh URL is downloaded from when the gate is on; null for anything that is not a gated mesh. */
export function gatedUrl(url: string): string | null {
  if (!MESH_BASE) return null;
  const path = gatedMeshPath(new URL(url, window.location.href).href);
  return path ? new URL(path, new URL(MESH_BASE, window.location.href)).href : null;
}

let script: Promise<void> | null = null;
function loadTurnstile(): Promise<void> {
  script ??= new Promise<void>((resolve, reject) => {
    const tag = document.createElement("script");
    tag.src = SCRIPT;
    tag.async = true;
    tag.onload = () => resolve();
    tag.onerror = () => { script = null; tag.remove(); reject(new MeshGateError("Could not load Cloudflare's bot check. Check your connection or content blocker, then try again.")); };
    document.head.appendChild(tag);
  });
  return script;
}

async function turnstileToken(): Promise<string> {
  if (!SITEKEY) throw new MeshGateError("3D models are unavailable: this build has no bot-check site key.");
  await loadTurnstile();
  const turnstile = window.turnstile;
  if (!turnstile) throw new MeshGateError("Cloudflare's bot check did not start. Reload the page to try again.");
  return new Promise<string>((resolve, reject) => {
    // Shown only if Cloudflare asks for an interaction (appearance: interaction-only).
    const host = document.createElement("div");
    host.setAttribute("aria-label", "Bot check for loading 3D models");
    Object.assign(host.style, { position: "fixed", right: "16px", bottom: "16px", zIndex: "2147483000" });
    document.body.appendChild(host);
    let id = "";
    const done = (finish: () => void) => { try { if (id) turnstile.remove(id); } catch { /* already gone */ } host.remove(); finish(); };
    id = turnstile.render(host, {
      // No automatic retry: the widget is removed on failure, and a retry would reset a container that no longer exists.
      sitekey: SITEKEY, action: ACTION, appearance: "interaction-only", "refresh-expired": "never", retry: "never",
      callback: (token: string) => done(() => resolve(token)),
      "error-callback": () => { done(() => reject(new MeshGateError("Cloudflare's bot check failed. Reload the page to try again."))); return true; },
      "timeout-callback": () => done(() => reject(new MeshGateError("Cloudflare's bot check timed out. Reload the page to try again."))),
    });
  });
}

const REFUSALS: Record<string, string> = {
  rate: "Too many new sessions from your connection. Wait a minute, then try again.",
  daily: "Your connection has used today's 3D sessions. Try again tomorrow.",
  blocked: "3D models are blocked for your connection after unusually heavy downloading.",
  check: "Cloudflare's bot check was not accepted. Reload the page to try again.",
};

async function mint(): Promise<number> {
  const token = await turnstileToken();
  const response = await fetch(new URL("/api/session", new URL(MESH_BASE, window.location.href)), {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }), credentials: "same-origin",
  });
  if (!response.ok) {
    const reason = await response.json().then((b: { error?: string }) => b.error ?? "", () => "");
    throw new MeshGateError(REFUSALS[reason] ?? `Could not start a 3D session (${response.status}). Try again later.`);
  }
  return Number(((await response.json()) as { expiresAt?: number }).expiresAt) || Date.now() + 3600_000;
}

// The session never blocks a download outright. Hardened browsers (LibreWolf with resistFingerprinting, strict content
// blockers) can fail or stall Turnstile, and in the gate's log mode a mesh downloads without any session. So a download
// gives the check a short head start, then goes ahead; only a 401 from the gate makes it wait for a session, and a
// failed check is not retried for a minute, so one page load cannot start a Turnstile check per mesh.
const HEAD_START_MS = 4000;
const RETRY_AFTER_FAILURE_MS = 60_000;

interface Session { promise: Promise<number>; status: "pending" | "ok" | "failed"; expiresAt: number; at: number }
let current: Session | null = null;

function begin(): Session {
  const session: Session = { promise: mint(), status: "pending", expiresAt: 0, at: Date.now() };
  session.promise.then(
    expiresAt => { session.status = "ok"; session.expiresAt = expiresAt; },
    () => { session.status = "failed"; session.at = Date.now(); });
  return current = session;
}

function live(): Session {
  const now = Date.now();
  if (!current) return begin();
  if (current.status === "ok" && now > current.expiresAt - 60_000) return begin(); // about to expire
  if (current.status === "failed" && now - current.at > RETRY_AFTER_FAILURE_MS) return begin();
  return current;
}

/** Starts (or reuses) a session and waits for it at most a few seconds. Never throws. */
export async function meshSessionHeadStart(): Promise<void> {
  const session = live();
  if (session.status !== "pending") return;
  await Promise.race([session.promise.then(() => {}, () => {}),
    new Promise<void>(resolve => setTimeout(resolve, HEAD_START_MS))]);
}

/** After a 401: a session this page held is gone (expired or spent), so mint another; otherwise wait for the pending one.
 *  Throws the reason there is none (a failed check within the last minute is not retried). Concurrent callers share it. */
export async function renewMeshSession(): Promise<void> {
  if (current?.status === "ok") current = null;
  await live().promise;
}

export function meshRefusal(status: number, reason: string): MeshGateError | null {
  if (status === 403 && reason === "blocked") return new MeshGateError(REFUSALS.blocked);
  if (status === 403) return new MeshGateError("3D models refused this request. Reload the page to try again.");
  if (status === 429 && reason === "rate") return new MeshGateError("You're loading 3D models very quickly. Wait a minute, then try again.");
  // Not the gate's own JSON: Cloudflare refused before the Worker ran, which on Workers Free means the daily request
  // quota is spent. It resets at 00:00 UTC.
  if (status === 429) return new MeshGateError("3D models have reached today's free hosting limit. They return after midnight UTC.");
  return null;
}
