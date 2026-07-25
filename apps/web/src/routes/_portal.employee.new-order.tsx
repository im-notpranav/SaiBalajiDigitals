import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Trash2, Plus, Save, Send, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { inr } from "@/lib/format";
import { createOrder } from "@/api/orders";
import { PRODUCTION_REMARK_TYPES } from "@/lib/constants";
import type { RemarkType } from "@sb-oms/shared-types";

export const Route = createFileRoute("/_portal/employee/new-order")({
  head: () => ({ meta: [{ title: "New Order — SB OMS" }] }),
  component: NewOrder,
});

interface Line {
  id: string;
  media: string;
  width_inches: number;
  height_inches: number;
  qty: number;
  rate: number;
  remarks?: RemarkType | "none";
}

function NewOrder() {
  const navigate = useNavigate();
  const [clientName, setClientName] = useState("");
  const [storeName, setStoreName] = useState("");
  const [location, setLocation] = useState("");
  const [poNumber, setPoNumber] = useState("");
  
  const [lines, setLines] = useState<Line[]>([
    { id: crypto.randomUUID(), media: "", width_inches: 0, height_inches: 0, qty: 1, rate: 0, remarks: "none" },
  ]);
  const [saving, setSaving] = useState(false);

  const getSft = (l: Line) => (l.width_inches * l.height_inches) / 144;
  const getLineTotal = (l: Line) => getSft(l) * l.qty * l.rate;

  const total = useMemo(() => lines.reduce((s, l) => s + getLineTotal(l), 0), [lines]);
  const totalSft = useMemo(() => lines.reduce((s, l) => s + (getSft(l) * l.qty), 0), [lines]);

  const update = (id: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const addLine = () =>
    setLines((ls) => [...ls, { id: crypto.randomUUID(), media: "", width_inches: 0, height_inches: 0, qty: 1, rate: 0, remarks: "none" }]);
  const removeLine = (id: string) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.id !== id) : ls));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName.trim() || !storeName.trim() || !location.trim()) {
      toast.error("Client Name, Store Name, and Location are required");
      return;
    }
    if (lines.some((l) => !l.media.trim() || l.width_inches <= 0 || l.height_inches <= 0 || l.qty <= 0 || l.rate <= 0)) {
      toast.error("Every line item needs valid media, dimensions, quantity, and rate.");
      return;
    }
    
    setSaving(true);
    try {
      const payload = {
        client_name: clientName,
        store_name: storeName,
        location,
        date: new Date().toISOString().split("T")[0],
        po_number: poNumber || undefined,
        items: lines.map((l) => ({
          media: l.media,
          width_inches: l.width_inches,
          height_inches: l.height_inches,
          qty: l.qty,
          rate: l.rate,
          remarks: l.remarks === "none" ? undefined : (l.remarks as RemarkType),
        })),
      };
      const res = await createOrder(payload);
      toast.success(`Order ${res.order.order_no} created`, { description: "Order was saved successfully." });
      navigate({ to: "/employee/orders" });
    } catch (err: any) {
      const data = err?.response?.data;
      if (data?.errors && Array.isArray(data.errors)) {
        toast.error(`Validation Error: ${data.errors.map((e: any) => `${e.path.join(".")}: ${e.message}`).join(", ")}`);
      } else {
        toast.error("Failed to create order", { description: err.message });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Create New Order"
        description="Line items compute totals live. The order number is assigned by the server on submit."
        crumbs={[{ label: "Employee" }, { label: "New Order" }]}
      />

      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="surface-panel p-6"
          >
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Customer & Order
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="clientName">Client Name *</Label>
                <Input id="clientName" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="e.g. Acme Corp" className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="storeName">Store Name *</Label>
                <Input id="storeName" value={storeName} onChange={(e) => setStoreName(e.target.value)} placeholder="e.g. Downtown Branch" className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="location">Location *</Label>
                <Input id="location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. New York, NY" className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="poNumber">PO Number (Optional)</Label>
                <Input id="poNumber" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="e.g. PO-12345" className="mt-1.5" />
              </div>
            </div>
          </motion.section>

          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="surface-panel p-6"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Line Items</h2>
              <Button type="button" size="sm" variant="outline" onClick={addLine} className="rounded-lg">
                <Plus className="mr-1 h-3.5 w-3.5" /> Add item
              </Button>
            </div>

            <div className="space-y-3">
              {lines.map((line, idx) => (
                <div key={line.id} className="rounded-xl border bg-background/60 p-3">
                  <div className="grid gap-2 sm:grid-cols-12 items-end">
                    <div className="sm:col-span-3">
                      <Label className="text-[10px] uppercase text-muted-foreground">Media</Label>
                      <Input
                        value={line.media}
                        onChange={(e) => update(line.id, { media: e.target.value })}
                        placeholder="e.g. Vinyl 8x4"
                        className="mt-1"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Label className="text-[10px] uppercase text-muted-foreground">W (in)</Label>
                      <Input
                        type="number"
                        min={0}
                        value={line.width_inches || ""}
                        onChange={(e) => update(line.id, { width_inches: Number(e.target.value) })}
                        className="mt-1"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Label className="text-[10px] uppercase text-muted-foreground">H (in)</Label>
                      <Input
                        type="number"
                        min={0}
                        value={line.height_inches || ""}
                        onChange={(e) => update(line.id, { height_inches: Number(e.target.value) })}
                        className="mt-1"
                      />
                    </div>
                    <div className="sm:col-span-1">
                      <Label className="text-[10px] uppercase text-muted-foreground">Qty</Label>
                      <Input
                        type="number"
                        min={1}
                        value={line.qty || ""}
                        onChange={(e) => update(line.id, { qty: Number(e.target.value) })}
                        className="mt-1"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Label className="text-[10px] uppercase text-muted-foreground">Rate (₹)</Label>
                      <Input
                        type="number"
                        min={0}
                        value={line.rate || ""}
                        onChange={(e) => update(line.id, { rate: Number(e.target.value) })}
                        className="mt-1"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Label className="text-[10px] uppercase text-muted-foreground">Remarks</Label>
                      <Select value={line.remarks} onValueChange={(val) => update(line.id, { remarks: val as any })}>
                        <SelectTrigger className="mt-1 h-9 px-2 text-xs"><SelectValue placeholder="None" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none" className="text-muted-foreground italic text-xs">None</SelectItem>
                          {PRODUCTION_REMARK_TYPES.map(r => <SelectItem key={r} value={r} className="text-xs">{r}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex justify-end sm:col-span-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeLine(line.id)}
                        disabled={lines.length === 1}
                        aria-label={`Remove item ${idx + 1}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      SFT: {(getSft(line) * line.qty).toFixed(2)}
                    </span>
                    <span className="font-semibold">{inr(getLineTotal(line))}</span>
                  </div>
                </div>
              ))}
            </div>
          </motion.section>
        </div>

        <motion.aside
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="lg:sticky lg:top-24 lg:h-fit"
        >
          <div className="surface-panel overflow-hidden">
            <div className="border-b bg-gradient-to-br from-primary/10 to-transparent p-5">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Live Summary</div>
              <div className="mt-2 text-3xl font-bold">{inr(total)}</div>
              <div className="text-xs text-muted-foreground">
                {lines.length} item{lines.length === 1 ? "" : "s"} · {totalSft.toFixed(2)} sft (computed)
              </div>
            </div>
            <div className="space-y-3 p-5">
              <div className="rounded-lg border border-info/30 bg-info/5 p-3 text-xs text-info">
                <CheckCircle2 className="mb-1 inline h-3.5 w-3.5" /> Totals and Sft are computed server-side before save. This preview
                is read-only.
              </div>
              <Button type="submit" size="lg" className="w-full rounded-xl" disabled={saving}>
                <Send className="mr-2 h-4 w-4" /> {saving ? "Submitting…" : "Submit Order"}
              </Button>
              <Button type="button" variant="outline" size="lg" className="w-full rounded-xl" disabled>
                <Save className="mr-2 h-4 w-4" /> Save as draft
              </Button>
            </div>
          </div>
        </motion.aside>
      </form>
    </>
  );
}
