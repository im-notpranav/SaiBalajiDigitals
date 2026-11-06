import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Download, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiErrorMessage, fetchCsmOptions } from "@/api/allocation";
import {
  createBulkOrders,
  downloadOrderTemplate,
  previewBulkOrders,
  type BulkOrder,
  type BulkPreview,
} from "@/api/orders";
import { inr } from "@/lib/format";

const dayLabel = (d: string) => {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
};

const totalsOf = (o: BulkOrder) => {
  const items = o.stores.flatMap((s) => s.items);
  return {
    items: items.length,
    sft: items.reduce((n, i) => n + i.total_sft, 0),
    amount: items.reduce((n, i) => n + i.amount, 0),
  };
};

/**
 * Upload the company's order sheet, check each client's order, then save them all. An admin
 * also picks the CSM each order goes to; a CSM's orders are their own.
 */
export function BulkOrderUpload({ pickCsm, ordersLink }: { pickCsm: boolean; ordersLink: "/employee/orders" | "/admin/orders" }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<BulkPreview | null>(null);
  const [csmFor, setCsmFor] = useState<Record<string, number>>({});
  const [created, setCreated] = useState<{ order_no: string; client_name: string }[] | null>(null);

  const { data: csmData } = useQuery({
    queryKey: ["work-jobs", "csm-options"],
    queryFn: fetchCsmOptions,
    enabled: pickCsm,
  });

  const clear = () => {
    setPreview(null);
    setCsmFor({});
    if (fileRef.current) fileRef.current.value = "";
  };

  const read = useMutation({
    mutationFn: previewBulkOrders,
    onMutate: () => {
      setPreview(null);
      setCreated(null);
      setCsmFor({});
    },
    onSuccess: setPreview,
    onError: (err) => toast.error("Could not read the file", { description: apiErrorMessage(err, "Please try again.") }),
  });

  const save = useMutation({
    mutationFn: () =>
      createBulkOrders(preview!.orders.map((o) => ({ ...o, csm_user_id: pickCsm ? csmFor[o.client_name] : undefined }))),
    onSuccess: (res) => {
      setCreated(res.orders);
      toast.success(`${res.orders.length} order(s) created`);
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["order-sequence"] });
      clear();
    },
    onError: (err) => toast.error("Nothing was saved", { description: apiErrorMessage(err, "Please try again.") }),
  });

  const handleTemplate = async () => {
    try {
      await downloadOrderTemplate();
    } catch (err: any) {
      toast.error("Could not download template", { description: err?.message });
    }
  };

  const orders = preview?.orders ?? [];
  const hasErrors = (preview?.error_count ?? 0) > 0;
  const everyCsmPicked = !pickCsm || orders.every((o) => csmFor[o.client_name]);
  const canSave = orders.length > 0 && !hasErrors && everyCsmPicked && !save.isPending;

  return (
    <div className="space-y-6">
      <section className="surface-panel p-6">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">How it works</h3>
        <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
          <li>One row is one item. Each <strong>Client Name</strong> becomes one order.</li>
          <li>The first date on a client's rows is the order date.</li>
          <li>S.No, Order No, Total SFT and Amount in the file are ignored. The system gives the number and works out the SFT and Amount.</li>
          <li>Nothing is saved until you check the orders below and press create.</li>
        </ul>
        <div className="mt-4 flex flex-col sm:flex-row gap-3 sm:items-center">
          <Button variant="outline" onClick={handleTemplate}>
            <Download className="mr-2 h-4 w-4" /> Download template
          </Button>
          <input
            ref={fileRef}
            type="file"
            aria-label="Excel file to upload"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={read.isPending || save.isPending}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) read.mutate(file);
            }}
            className="block text-sm file:mr-3 file:rounded-lg file:border file:bg-muted file:px-3 file:py-1.5 file:text-sm"
          />
          {read.isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
      </section>

      {created && (
        <section className="rounded-xl border border-success/30 bg-success/5 p-4 text-sm">
          <div className="flex items-center gap-2 font-semibold text-success">
            <CheckCircle2 className="h-5 w-5" /> {created.length} order(s) created
          </div>
          <ul className="mt-2 space-y-0.5 text-muted-foreground">
            {created.map((o) => (
              <li key={o.order_no}>
                <span className="font-medium text-foreground">{o.order_no}</span> {o.client_name}
              </li>
            ))}
          </ul>
          <Link to={ordersLink} className="mt-2 inline-block font-medium text-primary underline-offset-4 hover:underline">
            Go to orders
          </Link>
        </section>
      )}

      {hasErrors && (
        <section className="rounded-xl border border-destructive/30 bg-destructive/5 overflow-hidden">
          <div className="flex items-center gap-2 p-4 font-semibold text-destructive">
            <AlertTriangle className="h-5 w-5" /> {preview!.error_count} problem(s). Fix the file and upload it again.
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Sheet row</TableHead>
                <TableHead>Problem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview!.errors.map((e, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">Row {e.row}</TableCell>
                  <TableCell>{e.message}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}

      {orders.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Check {orders.length} order(s)
          </h3>
          {orders.map((o) => {
            const totals = totalsOf(o);
            return (
              <div key={o.client_name} className="surface-panel p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="font-semibold">{o.client_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {o.expected_order_no ? `About ${o.expected_order_no}` : "Number given on saving"} · {dayLabel(o.date)} · {o.stores.length} store(s) · {totals.items} item(s)
                    </div>
                    <div className="mt-1 text-sm">
                      {totals.sft.toFixed(2)} SFT · <span className="font-medium">{inr(totals.amount)}</span>
                    </div>
                    {o.has_other_dates && (
                      <div className="mt-1 text-xs text-warning">
                        This client's rows have more than one date. The order keeps {dayLabel(o.date)} only.
                      </div>
                    )}
                  </div>
                  {pickCsm && (
                    <div className="w-full sm:w-56">
                      <Select
                        value={csmFor[o.client_name] ? String(csmFor[o.client_name]) : undefined}
                        onValueChange={(v) => setCsmFor((m) => ({ ...m, [o.client_name]: Number(v) }))}
                      >
                        <SelectTrigger aria-label={`CSM for ${o.client_name}`}>
                          <SelectValue placeholder="Pick a CSM" />
                        </SelectTrigger>
                        <SelectContent>
                          {(csmData?.csms ?? []).map((c) => (
                            <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Show the rows</summary>
                  <div className="mt-2 overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Location</TableHead>
                          <TableHead>Store Name</TableHead>
                          <TableHead>Media</TableHead>
                          <TableHead className="text-right">W</TableHead>
                          <TableHead className="text-right">H</TableHead>
                          <TableHead className="text-right">Qty</TableHead>
                          <TableHead className="text-right">SFT</TableHead>
                          <TableHead className="text-right">Rate</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {o.stores.flatMap((s) =>
                          s.items.map((it, i) => (
                            <TableRow key={`${s.store_name}-${s.location}-${i}`}>
                              <TableCell>{s.location}</TableCell>
                              <TableCell>{s.store_name}</TableCell>
                              <TableCell>{it.media}</TableCell>
                              <TableCell className="text-right">{it.width_inches}</TableCell>
                              <TableCell className="text-right">{it.height_inches}</TableCell>
                              <TableCell className="text-right">{it.qty}</TableCell>
                              <TableCell className="text-right">{it.total_sft.toFixed(2)}</TableCell>
                              <TableCell className="text-right">{it.rate}</TableCell>
                              <TableCell className="text-right">{inr(it.amount)}</TableCell>
                            </TableRow>
                          )),
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </details>
              </div>
            );
          })}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            {!hasErrors && !everyCsmPicked && (
              <span className="text-xs text-muted-foreground">Pick a CSM for every order first.</span>
            )}
            <Button variant="outline" onClick={clear} disabled={save.isPending}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={!canSave}>
              {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Create {orders.length} order(s)
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
