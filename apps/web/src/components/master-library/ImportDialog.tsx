import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorState, errorText } from "@/components/layout/PageStates";
import { cn } from "@/lib/utils";
import {
  applyMasterImport,
  downloadMasterTemplate,
  masterKeys,
  previewMasterImport,
  type ImportSheetSummary,
} from "@/api/masterLibrary";
import { CountBubble } from "./shared";

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Import in two steps: pick the file and see what would change, then apply. The same file is
 * sent again on apply and checked afresh, so nothing saved depends on a stale preview.
 */
export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [wasOpen, setWasOpen] = useState(false);

  const preview = useMutation({ mutationFn: (f: File) => previewMasterImport(f) });
  const apply = useMutation({
    mutationFn: (f: File) => applyMasterImport(f),
    onSuccess: (res) => {
      const added = res.sheets.reduce((s, x) => s + x.add, 0);
      const updated = res.sheets.reduce((s, x) => s + x.update, 0);
      toast.success("Import done", { description: `${added} added, ${updated} updated.` });
      qc.invalidateQueries({ queryKey: masterKeys.all });
      onClose();
    },
    onError: (err) => toast.error(errorText(err, "Could not import the file")),
  });

  // A fresh start each time the dialog opens.
  if (open && !wasOpen) {
    setWasOpen(true);
    setFile(null);
    preview.reset();
    apply.reset();
  } else if (!open && wasOpen) {
    setWasOpen(false);
  }

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_BYTES) {
      toast.error("Files can be up to 5 MB.");
      return;
    }
    setFile(f);
    preview.mutate(f);
  };

  const sheets = preview.data?.sheets ?? [];
  const changes = sheets.reduce((s, x) => s + x.add + x.update, 0);
  const errors = sheets.reduce((s, x) => s + x.error_count, 0);
  const firstWithWork = sheets.find((s) => s.found && (s.add || s.update || s.error_count || s.problem)) ?? sheets.find((s) => s.found);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !apply.isPending && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import names</DialogTitle>
          <DialogDescription>
            One Excel file with Clients, Media and Locations sheets. New names are added, known ones updated. Nothing is deleted.
          </DialogDescription>
        </DialogHeader>

        <input
          ref={input}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />

        {!file ? (
          <button
            type="button"
            onClick={() => input.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              pick(e.dataTransfer.files?.[0]);
            }}
            className="flex min-h-[12rem] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors hover:bg-muted/50"
          >
            <Upload className="h-6 w-6 text-muted-foreground" />
            <span className="font-medium">Choose the .xlsx file</span>
            <span className="text-xs text-muted-foreground">or drop it here · up to 5 MB</span>
          </button>
        ) : (
          <div className="grid min-h-[12rem] gap-3">
            <div className="flex items-center gap-2 rounded-xl border p-2.5 text-sm">
              <FileSpreadsheet className="h-4 w-4 shrink-0 text-success" />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <Button variant="ghost" size="sm" onClick={() => input.current?.click()} disabled={preview.isPending || apply.isPending}>
                Choose another
              </Button>
            </div>

            {preview.isPending ? (
              <div className="grid gap-2" aria-label="Reading the file" role="status">
                <div className="grid grid-cols-3 gap-2">
                  {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
                </div>
                <Skeleton className="h-40 rounded-xl" />
              </div>
            ) : preview.error ? (
              <ErrorState bare title="Could not read this file" error={preview.error} onRetry={() => preview.mutate(file)} />
            ) : preview.data ? (
              <>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {sheets.map((s) => <SheetCard key={s.kind} s={s} />)}
                </div>
                {firstWithWork && (
                  <Tabs defaultValue={firstWithWork.kind}>
                    <TabsList>
                      {sheets.filter((s) => s.found).map((s) => (
                        <TabsTrigger key={s.kind} value={s.kind}>
                          {s.sheet}
                          <CountBubble n={s.error_count} tone="warning" />
                        </TabsTrigger>
                      ))}
                    </TabsList>
                    {sheets.filter((s) => s.found).map((s) => (
                      <TabsContent key={s.kind} value={s.kind}>
                        <SheetDetail s={s} />
                      </TabsContent>
                    ))}
                  </Tabs>
                )}
              </>
            ) : null}
          </div>
        )}

        <DialogFooter className="gap-2 sm:items-center">
          {!file && (
            <Button variant="link" className="mr-auto px-0" onClick={() => downloadMasterTemplate().catch((e) => toast.error(errorText(e, "Could not download")))}>
              Download the template
            </Button>
          )}
          {preview.data && errors > 0 && changes > 0 && (
            <span className="mr-auto text-xs text-muted-foreground">Rows with errors are skipped.</span>
          )}
          <Button variant="outline" onClick={onClose} disabled={apply.isPending}>Cancel</Button>
          <Button onClick={() => file && apply.mutate(file)} disabled={!preview.data || changes === 0 || apply.isPending}>
            {apply.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {preview.data && changes === 0 ? "Nothing to change" : `Apply${changes ? ` ${changes} change${changes === 1 ? "" : "s"}` : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SheetCard({ s }: { s: ImportSheetSummary }) {
  return (
    <div className={cn("rounded-xl border p-3", !s.found && "opacity-60")}>
      <div className="text-sm font-semibold">{s.sheet}</div>
      {!s.found ? (
        <div className="mt-1 text-xs text-muted-foreground">Not in the file</div>
      ) : s.problem ? (
        <div className="mt-1 text-xs text-destructive">{s.problem}</div>
      ) : (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs tabular-nums">
          <span className="text-success">{s.add} new</span>
          <span className="text-primary">{s.update} updated</span>
          <span className="text-muted-foreground">{s.unchanged} same</span>
          {s.error_count > 0 && <span className="text-destructive">{s.error_count} error{s.error_count === 1 ? "" : "s"}</span>}
        </div>
      )}
    </div>
  );
}

function SheetDetail({ s }: { s: ImportSheetSummary }) {
  if (s.problem) {
    return (
      <p className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" /> {s.problem}
      </p>
    );
  }
  const rows = [
    ...s.errors.map((e) => ({ row: e.row, kind: "error" as const, name: "", detail: e.message })),
    ...s.changes.map((c) => ({ row: c.row, kind: c.action, name: c.name, detail: c.detail })),
  ].sort((a, b) => a.row - b.row);
  if (rows.length === 0) return <p className="p-4 text-center text-sm text-muted-foreground">Everything on this sheet is already in the list.</p>;
  return (
    <div className="max-h-[40vh] overflow-y-auto rounded-xl border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-muted/90 text-xs text-muted-foreground backdrop-blur">
          <tr>
            <th className="w-14 px-3 py-2 text-left font-medium">Row</th>
            <th className="w-24 px-3 py-2 text-left font-medium">Change</th>
            <th className="px-3 py-2 text-left font-medium">Name</th>
            <th className="hidden px-3 py-2 text-left font-medium sm:table-cell">Details</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.row}-${i}`} className="border-t align-top">
              <td className="px-3 py-1.5 tabular-nums text-muted-foreground">{r.row}</td>
              <td className="px-3 py-1.5">
                {r.kind === "error" ? (
                  <Badge variant="outline" className="border-destructive/40 text-destructive">Error</Badge>
                ) : r.kind === "add" ? (
                  <Badge variant="outline" className="border-success/40 text-success">New</Badge>
                ) : (
                  <Badge variant="outline" className="border-primary/40 text-primary">Update</Badge>
                )}
              </td>
              <td className="px-3 py-1.5">
                {r.kind === "error" ? <span className="text-destructive">{r.detail}</span> : <span className="font-medium">{r.name}</span>}
                {r.kind !== "error" && r.detail && <div className="text-xs text-muted-foreground sm:hidden">{r.detail}</div>}
              </td>
              <td className="hidden px-3 py-1.5 text-muted-foreground sm:table-cell">{r.kind === "error" ? "" : r.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(s.more_changes > 0 || s.error_count > s.errors.length) && (
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">
          {s.more_changes > 0 && `${s.more_changes} more changes not shown. `}
          {s.error_count > s.errors.length && `${s.error_count - s.errors.length} more errors not shown.`}
        </p>
      )}
    </div>
  );
}
