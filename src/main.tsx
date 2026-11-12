import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Route, Routes } from "react-router-dom";
import "./index.css";
import Builder from "./pages/Builder";
import Outfit from "./pages/Outfit";
import NotFound from "./pages/NotFound";
import Roadmap from "./pages/Roadmap";
import { ReconstructionProgressProvider } from "./context/ReconstructionProgress";
import { loadCatalog } from "./lib/catalog-load";
import IntroDialog from "./components/IntroDialog";
import { startAnalytics } from "./lib/analytics";
import { startSavedOutfits } from "./store/useSavedOutfits";
import { openLink } from "./store/open-link";

// Before the catalog: a visit whose catalog fails to load is the one worth counting. No-op outside production.
if (import.meta.env.PROD) startAnalytics();

// The catalog getters are synchronous, so nothing renders until the catalog is in.
// Until then the static shell in index.html stays on screen. Saved outfits open alongside; that
// never fails the page (with no usable storage, saving is simply off).
Promise.all([loadCatalog(), startSavedOutfits().catch(error => console.error("[saved outfits]", error))])
  .then(mount, showCatalogFailure);

function showCatalogFailure(error: unknown) {
  console.error("[catalog] could not load", error);
  const status = document.getElementById("boot-status");
  if (!status) return;
  // The shell's loading bar would otherwise keep sweeping under a failure message.
  document.querySelector(".shell-bar")?.parentElement?.remove();
  status.style.cssText = "font-size:14px;color:#f2efe9;max-width:22rem;line-height:1.5";
  status.textContent = "The catalog could not be loaded. Check your connection and try again. ";
  const retry = document.createElement("button");
  retry.textContent = "Reload";
  retry.style.cssText = "color:#f5f5f5;text-decoration:underline";
  retry.onclick = () => location.reload();
  status.append(retry);
}

function mount() {
  // Put the saved (or linked) outfit on before the first render, so the viewer never starts loading the
  // starting look first. Builder runs the same call again; it is idempotent.
  try { openLink(window.location.href); } catch (error) { console.error("[saved outfits]", error); }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <HashRouter>
        <ReconstructionProgressProvider>
          <Routes>
            {/* One layout route for both builder modes (lib/site-mode.ts), so switching keeps the same Builder and
                3D viewer: the character is not reloaded, only the emote set changes. */}
            <Route element={<Builder />}>
              {/* element={null}: the page is the layout's Builder; without it the router warns of an empty leaf. */}
              <Route index element={null} />
              <Route path="chinals" element={null} />
            </Route>
            <Route path="/roadmap" element={<Roadmap />} />
            <Route path="/chinals/roadmap" element={<Roadmap />} />
            <Route path="/o/:code" element={<Outfit />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          <IntroDialog />
        </ReconstructionProgressProvider>
      </HashRouter>
    </StrictMode>,
  );
}
