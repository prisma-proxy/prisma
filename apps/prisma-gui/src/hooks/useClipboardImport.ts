import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { notify } from "@/store/notifications";
import { api } from "@/lib/commands";
import { readText } from "@tauri-apps/plugin-clipboard-manager";

export function useClipboardImport() {
  const navigate = useNavigate();
  const lastUri = useRef<string>("");

  useEffect(() => {
    async function checkClipboard() {
      try {
        const text = await readText();
        if (!text || !text.startsWith("prisma://")) return;
        if (text === lastUri.current) return;
        lastUri.current = text;

        // Parse the URI
        const json = await api.profileFromQr(text.trim());
        const parsed = JSON.parse(json);
        const name = parsed.name ?? "";

        notify.info(`Found prisma:// URI for "${name}". Go to Profiles to import.`);
        navigate("/profiles");
      } catch {
        // Clipboard not available or parse failed — silently ignore
      }
    }

    window.addEventListener("focus", checkClipboard);
    return () => window.removeEventListener("focus", checkClipboard);
  }, [navigate]);
}
