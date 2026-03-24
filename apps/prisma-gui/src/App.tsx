import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { usePrismaEvents } from "./hooks/usePrismaEvents";
import { usePlatform } from "./hooks/usePlatform";
import { useWindowEvents } from "./hooks/useWindowEvents";
import { useAutoReconnect } from "./hooks/useAutoReconnect";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useClipboardImport } from "./hooks/useClipboardImport";
import { useMobileLifecycle } from "./hooks/useMobileLifecycle";
import Sidebar from "./components/Sidebar";
import BottomNav from "./components/BottomNav";
import StatusBar from "./components/StatusBar";
import PageLoader from "./components/PageLoader";

const Home = lazy(() => import("./pages/Home"));
const Profiles = lazy(() => import("./pages/Profiles"));
const Subscriptions = lazy(() => import("./pages/Subscriptions"));
const ProxyGroups = lazy(() => import("./pages/ProxyGroups"));
const Rules = lazy(() => import("./pages/Rules"));
const Connections = lazy(() => import("./pages/Connections"));
const Logs = lazy(() => import("./pages/Logs"));
const SpeedTest = lazy(() => import("./pages/SpeedTest"));
const Analytics = lazy(() => import("./pages/Analytics"));
const Settings = lazy(() => import("./pages/Settings"));

export default function App() {
  usePrismaEvents();
  useWindowEvents();
  useAutoReconnect();
  useKeyboardShortcuts();
  useClipboardImport();
  useMobileLifecycle();
  const { isMobile } = usePlatform();

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {!isMobile && <Sidebar />}
      <div className="flex-1 flex flex-col overflow-hidden">
        <main className={`flex-1 overflow-hidden ${isMobile ? "pb-16" : ""}`}>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/"          element={<Home />} />
              <Route path="/profiles"  element={<Profiles />} />
              <Route path="/subscriptions" element={<Subscriptions />} />
              <Route path="/proxy-groups" element={<ProxyGroups />} />
              <Route path="/rules"     element={<Rules />} />
              <Route path="/connections" element={<Connections />} />
              <Route path="/logs"      element={<Logs />} />
              <Route path="/speedtest" element={<SpeedTest />} />
              <Route path="/analytics" element={<Analytics />} />
              <Route path="/settings"  element={<Settings />} />
            </Routes>
          </Suspense>
        </main>
        {!isMobile && <StatusBar />}
      </div>
      {isMobile && <BottomNav />}
    </div>
  );
}
