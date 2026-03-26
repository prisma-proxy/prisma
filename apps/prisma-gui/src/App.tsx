import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import ErrorBoundary from "./components/ErrorBoundary";
import { useStatusSync } from "./hooks/useStatusSync";
import { usePrismaEvents } from "./hooks/usePrismaEvents";
import { usePlatform } from "./hooks/usePlatform";
import { useWindowEvents } from "./hooks/useWindowEvents";
import { useAutoReconnect } from "./hooks/useAutoReconnect";
import { useConfigReload } from "./hooks/useConfigReload";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useClipboardImport } from "./hooks/useClipboardImport";
import { useMobileLifecycle } from "./hooks/useMobileLifecycle";
import Sidebar from "./components/Sidebar";
import BottomNav from "./components/BottomNav";
import QuickConnectFab from "./components/QuickConnectFab";
import StatusBar from "./components/StatusBar";
import PageLoader from "./components/PageLoader";

const Home = lazy(() => import("./pages/Home"));
const Profiles = lazy(() => import("./pages/Profiles"));
const Subscriptions = lazy(() => import("./pages/Subscriptions"));
const Rules = lazy(() => import("./pages/Rules"));
const Connections = lazy(() => import("./pages/Connections"));
const Logs = lazy(() => import("./pages/Logs"));
const SpeedTest = lazy(() => import("./pages/SpeedTest"));
const Diagnostics = lazy(() => import("./pages/Diagnostics"));
const Analytics = lazy(() => import("./pages/Analytics"));
const PerApp = lazy(() => import("./pages/PerApp"));
const Settings = lazy(() => import("./pages/Settings"));

export default function App() {
  useStatusSync();
  usePrismaEvents();
  useWindowEvents();
  useAutoReconnect();
  useConfigReload();
  useKeyboardShortcuts();
  useClipboardImport();
  useMobileLifecycle();
  const { isMobile } = usePlatform();

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {!isMobile && <Sidebar />}
      <div className="flex-1 flex flex-col overflow-hidden">
        <main className={`flex-1 overflow-hidden ${isMobile ? "pb-16" : ""}`}>
          <ErrorBoundary>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/"          element={<Home />} />
                <Route path="/profiles"  element={<Profiles />} />
                <Route path="/subscriptions" element={<Subscriptions />} />
                <Route path="/rules"     element={<Rules />} />
                <Route path="/connections" element={<Connections />} />
                <Route path="/logs"      element={<Logs />} />
                <Route path="/speedtest" element={<SpeedTest />} />
                <Route path="/diagnostics" element={<Diagnostics />} />
                <Route path="/analytics" element={<Analytics />} />
                <Route path="/per-app"   element={<PerApp />} />
                <Route path="/settings"  element={<Settings />} />
                <Route path="*"          element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </main>
        {!isMobile && <StatusBar />}
      </div>
      {isMobile && <BottomNav />}
      {isMobile && <QuickConnectFab />}
    </div>
  );
}
