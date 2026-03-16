import { useState } from "react";
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

interface Rule {
  id:     string;
  type:   "DOMAIN" | "IP-CIDR" | "GEOIP" | "FINAL";
  match:  string;
  action: "PROXY" | "DIRECT" | "REJECT";
}

const RULE_TYPES   = ["DOMAIN", "IP-CIDR", "GEOIP", "FINAL"] as const;
const RULE_ACTIONS = ["PROXY", "DIRECT", "REJECT"] as const;

export default function Rules() {
  const [rules,  setRules]  = useState<Rule[]>([]);
  const [open,   setOpen]   = useState(false);
  const [type,   setType]   = useState<Rule["type"]>("DOMAIN");
  const [match,  setMatch]  = useState("");
  const [action, setAction] = useState<Rule["action"]>("PROXY");

  function handleAdd() {
    setRules((prev) => [
      ...prev,
      { id: crypto.randomUUID(), type, match, action },
    ]);
    setMatch("");
    setOpen(false);
  }

  function handleDelete(id: string) {
    setRules((prev) => prev.filter((r) => r.id !== id));
  }

  return (
    <div className="p-4 sm:p-6 flex flex-col h-full gap-3">
      <div className="flex items-center justify-between">
        <h1 className="font-bold text-lg">Rules</h1>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus /> Add Rule
        </Button>
      </div>

      <Alert className="border-blue-600/30 bg-blue-600/10">
        <Info size={14} className="text-blue-400" />
        <AlertDescription className="text-blue-300 text-xs">
          Rules are in-memory only. To persist them, include them in your profile&apos;s config JSON.
        </AlertDescription>
      </Alert>

      <ScrollArea className="flex-1 h-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Match</TableHead>
              <TableHead>Action</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                  No rules
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
                  <Button size="icon" variant="ghost" onClick={() => handleDelete(r.id)}>
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
          <DialogHeader><DialogTitle>Add Rule</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as Rule["type"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RULE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Match</Label>
              <Input value={match} onChange={(e) => setMatch(e.target.value)} placeholder="e.g. example.com" />
            </div>
            <div className="space-y-1">
              <Label>Action</Label>
              <Select value={action} onValueChange={(v) => setAction(v as Rule["action"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RULE_ACTIONS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
            <Button onClick={handleAdd}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
