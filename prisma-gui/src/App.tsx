import { Route, Routes } from "react-router-dom";
import { usePrismaEvents } from "./hooks/usePrismaEvents";
import { usePlatform } from "./hooks/usePlatform";
import { useWindowEvents } from "./hooks/useWindowEvents";
import { useAutoReconnect } from "./hooks/useAutoReconnect";
import Sidebar from "./components/Sidebar";
import BottomNav from "./components/BottomNav";
import Home from "./pages/Home";
import Profiles from "./pages/Profiles";
import Rules from "./pages/Rules";
import Logs from "./pages/Logs";
import SpeedTest from "./pages/SpeedTest";
import Settings from "./pages/Settings";

export default function App() {
  usePrismaEvents();
  useWindowEvents();
  useAutoReconnect();
  const { isMobile } = usePlatform();

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {!isMobile && <Sidebar />}
      <main className="flex-1 overflow-auto">
        <Routes>
          <Route path="/"          element={<Home />} />
          <Route path="/profiles"  element={<Profiles />} />
          <Route path="/rules"     element={<Rules />} />
          <Route path="/logs"      element={<Logs />} />
          <Route path="/speedtest" element={<SpeedTest />} />
          <Route path="/settings"  element={<Settings />} />
        </Routes>
      </main>
      {isMobile && <BottomNav />}
    </div>
  );
}
