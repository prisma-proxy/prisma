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
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
  /** When set, the dialog opens in edit mode pre-filled with this rule. */
  editingRule?: RoutingRule | null;
  /** Called when the dialog is closed (used to clear editingRule in parent). */
  onOpenChange?: (open: boolean) => void;
}

const conditionTypes = [
  "DomainMatch",
  "DomainExact",
  "DomainSuffix",
  "DomainKeyword",
  "IpCidr",
  "GeoIp",
  "PortRange",
  "All",
] as const;

type ConditionType = (typeof conditionTypes)[number];

const actionTypes = ["Allow", "Direct", "Block", "Reject"] as const;
type ActionType = (typeof actionTypes)[number];

function extractConditionType(condition: RuleCondition): ConditionType {
  return condition.type as ConditionType;
}

function extractConditionValue(condition: RuleCondition): string {
  if (condition.type === "All") return "";
  if (condition.type === "PortRange") {
    const val = condition.value as [number, number];
    return `${val[0]}-${val[1]}`;
  }
  return condition.value as string;
}

/** Map legacy "Allow"/"Block" to expanded action set for display purposes. */
function normalizeAction(action: string): ActionType {
  if (action === "Allow" || action === "Direct" || action === "Block" || action === "Reject") {
    return action as ActionType;
  }
  return "Allow";
}

export function RuleEditor({ onSubmit, isLoading, editingRule, onOpenChange }: RuleEditorProps) {
  const { t } = useI18n();
  const isEditing = !!editingRule;
  const [open, setOpen] = useState(isEditing);
  const [name, setName] = useState(editingRule?.name ?? "");
  const [priority, setPriority] = useState(editingRule?.priority ?? 0);
  const [conditionType, setConditionType] = useState<ConditionType>(
    editingRule ? extractConditionType(editingRule.condition) : "All"
  );
  const [conditionValue, setConditionValue] = useState(
    editingRule ? extractConditionValue(editingRule.condition) : ""
  );
  const [action, setAction] = useState<ActionType>(
    editingRule ? normalizeAction(editingRule.action) : "Allow"
  );

  function resetForm() {
    setName("");
    setPriority(0);
    setConditionType("All");
    setConditionValue("");
    setAction("Allow");
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      resetForm();
      onOpenChange?.(false);
    }
  }

  function buildCondition(): RuleCondition {
    switch (conditionType) {
      case "DomainMatch":
        return { type: "DomainMatch", value: conditionValue };
      case "DomainExact":
        return { type: "DomainExact", value: conditionValue };
      case "DomainSuffix":
        return { type: "DomainMatch", value: `*.${conditionValue}` };
      case "DomainKeyword":
        return { type: "DomainMatch", value: `*${conditionValue}*` };
      case "IpCidr":
        return { type: "IpCidr", value: conditionValue };
      case "GeoIp":
        return { type: "IpCidr", value: `geoip:${conditionValue}` };
      case "PortRange": {
        const parts = conditionValue.split("-").map(Number);
        return { type: "PortRange", value: [parts[0] || 0, parts[1] || 0] };
      }
      case "All":
        return { type: "All", value: null };
    }
  }

  function mapActionToBackend(a: ActionType): "Allow" | "Block" {
    return a === "Block" || a === "Reject" ? "Block" : "Allow";
  }

  function conditionLabel(ct: ConditionType): string {
    const labels: Record<ConditionType, string> = {
      DomainMatch: "DOMAIN",
      DomainExact: "DOMAIN-EXACT",
      DomainSuffix: "DOMAIN-SUFFIX",
      DomainKeyword: "DOMAIN-KEYWORD",
      IpCidr: "IP-CIDR",
      GeoIp: "GEOIP",
      PortRange: "PORT-RANGE",
      All: "FINAL (All)",
    };
    return labels[ct];
  }

  function actionLabel(a: ActionType): string {
    const labels: Record<ActionType, string> = {
      Allow: t("routing.actionProxy"),
      Direct: t("routing.actionDirect"),
      Block: t("routing.actionBlock"),
      Reject: t("routing.actionReject"),
    };
    return labels[a];
  }

  function conditionPlaceholder(): string {
    switch (conditionType) {
      case "PortRange":
        return "e.g. 8000-9000";
      case "IpCidr":
        return "e.g. 192.168.1.0/24";
      case "GeoIp":
        return "e.g. CN, US, JP";
      case "DomainSuffix":
        return "e.g. google.com";
      case "DomainKeyword":
        return "e.g. facebook";
      case "DomainMatch":
        return "e.g. *.example.com";
      case "DomainExact":
        return "e.g. www.example.com";
      default:
        return "";
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await onSubmit({
        name,
        priority,
        condition: buildCondition(),
        action: mapActionToBackend(action),
        enabled: editingRule?.enabled ?? true,
      });
      resetForm();
      setOpen(false);
      onOpenChange?.(false);
    } catch {
      // Keep form open on failure so the user can retry
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {!isEditing && (
        <DialogTrigger className={cn(buttonVariants())}>{t("routing.addRule")}</DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? t("routing.editRule") : t("routing.createRule")}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? t("routing.editRuleDescription")
              : t("routing.createRuleDescription")}
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
                    {conditionLabel(ct)}
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
                placeholder={conditionPlaceholder()}
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
              onValueChange={(val) => setAction(val as ActionType)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {actionTypes.map((a) => (
                  <SelectItem key={a} value={a}>
                    {actionLabel(a)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isLoading}>
              {isLoading
                ? t("routing.creatingRule")
                : isEditing
                  ? t("routing.saveRule")
                  : t("routing.createRule")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
