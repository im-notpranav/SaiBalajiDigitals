import { useMemo, useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Trash2, Plus, Save, Send, CheckCircle2, Upload, FileSpreadsheet } from "lucide-react";
import * as xlsx from "xlsx";
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
import { toast } from "sonner";
import { downloadLineItemTemplate } from "@/api/orders";
import { inr } from "@/lib/format";
import { LOSS_REMARK_TYPES } from "@/lib/constants";
import type { CreateOrderInput, CreateOrderItemInput, Order, UserRole } from "@sb-oms/shared-types";
import { ClientCombobox, MediaCombobox } from "./AutocompleteComboboxes";

interface Line {
  id: string;
  originalId?: number;
  media: string;
  /** Raw text as typed, so a partial decimal ("48.") survives re-render. */
  width_inches: string;
  /** Raw text as typed, so a partial decimal ("36.") survives re-render. */
  height_inches: string;
  /** Whole units only - the field is step="1" and the importer rejects fractions. */
  qty: number;
  /** Raw text as typed (e.g. "12.5"), so a partial decimal survives re-render. */
  rate: string;
  remarks?: string | null;
  remarks_other_text?: string | null;
}

/**
 * Keep only digits and a single decimal point, capped at two decimal places
 * (these columns are DECIMAL(10,2), so anything finer would be lost on save).
 */
function sanitizeDecimal(raw: string): string {
  let v = raw.replace(/[^\d.]/g, "");
  const dot = v.indexOf(".");
  if (dot !== -1) {
    const intPart = v.slice(0, dot);
    const decPart = v.slice(dot + 1).replace(/\./g, "").slice(0, 2);
    v = `${intPart}.${decPart}`;
  }
  return v;
}

/** Tidy the field on blur: "12." -> "12", ".5" -> "0.5". Typed precision is kept. */
function normalizeDecimal(v: string): string {
  if (v === "" || v === ".") return "";
  let out = v.endsWith(".") ? v.slice(0, -1) : v;
  if (out.startsWith(".")) out = `0${out}`;
  return out;
}

/** Numeric value of a decimal text field; blank or partial input counts as 0. */
function numOf(v: string): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

/** One store's block: its own address, its own PO, and its own line items nested inside. */
interface StoreBlock {
  id: string;
  /** OrderStore.id when this block is an existing store being edited. */
  originalId?: number;
  store_name: string;
  location: string;
  po_number: string;
  lines: Line[];
}

const blankLine = (): Line => ({
  id: crypto.randomUUID(), media: "", width_inches: "", height_inches: "", qty: 1, rate: "",
  remarks: null, remarks_other_text: null,
});

const blankStore = (): StoreBlock => ({
  id: crypto.randomUUID(), store_name: "", location: "", po_number: "", lines: [blankLine()],
});

const toLine = (item: any): Line => ({
  id: crypto.randomUUID(),
  originalId: item.id,
  media: item.media,
  width_inches: item.width_inches == null ? "" : String(item.width_inches),
  height_inches: item.height_inches == null ? "" : String(item.height_inches),
  qty: Number(item.qty),
  rate: item.rate == null ? "" : String(item.rate),
  remarks: item.remarks ?? null,
  remarks_other_text: item.remarks_other_text ?? null,
});

/** Existing order -> store blocks. Falls back to the flat item list for older payloads. */
function storeBlocksOf(order?: Order): StoreBlock[] {
  if (!order) return [blankStore()];
  if (order.stores?.length) {
    return order.stores.map((s) => ({
      id: crypto.randomUUID(),
      originalId: s.id,
      store_name: s.store_name,
      location: s.location,
      po_number: s.po_number ?? "",
      lines: (s.items ?? []).map(toLine),
    }));
  }
  return [{
    id: crypto.randomUUID(),
    store_name: "",
    location: "",
    po_number: "",
    lines: order.items?.length ? order.items.map(toLine) : [blankLine()],
  }];
}

export interface OrderFormProps {
  defaultValues?: Order;
  onSubmit: (data: CreateOrderInput) => Promise<void>;
  isSubmitting?: boolean;
  userRole?: UserRole | string;
  /** Billing has started: header fields stay open, line items freeze. */
  lineItemsLocked?: boolean;
}

