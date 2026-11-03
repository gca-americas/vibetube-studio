import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Ambience } from "./components/Ambience";
import { PostDockProvider } from "./components/PostDock";
import { StepShell } from "./components/StepShell";
import { STEPS } from "./steps/registry";

/**
 * Every workshop step is its own URL (/step/<slug>), rendered inside the
 * StepShell (top nav, roadmap, Back/Next). The root redirects to step one.
 * The Post my video drawer (PostDock) sits over every page, so the wall is
 * one click away from step 3 on.
 */
export default function App() {
  const location = useLocation();
  return (
    <div className="stage-vignette relative min-h-screen bg-stage text-fg">
      <Ambience />
      <div className="relative z-10 flex min-h-screen flex-col">
        <PostDockProvider>
          <Routes location={location} key={location.pathname}>
            <Route path="/" element={<Navigate to={`/step/${STEPS[0].slug}`} replace />} />
            <Route path="/step/:slug" element={<StepShell />} />
            <Route path="/step/:slug/:part" element={<StepShell />} />
            <Route path="*" element={<Navigate to={`/step/${STEPS[0].slug}`} replace />} />
          </Routes>
        </PostDockProvider>
      </div>
    </div>
  );
}
