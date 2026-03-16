import { useState } from "react";
import { X, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { WizardState } from "@/lib/buildConfig";
import { buildClientConfig, validateWizard } from "@/lib/buildConfig";

interface Props {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
}

export default function Step5Review({ state, onChange }: Props) {
  const [tagInput, setTagInput] = useState("");
  const errors = validateWizard(state);

  function addTag() {
    const tag = tagInput.trim();
    if (tag && !state.tags.includes(tag)) {
      onChange({ tags: [...state.tags, tag] });
    }
    setTagInput("");
  }

  function removeTag(tag: string) {
    onChange({ tags: state.tags.filter((t) => t !== tag) });
  }

  const preview = JSON.stringify(buildClientConfig(state), null, 2);

  return (
    <div className="space-y-4">
      {/* Validation summary */}
      {errors.length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            <ul className="list-disc list-inside space-y-0.5 text-sm">
              {errors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {errors.length === 0 && (
        <Alert className="border-green-600/30 bg-green-600/10">
          <AlertDescription className="text-green-500 text-sm">
            All fields look good — ready to save.
          </AlertDescription>
        </Alert>
      )}

      {/* Tags */}
      <div className="space-y-2">
        <Label>Tags</Label>
        <div className="flex flex-wrap gap-1 min-h-8">
          {state.tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-1">
              {tag}
              <button type="button" onClick={() => removeTag(tag)}>
                <X size={10} />
              </button>
            </Badge>
          ))}
        </div>
        <div className="flex gap-1">
          <Input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
            placeholder="Add tag…"
            className="h-8 text-sm"
          />
          <button
            type="button"
            onClick={addTag}
            className="px-2 rounded-md border border-border hover:bg-accent"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* JSON preview */}
      <div className="space-y-1">
        <Label>Config preview</Label>
        <pre className="text-[10px] font-mono bg-muted rounded-lg p-3 overflow-auto max-h-48 border">
          {preview}
        </pre>
      </div>
    </div>
  );
}
