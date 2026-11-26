"""Read-only overlay asset server for previewing an unapplied archetype patch (26 Nov 2026).

Serves the main checkout's public/ unchanged, except the patched index and the patch's new meshes, which come from the
build folder. Nothing is written anywhere. Port 5199, loopback only (CORS for local origins only), no caching.
"""
import csv, http.server, os, re, sys, urllib.parse

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))  # main checkout
ROOT = REPO + "/public"
ARG = sys.argv[1] if len(sys.argv) > 1 else "starter-reprove-build"
# A build folder name under scripts/generated/archetypes, or an absolute folder (e.g. a builder's reshaped-preview/).
BUILD = ARG if os.path.isabs(ARG) else REPO + "/scripts/generated/archetypes/" + ARG
MODELS = ROOT + "/models"
OVERLAY = {"/models/reconstructed-assemblies-v1/assets.json": BUILD + "/assets.json"}
for src, dst, _sha in csv.reader(open(BUILD + "/publish-list.tsv", encoding="utf-8"), delimiter="\t"):
    OVERLAY["/models/" + dst] = os.path.normpath(os.path.join(MODELS, src))


class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        p = urllib.parse.unquote(urllib.parse.urlsplit(path).path)
        if p in OVERLAY:
            return OVERLAY[p]
        # Confined to public/: no "..", and no segment that Windows reads as a separator or a drive ("%5C", "C:").
        segments = [s for s in p.split("/") if s and s not in (".", "..")]
        full = os.path.normpath(os.path.join(ROOT, *segments))
        if any("\\" in s or ":" in s for s in segments) or os.path.commonpath([full, os.path.normpath(ROOT)]) != os.path.normpath(ROOT):
            return os.path.join(ROOT, "__refused__")
        return full

    def end_headers(self):
        # Only the local dev pages (vite, the mask generator) may read it cross-origin, never another site.
        origin = self.headers.get("Origin", "")
        if re.fullmatch(r"http://(127\.0\.0\.1|localhost)(:\d+)?", origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    for k, v in OVERLAY.items():
        print("overlay", k, "->", v, os.path.exists(v), flush=True)
    http.server.ThreadingHTTPServer(("127.0.0.1", 5199), Handler).serve_forever()
