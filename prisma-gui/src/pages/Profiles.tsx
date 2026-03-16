import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, QrCode, Pencil, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import QrDisplay from "@/components/QrDisplay";
import ConfirmDialog from "@/components/ConfirmDialog";
import ProfileWizard from "@/components/ProfileWizard";
import { useStore } from "@/store";
import { api } from "@/lib/commands";
import { parseProfileToWizard } from "@/lib/buildConfig";
import type { WizardState } from "@/lib/buildConfig";
import type { Profile } from "@/lib/types";

export default function Profiles() {
  const profiles = useStore((s) => s.profiles);
  const setProfiles = useStore((s) => s.setProfiles);

  // Wizard
  const [wizardOpen,   setWizardOpen]   = useState(false);
  const [editInitial,  setEditInitial]  = useState<WizardState | undefined>();
  const [editingId,    setEditingId]    = useState<string | null>(null);

  // QR export
  const [qrOpen, setQrOpen] = useState(false);
  const [qrSvg,  setQrSvg]  = useState("");

  // QR import
  const [qrImportOpen, setQrImportOpen] = useState(false);
  const [qrImportText, setQrImportText] = useState("");
  const [qrImportErr,  setQrImportErr]  = useState("");

  // Delete confirm
  const [deleteOpen,    setDeleteOpen]    = useState(false);
  const [deletePending, setDeletePending] = useState<Profile | null>(null);

  const reload = () =>
    api.listProfiles()
      .then(setProfiles)
      .catch(() => toast.error("Failed to load profiles"));

  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave(name: string, config: Record<string, unknown>, tags: string[]) {
    const profile: Profile = {
      id: editingId ?? crypto.randomUUID(),
      name,
      tags,
      config,
      created_at: new Date().toISOString(),
    };
    await api.saveProfile(JSON.stringify(profile));
    await reload();
    await api.refreshTrayProfiles().catch(() => {});
    toast.success("Profile saved");
    setEditInitial(undefined);
    setEditingId(null);
  }

  function openAdd() {
    setEditInitial(undefined);
    setEditingId(null);
    setWizardOpen(true);
  }

  function openEdit(p: Profile) {
    setEditInitial(parseProfileToWizard(p.name, p.config));
    setEditingId(p.id);
    setWizardOpen(true);
  }

  async function handleQr(p: Profile) {
    try {
      const svg = await api.profileToQr(JSON.stringify(p));
      setQrSvg(svg);
      setQrOpen(true);
    } catch (e) {
      toast.error(String(e));
    }
  }

  function confirmDelete(p: Profile) {
    setDeletePending(p);
    setDeleteOpen(true);
  }

  async function handleDelete() {
    if (!deletePending) return;
    try {
      await api.deleteProfile(deletePending.id);
      await reload();
      await api.refreshTrayProfiles().catch(() => {});
      toast.success(`Deleted "${deletePending.name}"`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setDeletePending(null);
    }
  }

  async function handleQrImport() {
    setQrImportErr("");
    try {
      const json = await api.profileFromQr(qrImportText.trim());
      const parsed = JSON.parse(json);
      setQrImportOpen(false);
      setQrImportText("");
      // Pre-fill wizard with imported config
      const initial = parseProfileToWizard(parsed.name ?? "", parsed.config ?? parsed);
      setEditInitial(initial);
      setWizardOpen(true);
    } catch (e) {
      setQrImportErr(String(e));
    }
  }

  return (
    <div className="p-4 sm:p-6 flex flex-col h-full gap-3">
      <div className="flex items-center justify-between">
        <h1 className="font-bold text-lg">Profiles</h1>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" onClick={() => setQrImportOpen(true)}>
            <ScanLine size={14} /> Import QR
          </Button>
          <Button size="sm" onClick={openAdd}>
            <Plus /> Add
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 h-0">
        <div className="space-y-2 pr-2">
          {profiles.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No profiles yet</p>
          )}
          {profiles.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-lg border bg-card px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm truncate">{p.name}</p>
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {p.tags.length > 0
                    ? p.tags.map((t) => <Badge key={t} variant="secondary" className="text-[10px] px-1.5 py-0">{t}</Badge>)
                    : <span className="text-xs text-muted-foreground">—</span>
                  }
                </div>
              </div>
              <div className="flex gap-1 ml-2">
                <Button size="icon" variant="ghost" onClick={() => openEdit(p)} title="Edit">
                  <Pencil size={14} />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => handleQr(p)} title="QR code">
                  <QrCode size={14} />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => confirmDelete(p)} title="Delete">
                  <Trash2 size={14} className="text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* Profile wizard */}
      <ProfileWizard
        open={wizardOpen}
        onOpenChange={(v) => { setWizardOpen(v); if (!v) { setEditInitial(undefined); setEditingId(null); } }}
        initial={editInitial}
        onSave={handleSave}
      />

      {/* QR export dialog */}
      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="max-w-xs">
          <DialogHeader><DialogTitle>QR Code</DialogTitle></DialogHeader>
          {qrSvg && <QrDisplay svg={qrSvg} />}
        </DialogContent>
      </Dialog>

      {/* QR import dialog */}
      <Dialog open={qrImportOpen} onOpenChange={(v) => { setQrImportOpen(v); setQrImportErr(""); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Import via QR / URI</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Paste a <code className="text-xs bg-muted px-1 rounded">prisma://</code> URI or JSON</Label>
            <Textarea
              rows={4}
              value={qrImportText}
              onChange={(e) => setQrImportText(e.target.value)}
              className="font-mono text-xs"
              placeholder="prisma://…"
            />
            {qrImportErr && <p className="text-xs text-destructive">{qrImportErr}</p>}
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
            <Button onClick={handleQrImport} disabled={!qrImportText.trim()}>Import</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete Profile"
        message={`Delete "${deletePending?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
      />
    </div>
  );
}
