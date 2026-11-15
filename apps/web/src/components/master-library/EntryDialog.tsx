import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { errorText } from "@/components/layout/PageStates";
import {
  KIND_LABELS,
  createMasterEntry,
  masterKeys,
  updateMasterEntry,
  type Locality,
  type MasterEntry,
  type MasterEntryInput,
  type MasterKind,
} from "@/api/masterLibrary";
import { byName, cleanName, clashOf, lowerKey, usageText } from "./names";

type Form = { name: string; code: string; locality: Locality | ""; district: string };

const formOf = (e: MasterEntry | null): Form => ({
  name: e?.name ?? "",
  code: e?.code ?? "",
  // A location still waiting for review has only a placeholder locality: make the admin pick.
  locality: e?.locality && !e.needs_confirmation ? e.locality : "",
  district: e?.district ?? "",
});

const CODE_OK = /^[A-Za-z0-9_-]{0,30}$/;

/** Add or edit one name. A rename is a spelling fix and changes the name on every order too. */
export function EntryDialog({
  kind,
  open,
  entry,
  entries,
  onClose,
}: {
  kind: MasterKind;
  open: boolean;
  /** Null to add a new name. */
  entry: MasterEntry | null;
  /** The whole list, to warn about a lookalike while typing. */
  entries: MasterEntry[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(() => formOf(entry));
  // Reset when the dialog opens for another entry, during render so the first frame is right.
  const [openedFor, setOpenedFor] = useState<MasterEntry | null | undefined>(undefined);
  if (open && openedFor !== entry) {
    setOpenedFor(entry);
    setForm(formOf(entry));
  } else if (!open && openedFor !== undefined) {
    setOpenedFor(undefined);
  }

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const label = KIND_LABELS[kind].toLowerCase();
  const name = cleanName(form.name);
  const renamed = !!entry && name !== entry.name;
  const clash = name && (!entry || lowerKey(name) !== lowerKey(entry.name)) ? clashOf(entries, name, entry?.id) : undefined;
  const codeBad = !CODE_OK.test(form.code.trim());

  const save = useMutation({
    mutationFn: () => {
      const body: MasterEntryInput = { name };
      if (kind === "CLIENT") body.code = form.code.trim() || null;
      if (kind === "LOCATION") {
        body.locality = form.locality as Locality;
        body.district = form.district.trim() || null;
      }
      return entry ? updateMasterEntry(kind, entry.id, body) : createMasterEntry(kind, body);
    },
    onSuccess: (res) => {
      // Put the saved entry straight into the list rather than waiting for a refetch.
      qc.setQueryData<{ entries: MasterEntry[] }>(masterKeys.entries(kind), (old) =>
        old
          ? { entries: [...old.entries.filter((e) => e.id !== res.entry.id), res.entry].sort(byName) }
          : old,
      );
      qc.invalidateQueries({ queryKey: masterKeys.all });
      const moved = (res as { moved?: number }).moved ?? 0;
      toast.success(entry ? "Saved" : `${KIND_LABELS[kind]} added`, {
        description: moved ? `Changed on ${moved.toLocaleString("en-IN")} ${kind === "CLIENT" ? "orders" : kind === "MEDIA" ? "order items" : "stores"} too.` : undefined,
      });
      onClose();
    },
    onError: (err) => toast.error(errorText(err, "Could not save")),
  });

  const canSave =
    !!name && !clash && !codeBad && (kind !== "LOCATION" || !!form.locality) && !save.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{entry ? `Edit ${label}` : `Add ${label}`}</DialogTitle>
          {entry && <DialogDescription>Used on {usageText(kind, entry).toLowerCase()}.</DialogDescription>}
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSave) save.mutate();
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="ml-name">Name</Label>
            <Input id="ml-name" value={form.name} onChange={(e) => set("name", e.target.value)} autoFocus maxLength={kind === "LOCATION" ? 100 : 200} />
            {clash ? (
              <p className="flex items-start gap-1.5 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {lowerKey(clash.name) === lowerKey(name)
                  ? `"${clash.name}" is already in the list.`
                  : `Looks the same as "${clash.name}". Use that one, or merge them in Duplicates.`}
              </p>
            ) : renamed && entry.usage > 0 ? (
              <p className="text-xs text-muted-foreground">
                The new spelling replaces "{entry.name}" on {usageText(kind, entry).toLowerCase()}.
              </p>
            ) : null}
          </div>

          {kind === "CLIENT" && (
            <div className="grid gap-2">
              <Label htmlFor="ml-code">Code <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Input
                id="ml-code"
                value={form.code}
                onChange={(e) => set("code", e.target.value.toUpperCase())}
                placeholder="e.g. BIGC"
                maxLength={30}
                className="font-mono uppercase"
              />
              {codeBad && <p className="text-xs text-destructive">Letters, numbers, - and _ only.</p>}
            </div>
          )}

          {kind === "LOCATION" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Hyderabad / Non-local</Label>
                <Select value={form.locality} onValueChange={(v) => set("locality", v as Locality)}>
                  <SelectTrigger aria-label="Hyderabad or Non-local"><SelectValue placeholder="Pick one" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LOCAL">Hyderabad</SelectItem>
                    <SelectItem value="NON_LOCAL">Non-local</SelectItem>
                  </SelectContent>
                </Select>
                {entry?.needs_confirmation && <p className="text-xs text-muted-foreground">Saving marks it reviewed.</p>}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ml-district">District <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Input id="ml-district" value={form.district} onChange={(e) => set("district", e.target.value)} maxLength={100} />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!canSave}>
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {entry ? "Save" : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
