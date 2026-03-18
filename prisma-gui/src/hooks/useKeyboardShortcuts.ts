import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useConnection } from "./useConnection";

const routes = ["/", "/profiles", "/rules", "/connections", "/logs", "/speedtest", "/settings"];

export function useKeyboardShortcuts() {
  const navigate = useNavigate();
  const { toggle } = useConnection();

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      // Skip when user is typing in an input
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      // Cmd+1..7 — navigate to pages
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= 7) {
        e.preventDefault();
        navigate(routes[num - 1]);
        return;
      }

      // Cmd+K — toggle connect/disconnect
      if (e.key === "k" || e.key === "K") {
        e.preventDefault();
        toggle();
        return;
      }

      // Cmd+N — navigate to profiles to add new
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        navigate("/profiles");
        return;
      }
    }

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate, toggle]);
}
