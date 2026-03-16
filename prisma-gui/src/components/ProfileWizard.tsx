import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { WizardState } from "@/lib/buildConfig";
import { DEFAULT_WIZARD, buildClientConfig, validateWizard } from "@/lib/buildConfig";
import Step1Connection from "./wizard/Step1Connection";
import Step2Auth from "./wizard/Step2Auth";
import Step3Transport from "./wizard/Step3Transport";
import Step4RoutingTun from "./wizard/Step4RoutingTun";
import Step5Review from "./wizard/Step5Review";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: WizardState;
  onSave: (name: string, config: Record<string, unknown>, tags: string[]) => Promise<void>;
}

const STEP_LABELS = [
  "Connection",
  "Auth",
  "Transport",
  "Routing & TUN",
  "Review",
];

export default function ProfileWizard({ open, onOpenChange, initial, onSave }: Props) {
  const [step, setStep] = useState(0);
  const [state, setState] = useState<WizardState>(initial ?? DEFAULT_WIZARD);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  function patch(values: Partial<WizardState>) {
    setState((prev) => ({ ...prev, ...values }));
  }

  function handleOpen(v: boolean) {
    if (!v) {
      // Reset on close
      setStep(0);
      setState(initial ?? DEFAULT_WIZARD);
      setSaveError("");
    }
    onOpenChange(v);
  }

  // Re-sync initial when it changes (edit mode)
  // (caller should remount or pass stable initial)

  async function handleSave() {
    const errors = validateWizard(state);
    if (errors.length > 0) return;
    setSaving(true);
    setSaveError("");
    try {
      await onSave(state.name, buildClientConfig(state), state.tags);
      handleOpen(false);
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  }

  const isLast = step === STEP_LABELS.length - 1;
  const canSave = isLast && validateWizard(state).length === 0;

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {initial ? "Edit Profile" : "New Profile"} — {STEP_LABELS[step]}
          </DialogTitle>
        </DialogHeader>

        {/* Progress dots */}
        <div className="flex items-center gap-1.5 px-1">
          {STEP_LABELS.map((label, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setStep(i)}
              className="flex items-center gap-1 group"
              title={label}
            >
              <div
                className={`w-2 h-2 rounded-full transition-colors ${
                  i === step
                    ? "bg-primary scale-125"
                    : i < step
                    ? "bg-primary/50"
                    : "bg-muted-foreground/30"
                }`}
              />
            </button>
          ))}
          <span className="ml-1 text-xs text-muted-foreground">
            {step + 1} / {STEP_LABELS.length}
          </span>
        </div>

        {/* Step content */}
        <div
          key={step}
          className="flex-1 overflow-y-auto py-2 px-1 animate-in fade-in-0 slide-in-from-right-2 duration-200"
        >
          {step === 0 && <Step1Connection state={state} onChange={patch} />}
          {step === 1 && <Step2Auth state={state} onChange={patch} />}
          {step === 2 && <Step3Transport state={state} onChange={patch} />}
          {step === 3 && <Step4RoutingTun state={state} onChange={patch} />}
          {step === 4 && <Step5Review state={state} onChange={patch} />}
        </div>

        {saveError && (
          <p className="text-xs text-destructive px-1">{saveError}</p>
        )}

        <DialogFooter className="gap-1">
          <Button variant="ghost" onClick={() => handleOpen(false)}>
            Cancel
          </Button>
          {step > 0 && (
            <Button variant="outline" onClick={() => setStep((s) => s - 1)}>
              Back
            </Button>
          )}
          {!isLast && (
            <Button onClick={() => setStep((s) => s + 1)}>Next</Button>
          )}
          {isLast && (
            <Button onClick={handleSave} disabled={!canSave || saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
