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

// The catalog getters are synchronous, so nothing renders until the catalog is in.
// Until then the static shell in index.html stays on screen.
loadCatalog().then(mount, showCatalogFailure);

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
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <HashRouter>
        <ReconstructionProgressProvider>
          <Routes>
            <Route path="/" element={<Builder />} />
            <Route path="/roadmap" element={<Roadmap />} />
            <Route path="/o/:code" element={<Outfit />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          <IntroDialog />
        </ReconstructionProgressProvider>
      </HashRouter>
    </StrictMode>,
  );
}