export function OrderForm({ defaultValues, onSubmit, isSubmitting = false, userRole, lineItemsLocked = false }: OrderFormProps) {
  const [clientName, setClientName] = useState(defaultValues?.client_name || "");
  const [poNumber, setPoNumber] = useState(defaultValues?.po_number || "");
  const [stores, setStores] = useState<StoreBlock[]>(() => storeBlocksOf(defaultValues));

  const isAdmin = userRole === "ADMIN";
  const getSft = (l: Line) => (numOf(l.width_inches) * numOf(l.height_inches)) / 144;
  const getLineTotal = (l: Line) => getSft(l) * l.qty * numOf(l.rate);
  const isLossLine = (l: Line) => l.remarks != null;
  const storeTotal = (s: StoreBlock) => s.lines.reduce((sum, l) => sum + getLineTotal(l), 0);

  const allLines = useMemo(() => stores.flatMap((s) => s.lines), [stores]);
  const total = useMemo(() => allLines.reduce((s, l) => s + getLineTotal(l), 0), [allLines]);
  const totalSft = useMemo(() => allLines.reduce((s, l) => s + (getSft(l) * l.qty), 0), [allLines]);
  const lossTotal = useMemo(() => allLines.filter(isLossLine).reduce((s, l) => s + getLineTotal(l), 0), [allLines]);
  const lossCount = useMemo(() => allLines.filter(isLossLine).length, [allLines]);
  // An admin's loss remarks are applied on save (excluded from billable); an employee's are proposals
  // that keep billing until confirmed.
  const billable = isAdmin ? total - lossTotal : total;

  const fileInputRef = useRef<HTMLInputElement>(null);
  /** Which store block an Excel import should load into. */
  const importTargetRef = useRef<string | null>(null);

  const patchStore = (storeId: string, patch: Partial<StoreBlock>) =>
    setStores((ss) => ss.map((s) => (s.id === storeId ? { ...s, ...patch } : s)));
  const addStoreBlock = () => setStores((ss) => [...ss, blankStore()]);
  const removeStoreBlock = (storeId: string) =>
    setStores((ss) => (ss.length > 1 ? ss.filter((s) => s.id !== storeId) : ss));

  const update = (storeId: string, id: string, patch: Partial<Line>) =>
    setStores((ss) => ss.map((s) => (s.id === storeId
      ? { ...s, lines: s.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) }
      : s)));
  const addLine = (storeId: string) =>
    setStores((ss) => ss.map((s) => (s.id === storeId ? { ...s, lines: [...s.lines, blankLine()] } : s)));
  const removeLine = (storeId: string, id: string) =>
    setStores((ss) => ss.map((s) => (s.id === storeId && s.lines.length > 1
      ? { ...s, lines: s.lines.filter((l) => l.id !== id) }
      : s)));

  /**
   * Fetch the template through the API client so it carries the configured
   * baseURL and the auth cookie. A bare window.open() navigates instead of
   * fetching: if /api is not proxied on the current origin the SPA fallback
   * answers, and the user lands on the router's 404 page.
   */
  const handleTemplateDownload = async () => {
    try {
      await downloadLineItemTemplate();
    } catch (err: any) {
      toast.error("Could not download template", { description: err?.message });
    }
  };

  /** Parse an uploaded Excel file and merge line items into the form. */
  const handleExcelImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset the input so the same file can be re-imported if needed
    e.target.value = "";

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target?.result as ArrayBuffer);
        const wb = xlsx.read(data, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows: any[] = xlsx.utils.sheet_to_json(sheet, { defval: "" });

        if (rows.length === 0) {
          alert("The spreadsheet has no data rows.");
          return;
        }

        // Tolerant column header matching
        const H: Record<string, string[]> = {
          media: ["Media", "media", "MEDIA"],
          width: ["Size (W) in", "Width", "Width (in)", "W", "width_inches", "width"],
          height: ["Size (H) in", "Height", "Height (in)", "H", "height_inches", "height"],
          qty: ["Qty", "Quantity", "qty", "QTY"],
          rate: ["Rate", "Rate (per Sq.Ft.)", "rate", "RATE"],
        };
        const cell = (row: any, keys: string[]) => {
          for (const k of keys) if (row[k] !== undefined && String(row[k]).trim() !== "") return row[k];
          return "";
        };

        const parsed: Line[] = [];
        const errors: string[] = [];
        rows.forEach((row, idx) => {
          const media = String(cell(row, H.media)).trim();
          const w = Number(String(cell(row, H.width)).replace(/,/g, ""));
          const h = Number(String(cell(row, H.height)).replace(/,/g, ""));
          const q = Number(String(cell(row, H.qty)).replace(/,/g, ""));
          const r = Number(String(cell(row, H.rate)).replace(/,/g, ""));

          if (!media) { errors.push(`Row ${idx + 2}: Missing Media`); return; }
          if (!Number.isFinite(w) || w <= 0) { errors.push(`Row ${idx + 2}: Invalid Width`); return; }
          if (!Number.isFinite(h) || h <= 0) { errors.push(`Row ${idx + 2}: Invalid Height`); return; }
          if (!Number.isFinite(q) || q <= 0) { errors.push(`Row ${idx + 2}: Invalid Qty`); return; }
          if (!Number.isInteger(q)) { errors.push(`Row ${idx + 2}: Qty must be a whole number`); return; }
          if (!Number.isFinite(r) || r <= 0) { errors.push(`Row ${idx + 2}: Invalid Rate`); return; }

          parsed.push({
            id: crypto.randomUUID(),
            media,
            width_inches: String(w),
            height_inches: String(h),
            qty: q,
            rate: String(r),
            remarks: null,
            remarks_other_text: null,
          });
        });

        if (errors.length > 0) {
          alert(`Import found ${errors.length} problem(s):\n\n${errors.slice(0, 10).join("\n")}${errors.length > 10 ? `\n...and ${errors.length - 10} more` : ""}`);
        }

        if (parsed.length > 0) {
          // Replace the empty default line, or append, within the store that asked for it.
          const targetId = importTargetRef.current;
          setStores((ss) => ss.map((s) => {
            if (s.id !== targetId) return s;
            const nonEmpty = s.lines.filter((l) => l.media.trim() !== "" || numOf(l.width_inches) > 0 || numOf(l.height_inches) > 0);
            return { ...s, lines: nonEmpty.length > 0 ? [...nonEmpty, ...parsed] : parsed };
          }));
        }
      } catch {
        alert("Could not read the file. Make sure it is a valid .xlsx or .xls file.");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName.trim()) throw new Error("Client Name is required");
    if (stores.some((s) => !s.store_name.trim() || !s.location.trim())) {
      throw new Error("Every store needs a name and a location.");
    }
    const names = stores.map((s) => s.store_name.trim().toLowerCase());
    if (new Set(names).size !== names.length) {
      throw new Error("The same store appears more than once in this order.");
    }
    if (allLines.some((l) => !l.media.trim() || numOf(l.width_inches) <= 0 || numOf(l.height_inches) <= 0 || l.qty <= 0 || numOf(l.rate) <= 0)) {
      throw new Error("Every line item needs valid media, dimensions, quantity, and rate.");
    }

    const payload: CreateOrderInput = {
      client_name: clientName,
      date: defaultValues?.created_at ? new Date(defaultValues.created_at).toISOString().split("T")[0] : new Date().toISOString().split("T")[0],
      po_number: poNumber || undefined,
      stores: stores.map((s) => ({
        id: s.originalId,
        store_name: s.store_name,
        location: s.location,
        po_number: s.po_number || undefined,
        items: s.lines.map((l) => ({
          id: l.originalId,
          media: l.media,
          width_inches: numOf(l.width_inches),
          height_inches: numOf(l.height_inches),
          qty: l.qty,
          rate: numOf(l.rate),
          remarks: (l.remarks ?? null) as CreateOrderItemInput["remarks"],
          remarks_other_text: l.remarks === "Other" ? l.remarks_other_text : null,
        })),
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
              <Label htmlFor="poNumber">Job PO Number (Optional)</Label>
              <Input id="poNumber" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="e.g. PO-12345" className="mt-1.5" />
              <p className="mt-1 text-[10px] text-muted-foreground">Covers the whole order. Each store can carry its own PO below.</p>
            </div>
          </div>
        </motion.section>

        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={handleExcelImport}
          className="hidden"
        />

        {stores.map((store, storeIdx) => (
        <motion.section
          key={store.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="surface-panel p-6"
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              {stores.length > 1 ? `Store ${storeIdx + 1} of ${stores.length}` : "Store"}
            </h2>
            {stores.length > 1 && !store.originalId && (
              <Button type="button" size="sm" variant="ghost" onClick={() => removeStoreBlock(store.id)} className="rounded-lg text-xs">
                <Trash2 className="mr-1 h-3.5 w-3.5 text-destructive" /> Remove store
              </Button>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor={`storeName-${store.id}`}>Store Name *</Label>
              <Input
                id={`storeName-${store.id}`}
                value={store.store_name}
                onChange={(e) => patchStore(store.id, { store_name: e.target.value })}
                placeholder="e.g. Downtown Branch"
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor={`location-${store.id}`}>Location *</Label>
              <Input
                id={`location-${store.id}`}
                value={store.location}
                onChange={(e) => patchStore(store.id, { location: e.target.value })}
                placeholder="e.g. New York, NY"
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor={`storePo-${store.id}`}>Store PO Number (Optional)</Label>
              <Input
                id={`storePo-${store.id}`}
                value={store.po_number}
                onChange={(e) => patchStore(store.id, { po_number: e.target.value })}
                placeholder="e.g. PO-12345"
                className="mt-1.5"
              />
            </div>
          </div>

          <div className="mb-4 mt-6 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Line Items</h3>
            <div className="flex items-center gap-2">
              {!defaultValues && (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={handleTemplateDownload}
                    className="rounded-lg text-xs"
                    title="Download line item template"
                  >
                    <FileSpreadsheet className="mr-1 h-3.5 w-3.5" /> Template
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => { importTargetRef.current = store.id; fileInputRef.current?.click(); }}
                    className="rounded-lg"
                  >
                    <Upload className="mr-1 h-3.5 w-3.5" /> Import Excel
                  </Button>
                </>
              )}
              <Button type="button" size="sm" variant="outline" onClick={() => addLine(store.id)} className="rounded-lg" disabled={lineItemsLocked}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Add item
              </Button>
            </div>
          </div>

          {lineItemsLocked && (
            <p className="mb-3 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-muted-foreground">
              Billing has started on this order, so line items are frozen. Store name, location and
              PO numbers can still be corrected above.
            </p>
          )}

          <div className="space-y-3">
            {store.lines.map((line, idx) => {
              const isReadOnlyItem = lineItemsLocked || (userRole === "CSM" && !!line.originalId);

              return (
              <div key={line.id} className="relative rounded-xl border bg-background/60 p-3 pr-10">
                <div className="grid gap-2 sm:grid-cols-12 items-end">
                  <div className={`sm:col-span-4 ${isReadOnlyItem ? "pointer-events-none opacity-50" : ""}`}>
                    <Label className="text-[10px] uppercase text-muted-foreground">Media</Label>
                    <MediaCombobox
                      value={line.media}
                      onChange={(val) => update(store.id, line.id, { media: val })}
                      className="mt-1 h-9"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Label className="text-[10px] uppercase text-muted-foreground">W (in)</Label>
                    <Input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="0.00"
                      value={line.width_inches}
                      onChange={(e) => update(store.id, line.id, { width_inches: sanitizeDecimal(e.target.value) })}
                      onBlur={() => update(store.id, line.id, { width_inches: normalizeDecimal(line.width_inches) })}
                      className="mt-1"
                      disabled={isReadOnlyItem}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Label className="text-[10px] uppercase text-muted-foreground">H (in)</Label>
                    <Input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="0.00"
                      value={line.height_inches}
                      onChange={(e) => update(store.id, line.id, { height_inches: sanitizeDecimal(e.target.value) })}
                      onBlur={() => update(store.id, line.id, { height_inches: normalizeDecimal(line.height_inches) })}
                      className="mt-1"
                      disabled={isReadOnlyItem}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Label className="text-[10px] uppercase text-muted-foreground">Qty</Label>
                    <Input
                      type="number"
                      min={1}
                      step={1}
                      value={line.qty || ""}
                      onChange={(e) => update(store.id, line.id, { qty: Number(e.target.value) })}
                      className="mt-1"
                      disabled={isReadOnlyItem}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Label className="text-[10px] uppercase text-muted-foreground">Rate (₹)</Label>
                    <Input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="0.00"
                      value={line.rate}
                      onChange={(e) => update(store.id, line.id, { rate: sanitizeDecimal(e.target.value) })}
                      onBlur={() => update(store.id, line.id, { rate: normalizeDecimal(line.rate) })}
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
                      onClick={() => removeLine(store.id, line.id)}
                      disabled={store.lines.length === 1 || isReadOnlyItem}
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
                    <Select value={line.remarks ?? "none"} onValueChange={(v) => update(store.id, line.id, { remarks: v === "none" ? null : v })}>
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
                        onChange={(e) => update(store.id, line.id, { remarks_other_text: e.target.value })}
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

          {stores.length > 1 && (
            <div className="mt-3 flex items-center justify-end gap-2 border-t pt-3 text-xs">
              <span className="text-muted-foreground">Store total</span>
              <span className="font-semibold">{inr(storeTotal(store))}</span>
            </div>
          )}
        </motion.section>
        ))}

        {!lineItemsLocked && (
          <Button
            type="button"
            variant="outline"
            onClick={addStoreBlock}
            className="w-full rounded-xl border-dashed py-6"
          >
            <Plus className="mr-2 h-4 w-4" /> Add another store
          </Button>
        )}
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
              {allLines.length} item{allLines.length === 1 ? "" : "s"} · {stores.length} store{stores.length === 1 ? "" : "s"} · {totalSft.toFixed(2)} sft (computed)
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
