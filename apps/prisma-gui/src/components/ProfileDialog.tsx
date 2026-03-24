import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import type { WizardState } from "@/lib/buildConfig";
import { DEFAULT_WIZARD, buildClientConfig, validateWizard } from "@/lib/buildConfig";
import BasicTab from "./profile-tabs/BasicTab";
import TransportTab from "./profile-tabs/TransportTab";
import SecurityTab from "./profile-tabs/SecurityTab";
import AdvancedTab from "./profile-tabs/AdvancedTab";
import ReviewTab from "./profile-tabs/ReviewTab";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: WizardState;
  onSave: (name: string, config: Record<string, unknown>, tags: string[]) => Promise<void>;
}

type TabKey = "basic" | "transport" | "security" | "advanced" | "review";

export default function ProfileDialog({ open, onOpenChange, initial, onSave }: Props) {
  const { t } = useTranslation();

  const [tab, setTab] = useState<TabKey>("basic");
  const [state, setState] = useState<WizardState>(initial ?? DEFAULT_WIZARD);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  function patch(values: Partial<WizardState>) {
    setState((prev) => ({ ...prev, ...values }));
  }

  function handleOpen(v: boolean) {
    if (!v) {
      setTab("basic");
      setState(initial ?? DEFAULT_WIZARD);
      setSaveError("");
    }
    onOpenChange(v);
  }

  useEffect(() => {
    if (open) {
      setTab("basic");
      setState(initial ?? DEFAULT_WIZARD);
      setSaveError("");
    }
  }, [open, initial]);

  async function handleSave() {
    const errors = validateWizard(state);
    if (errors.length > 0) {
      setTab("review");
      return;
    }
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

  function handleApplyPreset(newState: WizardState) {
    setState(newState);
  }

  const canSave = validateWizard(state).length === 0;

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="max-w-[calc(100vw-1.5rem)] sm:max-w-2xl max-h-[90vh] flex flex-col" onInteractOutside={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>
            {initial ? t("wizard.editProfile") : t("wizard.newProfile")}
          </DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="flex-1 flex flex-col min-h-0">
          <TabsList className="w-full justify-start overflow-x-auto flex-nowrap">
            <TabsTrigger value="basic">{t("wizard.tabBasic")}</TabsTrigger>
            <TabsTrigger value="transport">{t("wizard.tabTransport")}</TabsTrigger>
            <TabsTrigger value="security">{t("wizard.tabSecurity")}</TabsTrigger>
            <TabsTrigger value="advanced">{t("wizard.tabAdvanced")}</TabsTrigger>
            <TabsTrigger value="review">{t("wizard.tabReview")}</TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto py-2 px-1 min-h-0">
            <TabsContent value="basic" className="mt-0">
              <BasicTab state={state} onChange={patch} onApplyPreset={handleApplyPreset} />
            </TabsContent>
            <TabsContent value="transport" className="mt-0">
              <TransportTab state={state} onChange={patch} />
            </TabsContent>
            <TabsContent value="security" className="mt-0">
              <SecurityTab state={state} onChange={patch} />
            </TabsContent>
            <TabsContent value="advanced" className="mt-0">
              <AdvancedTab state={state} onChange={patch} />
            </TabsContent>
            <TabsContent value="review" className="mt-0">
              <ReviewTab state={state} onChange={patch} />
            </TabsContent>
          </div>
        </Tabs>

        {saveError && (
          <p className="text-xs text-destructive px-1">{saveError}</p>
        )}

        <DialogFooter className="gap-1">
          <Button variant="ghost" onClick={() => handleOpen(false)}>
            {t("wizard.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={!canSave || saving}>
            {saving ? t("wizard.saving") : t("wizard.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
