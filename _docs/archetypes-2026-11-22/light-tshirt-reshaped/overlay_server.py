"""Read-only overlay asset server for previewing an unapplied archetype patch (26 Nov 2026).

Serves the main checkout's public/ unchanged, except the patched index and the patch's new meshes, which come from the
build folder. Nothing is written anywhere. Port 5199, CORS open, no caching.
"""
import csv, http.server, os, sys, urllib.parse

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
        return os.path.join(ROOT, *[s for s in p.split("/") if s and s not in (".", "..")])

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    for k, v in OVERLAY.items():
        print("overlay", k, "->", v, os.path.exists(v), flush=True)
    http.server.ThreadingHTTPServer(("127.0.0.1", 5199), Handler).serve_forever()
