import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { useRules } from "@/store/rules";
import type { Rule } from "@/store/rules";

const RULE_TYPES   = ["DOMAIN", "IP-CIDR", "GEOIP", "FINAL"] as const;
const RULE_ACTIONS = ["PROXY", "DIRECT", "REJECT"] as const;

export default function Rules() {
  const { t } = useTranslation();
  const rules = useRules((s) => s.rules);
  const addRule = useRules((s) => s.add);
  const removeRule = useRules((s) => s.remove);

  const [open,   setOpen]   = useState(false);
  const [type,   setType]   = useState<Rule["type"]>("DOMAIN");
  const [match,  setMatch]  = useState("");
  const [action, setAction] = useState<Rule["action"]>("PROXY");

  function handleAdd() {
    addRule({ id: crypto.randomUUID(), type, match, action });
    setMatch("");
    setOpen(false);
  }

  return (
    <div className="p-4 sm:p-6 flex flex-col h-full gap-3">
      <div className="flex items-center justify-between">
        <h1 className="font-bold text-lg">{t("rules.title")}</h1>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus /> {t("rules.addRule")}
        </Button>
      </div>

      <Alert className="border-blue-600/30 bg-blue-600/10">
        <Info size={14} className="text-blue-400" />
        <AlertDescription className="text-blue-300 text-xs">
          {t("rules.persistNote")}
        </AlertDescription>
      </Alert>

      <ScrollArea className="flex-1 h-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("rules.type")}</TableHead>
              <TableHead>{t("rules.match")}</TableHead>
              <TableHead>{t("rules.action")}</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                  {t("rules.noRules")}
                </TableCell>
              </TableRow>
            )}
            {rules.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">{r.type}</TableCell>
                <TableCell className="text-sm">{r.match || "—"}</TableCell>
                <TableCell>
                  <span className={
                    r.action === "PROXY"  ? "text-green-400" :
                    r.action === "REJECT" ? "text-red-400"   : "text-muted-foreground"
                  }>
                    {r.action}
                  </span>
                </TableCell>
                <TableCell>
                  <Button size="icon" variant="ghost" onClick={() => removeRule(r.id)}>
                    <Trash2 size={14} className="text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("rules.addRule")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t("rules.type")}</Label>
              <Select value={type} onValueChange={(v) => setType(v as Rule["type"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RULE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t("rules.match")}</Label>
              <Input value={match} onChange={(e) => setMatch(e.target.value)} placeholder={t("rules.matchPlaceholder")} />
            </div>
            <div className="space-y-1">
              <Label>{t("rules.action")}</Label>
              <Select value={action} onValueChange={(v) => setAction(v as Rule["action"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RULE_ACTIONS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="ghost">{t("common.cancel")}</Button></DialogClose>
            <Button onClick={handleAdd}>{t("rules.addRule")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
