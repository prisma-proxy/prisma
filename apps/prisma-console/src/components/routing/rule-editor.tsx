"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import type { RoutingRule, RuleCondition } from "@/lib/types";

interface RuleEditorProps {
  onSubmit: (rule: Omit<RoutingRule, "id">) => Promise<void>;
  isLoading: boolean;
}

const conditionTypes = [
  "DomainMatch",
  "DomainExact",
  "IpCidr",
  "PortRange",
  "All",
] as const;

type ConditionType = (typeof conditionTypes)[number];

export function RuleEditor({ onSubmit, isLoading }: RuleEditorProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [priority, setPriority] = useState(0);
  const [conditionType, setConditionType] = useState<ConditionType>("All");
  const [conditionValue, setConditionValue] = useState("");
  const [action, setAction] = useState<"Allow" | "Block">("Allow");

  function resetForm() {
    setName("");
    setPriority(0);
    setConditionType("All");
    setConditionValue("");
    setAction("Allow");
  }

  function buildCondition(): RuleCondition {
    switch (conditionType) {
      case "DomainMatch":
        return { type: "DomainMatch", value: conditionValue };
      case "DomainExact":
        return { type: "DomainExact", value: conditionValue };
      case "IpCidr":
        return { type: "IpCidr", value: conditionValue };
      case "PortRange": {
        const parts = conditionValue.split("-").map(Number);
        return { type: "PortRange", value: [parts[0] || 0, parts[1] || 0] };
      }
      case "All":
        return { type: "All", value: null };
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await onSubmit({
        name,
        priority,
        condition: buildCondition(),
        action,
        enabled: true,
      });
      resetForm();
      setOpen(false);
    } catch {
      // Keep form open on failure so the user can retry
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>{t("routing.addRule")}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("routing.createRule")}</DialogTitle>
          <DialogDescription>
            {t("routing.createRuleDescription")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-1.5">
            <Label htmlFor="rule-name">{t("common.name")}</Label>
            <Input
              id="rule-name"
              type="text"
              placeholder="Rule name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="rule-priority">{t("routing.priority")}</Label>
            <Input
              id="rule-priority"
              type="number"
              placeholder="0"
              value={priority}
              onChange={(e) => setPriority(parseInt(e.target.value, 10) || 0)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label>{t("routing.conditionType")}</Label>
            <Select
              value={conditionType}
              onValueChange={(val) => {
                setConditionType(val as ConditionType);
                if (val === "All") setConditionValue("");
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("routing.selectCondition")} />
              </SelectTrigger>
              <SelectContent>
                {conditionTypes.map((ct) => (
                  <SelectItem key={ct} value={ct}>
                    {ct}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {conditionType !== "All" && (
            <div className="grid gap-1.5">
              <Label htmlFor="rule-condition-value">{t("routing.conditionValue")}</Label>
              <Input
                id="rule-condition-value"
                type="text"
                placeholder={
                  conditionType === "PortRange"
                    ? "e.g. 8000-9000"
                    : conditionType === "IpCidr"
                      ? "e.g. 192.168.1.0/24"
                      : "e.g. *.example.com"
                }
                value={conditionValue}
                onChange={(e) => setConditionValue(e.target.value)}
                required
              />
            </div>
          )}

          <div className="grid gap-1.5">
            <Label>{t("routing.action")}</Label>
            <Select
              value={action}
              onValueChange={(val) => setAction(val as "Allow" | "Block")}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Allow">{t("routing.allow")}</SelectItem>
                <SelectItem value="Block">{t("routing.block")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? t("routing.creatingRule") : t("routing.createRule")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
