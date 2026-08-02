import { useMemo, useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Trash2, Plus, Save, Send, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { inr } from "@/lib/format";
import { LOSS_REMARK_TYPES } from "@/lib/constants";
import type { CreateOrderInput, Order, UserRole } from "@sb-oms/shared-types";
import { ClientCombobox, MediaCombobox } from "./AutocompleteComboboxes";

interface Line {
  id: string;
  originalId?: number;
  media: string;
  width_inches: number;
  height_inches: number;
  qty: number;
  rate: number;
  remarks?: string | null;
  remarks_other_text?: string | null;
}

export interface OrderFormProps {
  defaultValues?: Order;
  onSubmit: (data: CreateOrderInput) => Promise<void>;
  isSubmitting?: boolean;
  userRole?: UserRole | string;
}

export function OrderForm({ defaultValues, onSubmit, isSubmitting = false, userRole }: OrderFormProps) {
  const [clientName, setClientName] = useState(defaultValues?.client_name || "");
  const [storeName, setStoreName] = useState(defaultValues?.store_name || "");
  const [location, setLocation] = useState(defaultValues?.location || "");
  const [poNumber, setPoNumber] = useState(defaultValues?.po_number || "");

  
  const [lines, setLines] = useState<Line[]>(
    defaultValues?.items?.length
      ? defaultValues.items.map((item) => ({
          id: crypto.randomUUID(),
          originalId: item.id,
          media: item.media,
          width_inches: item.width_inches,
          height_inches: item.height_inches,
          qty: item.qty,
          rate: Number(item.rate),
          remarks: item.remarks ?? null,
          remarks_other_text: item.remarks_other_text ?? null,
        }))
      : [{ id: crypto.randomUUID(), media: "", width_inches: 0, height_inches: 0, qty: 1, rate: 0, remarks: null, remarks_other_text: null }]
  );

  const isAdmin = userRole === "ADMIN";
  const getSft = (l: Line) => (l.width_inches * l.height_inches) / 144;
  const getLineTotal = (l: Line) => getSft(l) * l.qty * l.rate;
  const isLossLine = (l: Line) => l.remarks != null;

  const total = useMemo(() => lines.reduce((s, l) => s + getLineTotal(l), 0), [lines]);
  const totalSft = useMemo(() => lines.reduce((s, l) => s + (getSft(l) * l.qty), 0), [lines]);
  const lossTotal = useMemo(() => lines.filter(isLossLine).reduce((s, l) => s + getLineTotal(l), 0), [lines]);
  const lossCount = useMemo(() => lines.filter(isLossLine).length, [lines]);
  // An admin's loss remarks are applied on save (excluded from billable); an employee's are proposals
  // that keep billing until confirmed.
  const billable = isAdmin ? total - lossTotal : total;

  const update = (id: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const addLine = () =>
    setLines((ls) => [...ls, { id: crypto.randomUUID(), media: "", width_inches: 0, height_inches: 0, qty: 1, rate: 0, remarks: null, remarks_other_text: null }]);
  const removeLine = (id: string) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.id !== id) : ls));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName.trim() || !storeName.trim() || !location.trim()) {
      throw new Error("Client Name, Store Name, and Location are required");
    }
    if (lines.some((l) => !l.media.trim() || l.width_inches <= 0 || l.height_inches <= 0 || l.qty <= 0 || l.rate <= 0)) {
      throw new Error("Every line item needs valid media, dimensions, quantity, and rate.");
    }
    
    const payload: CreateOrderInput = {
      client_name: clientName,
      store_name: storeName,
      location,
      date: defaultValues?.created_at ? new Date(defaultValues.created_at).toISOString().split("T")[0] : new Date().toISOString().split("T")[0],
      po_number: poNumber || undefined,
      items: lines.map((l) => ({
        id: l.originalId,
        media: l.media,
        width_inches: l.width_inches,
        height_inches: l.height_inches,
        qty: l.qty,
        rate: l.rate,
        remarks: (l.remarks ?? null) as CreateOrderInput["items"][number]["remarks"],
        remarks_other_text: l.remarks === "Other" ? l.remarks_other_text : null,
      })),
    };
    
    await onSubmit(payload);
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(e).catch(err => { if (err.message !== "Unhandled") { throw err; } }) }} className="grid gap-6 lg:grid-cols-3">
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
              <ClientCombobox id="clientName" value={clientName} onChange={setClientName} className="mt-1.5" />
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
            {lines.map((line, idx) => {
              const isReadOnlyItem = userRole === "EMPLOYEE" && !!line.originalId;

              return (
              <div key={line.id} className="relative rounded-xl border bg-background/60 p-3 pr-10">
                <div className="grid gap-2 sm:grid-cols-12 items-end">
                  <div className={`sm:col-span-4 ${isReadOnlyItem ? "pointer-events-none opacity-50" : ""}`}>
                    <Label className="text-[10px] uppercase text-muted-foreground">Media</Label>
                    <MediaCombobox
                      value={line.media}
                      onChange={(val) => update(line.id, { media: val })}
                      className="mt-1 h-9"
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
                      disabled={isReadOnlyItem}
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
                      disabled={isReadOnlyItem}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Label className="text-[10px] uppercase text-muted-foreground">Qty</Label>
                    <Input
                      type="number"
                      min={1}
                      value={line.qty || ""}
                      onChange={(e) => update(line.id, { qty: Number(e.target.value) })}
                      className="mt-1"
                      disabled={isReadOnlyItem}
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
                      disabled={isReadOnlyItem}
                    />
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-12 items-end mt-3">
                  <div className="absolute right-2 top-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeLine(line.id)}
                      disabled={lines.length === 1 || isReadOnlyItem}
                      aria-label={`Remove item ${idx + 1}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
                {(!line.originalId || isAdmin) && (
                  <div className="space-y-1 mt-2">
                    <Label className="text-xs">
                      {isAdmin ? "Loss remark (optional)" : "Propose loss remark (needs admin approval)"}
                    </Label>
                    <Select value={line.remarks ?? "none"} onValueChange={(v) => update(line.id, { remarks: v === "none" ? null : v })}>
                      <SelectTrigger className="h-8 text-xs w-full sm:w-64"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {LOSS_REMARK_TYPES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {line.remarks === "Other" && (
                      <Textarea
                        className="text-xs mt-1"
                        placeholder="Describe the reason"
                        value={line.remarks_other_text ?? ""}
                        onChange={(e) => update(line.id, { remarks_other_text: e.target.value })}
                      />
                    )}
                    {line.remarks && !isAdmin && (
                      <p className="text-[10px] text-muted-foreground">
                        This line is still billed until an admin confirms the loss.
                      </p>
                    )}
                    {line.remarks && isAdmin && line.originalId && (
                      <p className="text-[10px] text-muted-foreground">
                        Saved as a confirmed loss — excluded from the billable total.
                      </p>
                    )}
                  </div>
                )}
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">
                    SFT: {(getSft(line) * line.qty).toFixed(2)}
                  </span>
                  <span className="font-semibold">{inr(getLineTotal(line))}</span>
                </div>
              </div>
            );})}
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
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {lossCount > 0 ? "Billable Value" : "Live Summary"}
            </div>
            <div className="mt-2 text-3xl font-bold">{inr(billable)}</div>
            <div className="text-xs text-muted-foreground">
              {lines.length} item{lines.length === 1 ? "" : "s"} · {totalSft.toFixed(2)} sft (computed)
            </div>
            {lossCount > 0 && (
              <div className="mt-2 text-xs text-amber-600 dark:text-amber-500">
                {isAdmin ? "Loss (excluded)" : "Proposed loss (pending)"}: {inr(lossTotal)} · {lossCount} item{lossCount === 1 ? "" : "s"}
              </div>
            )}
          </div>
          <div className="space-y-3 p-5">
            <div className="rounded-lg border border-info/30 bg-info/5 p-3 text-xs text-info">
              <CheckCircle2 className="mb-1 inline h-3.5 w-3.5" /> Totals and Sft are computed server-side before save. This preview
              is read-only.
            </div>
            <Button type="submit" size="lg" className="w-full rounded-xl" disabled={isSubmitting}>
              <Send className="mr-2 h-4 w-4" /> {isSubmitting ? "Submitting…" : defaultValues ? "Save Changes" : "Submit Order"}
            </Button>
          </div>
        </div>
      </motion.aside>
    </form>
  );
}
