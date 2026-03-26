import { useState, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";

export default function PortInput({
  id, value, onChange, hint,
}: {
  id: string;
  value: number;
  onChange: (v: number) => void;
  hint?: string;
}) {
  const [draft, setDraft] = useState(String(value));

  // Sync draft when the store value changes externally (e.g. reset, import)
  useEffect(() => { setDraft(String(value)); }, [value]);

  const commit = useCallback(() => {
    const n = parseInt(draft, 10);
    const clamped = Number.isNaN(n) ? 0 : Math.max(0, Math.min(65535, n));
    onChange(clamped);
    setDraft(String(clamped));
  }, [draft, onChange]);

  return (
    <div className="space-y-1">
      <Input
        id={id}
        type="number"
        min={0}
        max={65535}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
