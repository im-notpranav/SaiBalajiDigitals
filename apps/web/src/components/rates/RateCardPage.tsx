import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Check, Download, FileSpreadsheet, Loader2, Pencil, Plus, Tags, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "@/components/layout/PageStates";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ClientCombobox, MediaCombobox } from "@/components/orders/AutocompleteComboboxes";
import {
  approveRateCard,
  createRateCard,
  deleteRateCard,
  downloadRateExport,
  downloadRateTemplate,
  fetchRateCards,
  importRateCards,
  rejectRateCard,
  updateRateCard,
  type RateCard,
  type RateImportResult,
} from "@/api/rateCards";
import { friendlyError } from "@/lib/friendly-error";
import { inr } from "@/lib/format";
import { cn } from "@/lib/utils";

type View = "current" | "waiting" | "history";
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  ACTIVE: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  REJECTED: "bg-destructive/10 text-destructive",
};

/**
 * Rate cards: one rate per client and line item, from a date. The admin adds, edits, uploads
 * and approves; a CSM sees them and asks for new ones; the Operation Manager only looks.
 */
export function RateCardPage({ mode }: { mode: "admin" | "csm" | "view" }) {
  const qc = useQueryClient();
  const [client, setClient] = useState("");
  const [view, setView] = useState<View>("current");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<RateCard | null>(null);
  const [deciding, setDeciding] = useState<{ rate: RateCard; action: "approve" | "reject" } | null>(null);
  const [uploading, setUploading] = useState(false);
  const isAdmin = mode === "admin";

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["rate-cards", client.trim().toLowerCase()],
    queryFn: () => fetchRateCards({ client: client.trim() || undefined }),
  });
  const all = useMemo(() => data?.rates ?? [], [data]);
  const waitingCount = all.filter((r) => r.status === "PENDING").length;
  const rows = useMemo(
    () =>
      view === "current"
        ? all.filter((r) => r.in_force || (r.status === "ACTIVE" && r.effective_from > today()))
        : view === "waiting"
          ? all.filter((r) => r.status === "PENDING")
          : all,
    [all, view],
  );

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["rate-cards"] });
    qc.invalidateQueries({ queryKey: ["rate-card-lookup"] });
    qc.invalidateQueries({ queryKey: ["rate-card-count"] });
  };
  const remove = useMutation({
    mutationFn: (id: number) => deleteRateCard(id),
    onSuccess: () => {
      refresh();
      toast.success("Rate removed");
    },
    onError: (e) => toast.error("Not removed", { description: friendlyError(e) }),
  });

  return (
    <>
      <PageHeader
        title="Rate Cards"
        description={
          isAdmin
            ? "The agreed rate per client and line item. Order lines take the rate in force on the order date."
            : "The agreed rate per client and line item. New rates you ask for go to the admin."
        }
        crumbs={[{ label: isAdmin ? "Automated System" : "Orders" }, { label: "Rate Cards" }]}
        actions={
          <div className="flex flex-wrap gap-2">
            {mode !== "view" && (
              <Button onClick={() => setAdding(true)}>
                <Plus className="mr-1.5 h-4 w-4" /> {isAdmin ? "Add rate" : "Ask for a rate"}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => downloadRateExport(client.trim() || undefined).catch((e) => toast.error("Download failed", { description: friendlyError(e) }))}
            >
              <Download className="mr-1.5 h-4 w-4" /> {client.trim() ? "Download client" : "Download all"}
            </Button>
            {isAdmin && (
              <Button variant="outline" onClick={() => setUploading(true)}>
                <Upload className="mr-1.5 h-4 w-4" /> Upload
              </Button>
            )}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-full max-w-sm space-y-1">
          <Label htmlFor="rc-client" className="text-xs text-muted-foreground">
            Client
          </Label>
          <div className="flex gap-2">
            <ClientCombobox id="rc-client" value={client} onChange={setClient} className="h-9 flex-1" />
            {client && (
              <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setClient("")} aria-label="Show every client">
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        <div className="inline-flex rounded-lg bg-muted p-1 text-sm" role="tablist" aria-label="Which rates">
          {(
            [
              ["current", "In force"],
              ["waiting", `Waiting${waitingCount ? ` (${waitingCount})` : ""}`],
              ["history", "All history"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn("rounded-md px-3 py-1.5 font-medium", view === v ? "bg-background shadow-sm" : "text-muted-foreground")}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Tags}
          title={view === "waiting" ? "Nothing waiting" : "No rates yet"}
          description={client ? `No rates for ${client} here.` : "Add a rate, or upload the rate card sheet."}
        />
      ) : (
        <div className="surface-panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Line item</TableHead>
                <TableHead className="text-right">Rate (₹/sft)</TableHead>
                <TableHead>From</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>By</TableHead>
                {mode !== "view" && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    {r.client.name}
                    {r.client.code && <span className="ml-1 text-xs text-muted-foreground">{r.client.code}</span>}
                  </TableCell>
                  <TableCell>{r.media.name}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{inr(r.rate)}</TableCell>
                  <TableCell className="tabular-nums">{format(new Date(r.effective_from), "dd MMM yyyy")}</TableCell>
                  <TableCell>
                    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase", STATUS_STYLE[r.status])}>
                      {r.status === "ACTIVE" ? (r.in_force ? "in force" : r.effective_from > today() ? "upcoming" : "replaced") : r.status.toLowerCase()}
                    </span>
                    {r.decision_note && (
                      <div className="mt-0.5 max-w-[220px] truncate text-[11px] text-muted-foreground" title={r.decision_note}>
                        {r.decision_note}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.creator?.name ?? "—"}
                    {r.note && (
                      <div className="max-w-[200px] truncate" title={r.note}>
                        {r.note}
                      </div>
                    )}
                  </TableCell>
                  {mode !== "view" && (
                    <TableCell className="text-right">
                      {isAdmin && r.status === "PENDING" ? (
                        <div className="flex justify-end gap-1.5">
                          <Button size="sm" className="h-7" onClick={() => setDeciding({ rate: r, action: "approve" })}>
                            <Check className="mr-1 h-3.5 w-3.5" /> Approve
                          </Button>
                          <Button size="sm" variant="outline" className="h-7" onClick={() => setDeciding({ rate: r, action: "reject" })}>
                            <X className="mr-1 h-3.5 w-3.5" /> Reject
                          </Button>
                        </div>
                      ) : isAdmin && r.status === "ACTIVE" ? (
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(r)} aria-label={`Edit ${r.media.name} rate`}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive"
                            aria-label={`Remove ${r.media.name} rate`}
                            onClick={() => {
                              if (window.confirm(`Remove ${r.media.name} at ${r.client.name} (${inr(r.rate)})? Lines already priced keep their rate.`)) remove.mutate(r.id);
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : null}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {adding && <RateDialog isAdmin={isAdmin} initialClient={client} onClose={() => setAdding(false)} onSaved={refresh} />}
      {editing && <RateDialog isAdmin rate={editing} onClose={() => setEditing(null)} onSaved={refresh} />}
      {deciding && <DecideRateDialog rate={deciding.rate} action={deciding.action} onClose={() => setDeciding(null)} onSaved={refresh} />}
      {uploading && <UploadDialog onClose={() => setUploading(false)} onSaved={refresh} />}
    </>
  );
}

function RateDialog({
  isAdmin,
  rate,
  initialClient = "",
  onClose,
  onSaved,
}: {
  isAdmin: boolean;
  rate?: RateCard;
  initialClient?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [client, setClient] = useState(rate?.client.name ?? initialClient);
  const [media, setMedia] = useState(rate?.media.name ?? "");
  const [value, setValue] = useState(rate ? String(rate.rate) : "");
  const [from, setFrom] = useState(rate?.effective_from ?? today());
  const [note, setNote] = useState(rate?.note ?? "");
  const save = useMutation({
    mutationFn: () =>
      rate
        ? updateRateCard(rate.id, { rate: Number(value), effective_from: from, note: note.trim() || null })
        : createRateCard({ client_name: client.trim(), media: media.trim(), rate: Number(value), effective_from: from, note: note.trim() || null }),
    onSuccess: () => {
      onSaved();
      toast.success(rate ? "Rate updated" : isAdmin ? "Rate added" : "Rate sent for approval");
      onClose();
    },
    onError: (e) => toast.error("Not saved", { description: friendlyError(e) }),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{rate ? `Edit ${rate.media.name} at ${rate.client.name}` : isAdmin ? "Add a rate" : "Ask for a rate"}</DialogTitle>
          <DialogDescription>{isAdmin ? "It prices order lines from the date you give." : "The admin approves it before order lines take it."}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!rate && (!client.trim() || !media.trim())) return void toast.error("Pick the client and the line item.");
            if (!(Number(value) > 0)) return void toast.error("Enter the rate.");
            save.mutate();
          }}
        >
          {!rate && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="rate-client">Client *</Label>
                <ClientCombobox id="rate-client" value={client} onChange={setClient} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rate-media">Line item *</Label>
                <MediaCombobox id="rate-media" value={media} onChange={setMedia} className="h-9" />
              </div>
            </>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rate-value">Rate (₹ per sft) *</Label>
              <Input id="rate-value" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ""))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rate-from">From</Label>
              <Input id="rate-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rate-note">Note</Label>
            <Textarea id="rate-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Agreed in the October meeting" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {rate ? "Save" : isAdmin ? "Add" : "Send for approval"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DecideRateDialog({ rate, action, onClose, onSaved }: { rate: RateCard; action: "approve" | "reject"; onClose: () => void; onSaved: () => void }) {
  const approve = action === "approve";
  const [value, setValue] = useState(String(rate.rate));
  const [note, setNote] = useState("");
  const decide = useMutation({
    mutationFn: () => (approve ? approveRateCard(rate.id, { rate: Number(value), note: note.trim() || null }) : rejectRateCard(rate.id, note.trim())),
    onSuccess: () => {
      onSaved();
      toast.success(approve ? "Rate approved" : "Rate rejected", { description: `${rate.creator?.name ?? "The CSM"} has been told.` });
      onClose();
    },
    onError: (e) => toast.error("Not saved", { description: friendlyError(e) }),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {approve ? "Approve" : "Reject"} {rate.media.name} at {rate.client.name}
          </DialogTitle>
          <DialogDescription>
            {rate.creator?.name ?? "A CSM"} asked {inr(rate.rate)} from {format(new Date(rate.effective_from), "dd MMM yyyy")}.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!approve && note.trim().length < 3) return void toast.error("Say why it is rejected.");
            if (approve && !(Number(value) > 0)) return void toast.error("Enter the rate.");
            decide.mutate();
          }}
        >
          {approve && (
            <div className="space-y-1.5">
              <Label htmlFor="decide-rate">Rate (₹ per sft), change it if needed</Label>
              <Input id="decide-rate" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ""))} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="decide-rate-note">{approve ? "Note (optional)" : "Why it is rejected *"}</Label>
            <Textarea id="decide-rate-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant={approve ? "default" : "destructive"} disabled={decide.isPending}>
              {decide.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {approve ? "Approve" : "Reject"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UploadDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<RateImportResult | null>(null);
  const run = useMutation({
    mutationFn: (v: { file: File; preview: boolean }) => importRateCards(v.file, v.preview),
    onSuccess: (r) => {
      setResult(r);
      if (r.applied) {
        onSaved();
        toast.success("Rate card uploaded", { description: `${r.added} added, ${r.updated} changed.` });
        onClose();
      }
    },
    onError: (e) => toast.error("Upload failed", { description: friendlyError(e) }),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Upload the rate card</DialogTitle>
          <DialogDescription>
            Columns: Client, Line item, Rate, Effective from (blank means today). Each row adds a rate, or changes the one with the same client, line item and
            date. Nothing is deleted.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => downloadRateTemplate().catch((e) => toast.error("Download failed", { description: friendlyError(e) }))}>
            <FileSpreadsheet className="mr-1.5 h-4 w-4" /> Template
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              setResult(null);
              if (f) run.mutate({ file: f, preview: true });
            }}
          />
          <Button size="sm" onClick={() => fileRef.current?.click()} disabled={run.isPending}>
            <Upload className="mr-1.5 h-4 w-4" /> {file ? "Pick another file" : "Pick the file"}
          </Button>
          {file && <span className="truncate text-xs text-muted-foreground">{file.name}</span>}
          {run.isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
        {result && !result.applied && (
          <div className="space-y-2 text-sm">
            <p>
              <strong>{result.row_count}</strong> row{result.row_count === 1 ? "" : "s"} ready
              {result.error_count > 0 && <span className="text-destructive">, {result.error_count} skipped</span>}.
            </p>
            {result.errors.length > 0 && (
              <ul className="max-h-40 overflow-y-auto rounded-lg border bg-destructive/5 p-2 text-xs">
                {result.errors.map((e) => (
                  <li key={e.row}>
                    Row {e.row}: {e.message}
                  </li>
                ))}
              </ul>
            )}
            {result.rows.length > 0 && (
              <ul className="max-h-48 overflow-y-auto rounded-lg border p-2 text-xs tabular-nums">
                {result.rows.map((r) => (
                  <li key={r.row}>
                    {r.client} · {r.media} · {inr(r.rate)} from {r.effective_from}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!file || !result || result.row_count === 0 || run.isPending} onClick={() => file && run.mutate({ file, preview: false })}>
            Save {result?.row_count ?? 0} row{result?.row_count === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
