// This is Cloudflare's public beacon identifier, not an API credential.
const token = "6a2a3a43ff454685a6a0c76a18b2e139";

export function startAnalytics() {
  // Keep local previews and forks out of the production visitor counts.
  if (location.hostname !== "chronohaxx.github.io" ||
      !location.pathname.startsWith("/the-finals-outfit/") ||
      document.querySelector("script[data-cf-beacon]")) return;

  const script = document.createElement("script");
  script.type = "module";
  script.src = "https://static.cloudflareinsights.com/beacon.min.js";
  script.dataset.cfBeacon = JSON.stringify({ token });
  document.body.append(script);
}
