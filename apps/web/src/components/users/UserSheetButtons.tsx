import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { apiClient, apiDownload } from "@/api/client";
import { friendlyError } from "@/lib/friendly-error";
import { cn } from "@/lib/utils";

/**
 * The staff sheet (OMS User Template) on the Users page, for the super admin: download the
 * template or everyone, and upload a filled sheet. The upload is shown first and saved only
 * when the admin says so. Passwords are never downloaded.
 */

interface ImportRow {
  row: number;
  username: string;
  name: string;
  action: "add" | "update" | "error";
  detail: string;
}

interface ImportResult {
  applied: boolean;
  add: number;
  update: number;
  unchanged: number;
  error_count: number;
  rows: ImportRow[];
}

const sendSheet = async (file: File, preview: boolean) =>
  (
    await apiClient.post<ImportResult>(`/users/import${preview ? "?preview=1" : ""}`, file, {
      headers: { "Content-Type": "application/octet-stream" },
    })
  ).data;

const ACTION_STYLE: Record<ImportRow["action"], string> = {
  add: "bg-success/15 text-success",
  update: "bg-primary/10 text-primary",
  error: "bg-destructive/10 text-destructive",
};

export function UserSheetButtons() {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const run = useMutation({
    mutationFn: (v: { file: File; preview: boolean }) => sendSheet(v.file, v.preview),
    onSuccess: (res) => {
      if (res.applied) {
        toast.success(`${res.add} added, ${res.update} updated`, res.error_count ? { description: `${res.error_count} rows skipped.` } : undefined);
        qc.invalidateQueries({ queryKey: ["users"] });
        setFile(null);
        setResult(null);
      } else setResult(res);
    },
    onError: (err) => toast.error(friendlyError(err, "Could not read the sheet")),
  });

  const download = (path: string) => apiDownload(path).catch((err) => toast.error(friendlyError(err, "Could not download")));

  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setFile(f);
          run.mutate({ file: f, preview: true });
        }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="rounded-xl" disabled={run.isPending}>
            {run.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-2 h-4 w-4" />}
            Sheet
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => input.current?.click()}>
            <Upload className="mr-2 h-4 w-4" /> Upload filled sheet
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void download("/users/template")}>
            <Download className="mr-2 h-4 w-4" /> Blank template
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void download("/users/export")}>
            <Download className="mr-2 h-4 w-4" /> Everyone (no passwords)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={!!result} onOpenChange={(o) => !o && !run.isPending && setResult(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Check the sheet</DialogTitle>
            <DialogDescription>
              Nothing is saved yet. A user name already in the app is updated; its password changes only where the Password cell is filled.
            </DialogDescription>
          </DialogHeader>
          {result && (
            <div className="grid gap-3">
              <div className="flex flex-wrap gap-2 text-sm">
                <Badge className="bg-success/15 text-success hover:bg-success/15">{result.add} new</Badge>
                <Badge className="bg-primary/10 text-primary hover:bg-primary/10">{result.update} updated</Badge>
                <Badge variant="secondary">{result.unchanged} unchanged</Badge>
                {result.error_count > 0 && <Badge className="bg-destructive/10 text-destructive hover:bg-destructive/10">{result.error_count} skipped</Badge>}
              </div>
              {result.rows.length > 0 && (
                <div className="max-h-[50dvh] overflow-y-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="px-2 py-1.5">Row</th>
                        <th className="px-2 py-1.5">User</th>
                        <th className="px-2 py-1.5">What happens</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((r) => (
                        <tr key={r.row} className="border-t">
                          <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{r.row}</td>
                          <td className="px-2 py-1.5">
                            <div className="font-medium">{r.name || "—"}</div>
                            <div className="font-mono text-xs text-muted-foreground">{r.username}</div>
                          </td>
                          <td className="px-2 py-1.5">
                            <span className={cn("mr-1.5 rounded px-1.5 py-0.5 text-xs font-medium", ACTION_STYLE[r.action])}>
                              {r.action === "add" ? "New" : r.action === "update" ? "Update" : "Skipped"}
                            </span>
                            {r.detail}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setResult(null)} disabled={run.isPending}>Cancel</Button>
            <Button disabled={!file || !result || result.add + result.update === 0 || run.isPending} onClick={() => file && run.mutate({ file, preview: false })}>
              {run.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save {result ? result.add + result.update : 0} people
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
