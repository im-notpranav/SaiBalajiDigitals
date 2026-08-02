import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Upload, Loader2, CheckCircle2, AlertTriangle, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { downloadImportTemplate, bulkImportOrders, type ImportResult } from "@/api/orders";
import { useAuth } from "@/lib/auth-store";

export const Route = createFileRoute("/_portal/admin/import")({
  head: () => ({ meta: [{ title: "Bulk Import — SB OMS" }] }),
  component: ImportPage,
});

function ImportPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [rowErrors, setRowErrors] = useState<{ row: number; message: string }[] | null>(null);

  if (!user?.is_super_admin) {
    return (
      <>
        <PageHeader title="Bulk Import" crumbs={[{ label: "Administrator" }, { label: "Bulk Import" }]} />
        <div className="surface-panel p-8 flex items-center gap-3 text-muted-foreground">
          <ShieldAlert className="h-5 w-5 text-warning" />
          Only the super administrator can import orders.
        </div>
      </>
    );
  }

  const handleImport = async () => {
    if (!file) { toast.error("Choose an .xlsx file first."); return; }
    setBusy(true);
    setResult(null);
    setRowErrors(null);
    try {
      const res = await bulkImportOrders(file);
      setResult(res);
      toast.success(res.message, { description: `${res.orders_imported} orders, ${res.line_items_imported} line items.` });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (err: any) {
      const data = err?.response?.data;
      if (data?.errors) {
        setRowErrors(data.errors);
        toast.error(data.message || "Import rejected.");
      } else {
        toast.error("Import failed", { description: data?.message || err.message });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleTemplate = async () => {
    try { await downloadImportTemplate(); } catch (err: any) { toast.error("Could not download template", { description: err.message }); }
  };

  return (
    <>
      <PageHeader
        title="Bulk Import"
        description="Create orders in bulk from a spreadsheet. The sheet's date drives each order's timeline."
        crumbs={[{ label: "Administrator" }, { label: "Bulk Import" }]}
      />

      <div className="space-y-6">
        <section className="surface-panel p-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">How it works</h3>
          <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
            <li>One row per line item. Rows sharing an <strong>Order No</strong> become one order.</li>
            <li>Required columns: Order No, Date, Client Name, Store Name, Location, Employee (username), Media, Size (W) in, Size (H) in, Qty, Rate. PO Number is optional.</li>
            <li>The <strong>Date</strong> column sets each order's business date and drives its turnaround clock.</li>
            <li>Orders are created as <strong>Active</strong> and attributed to the <strong>Employee</strong> named in each row.</li>
            <li>Validation is all-or-nothing: if any row has a problem, nothing is imported and every issue is listed below.</li>
          </ul>
          <Button variant="outline" className="mt-4" onClick={handleTemplate}>
            <Download className="mr-2 h-4 w-4" /> Download template
          </Button>
        </section>

        <section className="surface-panel p-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Upload</h3>
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); setRowErrors(null); }}
              className="block text-sm file:mr-3 file:rounded-lg file:border file:bg-muted file:px-3 file:py-1.5 file:text-sm"
            />
            <Button onClick={handleImport} disabled={busy || !file}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Import
            </Button>
          </div>

          {result && (
            <div className="mt-4 rounded-xl border border-success/30 bg-success/5 p-4 text-sm">
              <div className="flex items-center gap-2 font-semibold text-success">
                <CheckCircle2 className="h-5 w-5" /> {result.message}
              </div>
              <div className="mt-1 text-muted-foreground">
                {result.orders_imported} orders and {result.line_items_imported} line items imported.
              </div>
            </div>
          )}

          {rowErrors && (
            <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-0 overflow-hidden">
              <div className="flex items-center gap-2 p-4 font-semibold text-destructive">
                <AlertTriangle className="h-5 w-5" /> {rowErrors.length} problem(s) — nothing was imported. Fix and re-upload.
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">Sheet Row</TableHead>
                    <TableHead>Problem</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rowErrors.map((e, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">Row {e.row}</TableCell>
                      <TableCell>{e.message}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
