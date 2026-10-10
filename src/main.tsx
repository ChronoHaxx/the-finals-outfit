import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Route, Routes } from "react-router-dom";
import "./index.css";
import Builder from "./pages/Builder";
import Outfit from "./pages/Outfit";
import NotFound from "./pages/NotFound";
import Roadmap from "./pages/Roadmap";
import { ReconstructionProgressProvider } from "./context/ReconstructionProgress";

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
      </ReconstructionProgressProvider>
    </HashRouter>
  </StrictMode>,
);
