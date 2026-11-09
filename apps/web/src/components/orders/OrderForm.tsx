import { useMemo, useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Trash2, Plus, Send, Upload, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { downloadOrderTemplate } from "@/api/orders";
import { inr } from "@/lib/format";
import {
  LOSS_REMARK_TYPES,
  ADJUSTMENT_REMARK_TYPES,
  NORMAL_REMARK_LABEL,
  isLossRemark,
  isAmountRemark,
  remarkNeedsReason,
  lineBillable,
} from "@/lib/constants";
import type { CreateOrderInput, CreateOrderItemInput, Order, UserRole } from "@sb-oms/shared-types";
import { ClientCombobox, MediaCombobox } from "./AutocompleteComboboxes";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { parseOrderSheet, type ParsedStore, type SheetParseResult } from "@/lib/order-sheet";

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
  /** Extra / Less figure as typed. For Less in "new amount" mode it is the amount after discount. */
  adjustment_amount: string;
  /** How a Less Amount is typed: the discount itself, or the new line amount. */
  lessMode: "discount" | "newAmount";
  /** The saved remark was confirmed by an admin (a saved line only). */
  confirmed?: boolean;
  /** Revised only: what the saved line came to before its first correction. */
  original_amount?: number | null;
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
  remarks: null, remarks_other_text: null, adjustment_amount: "", lessMode: "discount",
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
  adjustment_amount: item.adjustment_amount == null ? "" : String(item.adjustment_amount),
  lessMode: "discount",
  confirmed: !!item.remarks_confirmed,
  original_amount: item.original_amount ?? null,
});

/**
 * What makes a store distinct within an order: its name AND its location. A chain has
 * the same name in several places, so the name on its own does not identify a store.
 */
const storeKey = (name: string, location: string) =>
  `${name.trim().toLowerCase()}\u0000${location.trim().toLowerCase()}`;

/** A line the user has actually started filling in. */
const lineHasContent = (l: Line) =>
  l.media.trim() !== "" || numOf(l.width_inches) > 0 || numOf(l.height_inches) > 0;

/** A store parsed from a sheet becomes a form block, with fresh ids. */
const toStoreBlock = (s: ParsedStore): StoreBlock => ({
  id: crypto.randomUUID(),
  store_name: s.store_name,
  location: s.location,
  po_number: s.po_number,
  // A store whose rows all failed validation still gets an editable block.
  lines: s.items.length > 0 ? s.items.map(toLine) : [blankLine()],
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

/** Small caps titles for the form's sections. */
const sectionTitle = "text-xs font-semibold uppercase tracking-wider text-muted-foreground";
/** Field labels: small, so the boxes carry the weight. */
const fieldLabel = "text-xs font-medium text-muted-foreground";

/** A small line-item input. The field name is a placeholder, so it vanishes on typing and the whole box holds the value. */
function LineInput({ className, ...props }: React.ComponentProps<typeof Input>) {
  return (
    <Input
      type="text"
      autoComplete="off"
      {...props}
      // No number spinners: they ate the room the value needs.
      className={`h-9 tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${className ?? ""}`}
    />
  );
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
  const isLossLine = (l: Line) => isLossRemark(l.remarks);
  /** The Extra / Less figure in rupees, whichever way the Less Amount was typed. */
  const getAdjustment = (l: Line) => {
    const typed = numOf(l.adjustment_amount);
    if (l.remarks === "LessAmount" && l.lessMode === "newAmount") return Math.max(0, getLineTotal(l) - typed);
    return typed;
  };
  /**
   * What a line comes to on the bill. An admin's remark is confirmed on save; a CSM's new
   * remark is only a proposal, so it is billed at the plain amount until an admin decides.
   */
  const getLineBillable = (l: Line) =>
    isAdmin || l.confirmed ? lineBillable(getLineTotal(l), l.remarks, getAdjustment(l)) : getLineTotal(l);
  const storeTotal = (s: StoreBlock) => s.lines.reduce((sum, l) => sum + getLineTotal(l), 0);

  const allLines = useMemo(() => stores.flatMap((s) => s.lines), [stores]);
  const total = useMemo(() => allLines.reduce((s, l) => s + getLineTotal(l), 0), [allLines]);
  const totalSft = useMemo(() => allLines.reduce((s, l) => s + (getSft(l) * l.qty), 0), [allLines]);
  const lossTotal = useMemo(() => allLines.filter(isLossLine).reduce((s, l) => s + getLineTotal(l), 0), [allLines]);
  const lossCount = useMemo(() => allLines.filter(isLossLine).length, [allLines]);
  // An admin's remarks are applied on save; an employee's are proposals that keep billing at
  // the plain amount until confirmed.
  const billable = useMemo(() => allLines.reduce((s, l) => s + getLineBillable(l), 0), [allLines, isAdmin]);
  const adjustmentNet = useMemo(
    () => allLines.filter((l) => !isLossLine(l)).reduce((s, l) => s + getLineBillable(l) - getLineTotal(l), 0),
    [allLines, isAdmin],
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  /** A parsed sheet held while the user decides how to merge it into a form with content. */
  const [pendingImport, setPendingImport] = useState<SheetParseResult | null>(null);

  /** One blank store block with nothing typed into it. */
  const isFormUntouched = () =>
    stores.length === 1 &&
    !stores[0]!.store_name.trim() &&
    !stores[0]!.location.trim() &&
    !stores[0]!.lines.some(lineHasContent);

  const applyReplace = () => {
    if (pendingImport) setStores(pendingImport.stores.map(toStoreBlock));
    setPendingImport(null);
  };

  /** Append, merging into a block for the same store and location — submit rejects duplicates. */
  const applyAppend = () => {
    const parsedStores = pendingImport?.stores;
    if (parsedStores) {
      setStores((ss) => {
        const next = [...ss];
        for (const parsed of parsedStores) {
          const key = storeKey(parsed.store_name, parsed.location);
          const at = next.findIndex((b) => storeKey(b.store_name, b.location) === key);
          if (at === -1) {
            next.push(toStoreBlock(parsed));
            continue;
          }
          const existing = next[at]!;
          const kept = existing.lines.filter(lineHasContent);
          const merged = [...kept, ...parsed.items.map(toLine)];
          next[at] = { ...existing, lines: merged.length > 0 ? merged : [blankLine()] };
        }
        return next;
      });
    }
    setPendingImport(null);
  };

  const patchStore = (storeId: string, patch: Partial<StoreBlock>) =>
    setStores((ss) => ss.map((s) => (s.id === storeId ? { ...s, ...patch } : s)));
  const addStoreBlock = () => setStores((ss) => [...ss, blankStore()]);
  const removeStoreBlock = (storeId: string) =>
    setStores((ss) => (ss.length > 1 ? ss.filter((s) => s.id !== storeId) : ss));

  const update = (storeId: string, id: string, patch: Partial<Line>) =>
    setStores((ss) => ss.map((s) => (s.id === storeId
      ? {
          ...s,
          lines: s.lines.map((l) => {
            if (l.id !== id) return l;
            const next = { ...l, ...patch };
            // An admin changing a saved line's size, qty or rate is revising it: preselect
            // Revised so the reason gets asked for, instead of a loss type.
            const sizeOrRate = "width_inches" in patch || "height_inches" in patch || "qty" in patch || "rate" in patch;
            if (isAdmin && l.originalId && sizeOrRate && !l.remarks) next.remarks = "Revised";
            return next;
          }),
        }
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
      await downloadOrderTemplate();
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
    reader.onload = async (ev) => {
      try {
        // Loaded here, not with the page: this library is a large download few visits need.
        const xlsx = await import("xlsx");
        const data = new Uint8Array(ev.target?.result as ArrayBuffer);
        const wb = xlsx.read(data, { type: "array" });
        // Look the sheet up by name: older files also carry an example and a guide sheet, and
        // neither of those is data. The current template has its rows on the first sheet.
        const sheetName = wb.SheetNames.find((n) => n.trim().toLowerCase() === "line items") ?? wb.SheetNames[0];
        const rows: any[] = xlsx.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" });

        if (rows.length === 0) {
          alert("The sheet is empty. Enter the rows on the first sheet.");
          return;
        }

        const result = parseOrderSheet(rows);

        // This form is one order, and the template makes one order per client.
        if (result.clients.length > 1) {
          alert(`This file has ${result.clients.length} clients, which makes ${result.clients.length} orders. Use Upload Orders for it.`);
          return;
        }
        if (result.clients.length === 1 && !clientName.trim()) setClientName(result.clients[0]!);

        // Errors first, so the user decides with the problems already in front of them.
        if (result.errors.length > 0) {
          alert(`Import found ${result.errors.length} problem(s):\n\n${result.errors.slice(0, 10).join("\n")}${result.errors.length > 10 ? `\n...and ${result.errors.length - 10} more` : ""}`);
        }

        const totalItems = result.stores.reduce((n, st) => n + st.items.length, 0);
        if (totalItems === 0) return;

        // An untouched form applies straight away. Otherwise ask first, including for a
        // sheet with no Store Name column: that arrives as one unnamed store and would
        // otherwise replace whatever is already typed in.
        if (isFormUntouched()) {
          setStores(result.stores.map(toStoreBlock));
          return;
        }
        setPendingImport(result);
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
    const keys = stores.map((s) => storeKey(s.store_name, s.location));
    if (new Set(keys).size !== keys.length) {
      throw new Error("The same store at the same location appears more than once in this order.");
    }
    if (allLines.some((l) => !l.media.trim() || numOf(l.width_inches) <= 0 || numOf(l.height_inches) <= 0 || l.qty <= 0 || numOf(l.rate) <= 0)) {
      throw new Error("Every line item needs valid media, dimensions, quantity, and rate.");
    }
    for (const l of allLines) {
      if (remarkNeedsReason(l.remarks) && !(l.remarks_other_text ?? "").trim()) {
        throw new Error(`Give a reason for every line marked ${l.remarks === "Other" ? "Other" : "Revised, Extra Amount or Less Amount"}.`);
      }
      if (isAmountRemark(l.remarks)) {
        if (!(getAdjustment(l) > 0)) throw new Error("Enter the amount for every Extra Amount or Less Amount line.");
        if (l.remarks === "LessAmount" && getAdjustment(l) > getLineTotal(l)) {
          throw new Error("A Less Amount cannot be more than its line.");
        }
      }
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
          remarks_other_text: remarkNeedsReason(l.remarks) ? (l.remarks_other_text ?? "").trim() : null,
          adjustment_amount: isAmountRemark(l.remarks) ? Number(getAdjustment(l).toFixed(2)) : null,
        })),
      })),
    };

    await onSubmit(payload);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        // submit() throws when the form fails its own checks. Show that to the user:
        // it used to be rethrown as an unhandled rejection, so a blocked save looked
        // like nothing happening at all. Failures from the API are already caught and
        // reported by the page that owns onSubmit, so this only ever sees validation.
        submit(e).catch((err) =>
          toast.error(err instanceof Error ? err.message : "Could not save this order.")
        );
      }}
      className="grid gap-4 lg:grid-cols-3"
    >
      <div className="space-y-4 lg:col-span-2">
        <motion.section
          initial={false}
          animate={{ opacity: 1, y: 0 }}
          className="surface-panel p-4 sm:p-5"
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className={sectionTitle}>Order</h2>
            {/* Order-level import: one sheet fills every store block at once. */}
            {!defaultValues && (
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={handleTemplateDownload}
                  className="h-8 text-xs"
                  title="Download the order sheet template"
                >
                  <FileSpreadsheet className="mr-1 h-3.5 w-3.5" /> Template
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  className="h-8 text-xs"
                  title="Fill every store from an order sheet"
                >
                  <Upload className="mr-1 h-3.5 w-3.5" /> Import sheet
                </Button>
              </div>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <Label htmlFor="clientName" className={fieldLabel}>Client *</Label>
              <ClientCombobox id="clientName" value={clientName} onChange={setClientName} className="mt-1 h-9" />
            </div>
            <div>
              <Label htmlFor="poNumber" className={fieldLabel}>Job PO</Label>
              <Input
                id="poNumber"
                value={poNumber}
                onChange={(e) => setPoNumber(e.target.value)}
                placeholder="Optional"
                title="Covers the whole order"
                className="mt-1 h-9"
              />
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
          initial={false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="surface-panel p-4 sm:p-5"
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className={sectionTitle}>
              {stores.length > 1 ? `Store ${storeIdx + 1} of ${stores.length}` : "Store"}
            </h2>
            {stores.length > 1 && !store.originalId && (
              <Button type="button" size="sm" variant="ghost" onClick={() => removeStoreBlock(store.id)} className="h-8 text-xs">
                <Trash2 className="mr-1 h-3.5 w-3.5 text-destructive" /> Remove
              </Button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_9rem]">
            <div className="col-span-2 sm:col-span-1">
              <Label htmlFor={`storeName-${store.id}`} className={fieldLabel}>Store name *</Label>
              <Input
                id={`storeName-${store.id}`}
                value={store.store_name}
                onChange={(e) => patchStore(store.id, { store_name: e.target.value })}
                placeholder="e.g. Fabindia Inorbit Mall"
                className="mt-1 h-9"
              />
            </div>
            <div>
              <Label htmlFor={`location-${store.id}`} className={fieldLabel}>Location *</Label>
              <Input
                id={`location-${store.id}`}
                value={store.location}
                onChange={(e) => patchStore(store.id, { location: e.target.value })}
                placeholder="e.g. Madhapur"
                className="mt-1 h-9"
              />
            </div>
            <div>
              <Label htmlFor={`storePo-${store.id}`} className={fieldLabel}>Store PO</Label>
              <Input
                id={`storePo-${store.id}`}
                value={store.po_number}
                onChange={(e) => patchStore(store.id, { po_number: e.target.value })}
                placeholder="Optional"
                title="Covers this store only"
                className="mt-1 h-9"
              />
            </div>
          </div>

          <h3 className={`mb-2 mt-4 ${sectionTitle}`}>
            Line items <span className="font-normal normal-case tracking-normal">({store.lines.length})</span>
          </h3>

          {lineItemsLocked && (
            <p className="mb-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-muted-foreground">
              Billing has started, so line items are locked.
            </p>
          )}

          <div className="space-y-2">
            {store.lines.map((line, idx) => {
              const isReadOnlyItem = lineItemsLocked || (userRole === "CSM" && !!line.originalId);
              const showLoss = !line.originalId || isAdmin;
              const lossLabel = isAdmin ? "Remark (optional)" : "Propose a remark (needs admin approval)";
              const lineTotal = getLineTotal(line);

              return (
              <div key={line.id} className="rounded-xl border bg-background/60 p-2.5">
                {/* Line 1: what is being made. */}
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-[1.5rem_minmax(0,1fr)_repeat(4,5.5rem)] sm:items-center">
                  <span className="hidden text-center text-xs tabular-nums text-muted-foreground sm:block" aria-hidden>
                    {idx + 1}
                  </span>
                  <div className={`col-span-4 sm:col-span-1 ${isReadOnlyItem ? "pointer-events-none opacity-50" : ""}`}>
                    <Label htmlFor={`media-${line.id}`} className="sr-only">Media, item {idx + 1}</Label>
                    <MediaCombobox
                      id={`media-${line.id}`}
                      value={line.media}
                      onChange={(val) => update(store.id, line.id, { media: val })}
                      className="h-9"
                    />
                  </div>
                  <LineInput
                    aria-label="Width in inches"
                    title="Width in inches"
                    inputMode="decimal"
                    placeholder="Width"
                    value={line.width_inches}
                    onChange={(e) => update(store.id, line.id, { width_inches: sanitizeDecimal(e.target.value) })}
                    onBlur={() => update(store.id, line.id, { width_inches: normalizeDecimal(line.width_inches) })}
                    disabled={isReadOnlyItem}
                  />
                  <LineInput
                    aria-label="Height in inches"
                    title="Height in inches"
                    inputMode="decimal"
                    placeholder="Height"
                    value={line.height_inches}
                    onChange={(e) => update(store.id, line.id, { height_inches: sanitizeDecimal(e.target.value) })}
                    onBlur={() => update(store.id, line.id, { height_inches: normalizeDecimal(line.height_inches) })}
                    disabled={isReadOnlyItem}
                  />
                  <LineInput
                    aria-label="Quantity"
                    title="Quantity"
                    placeholder="Qty"
                    type="number"
                    min={1}
                    step={1}
                    value={line.qty || ""}
                    onChange={(e) => update(store.id, line.id, { qty: Number(e.target.value) })}
                    disabled={isReadOnlyItem}
                  />
                  <LineInput
                    aria-label="Rate in rupees"
                    title="Rate in rupees per sft"
                    inputMode="decimal"
                    placeholder="Rate ₹"
                    value={line.rate}
                    onChange={(e) => update(store.id, line.id, { rate: sanitizeDecimal(e.target.value) })}
                    onBlur={() => update(store.id, line.id, { rate: normalizeDecimal(line.rate) })}
                    disabled={isReadOnlyItem}
                  />
                </div>

                {/* Line 2: loss remark, then what the line comes to. */}
                <div className="mt-2 flex flex-wrap items-center gap-2 sm:pl-8">
                  {showLoss && (
                    <Select value={line.remarks ?? "none"} onValueChange={(v) => update(store.id, line.id, { remarks: v === "none" ? null : v })}>
                      <SelectTrigger aria-label={lossLabel} title={lossLabel} className="h-8 min-w-0 flex-1 text-xs sm:w-44 sm:flex-none">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{NORMAL_REMARK_LABEL}</SelectItem>
                        <SelectGroup>
                          <SelectLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">Not billed</SelectLabel>
                          {LOSS_REMARK_TYPES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                        </SelectGroup>
                        <SelectGroup>
                          <SelectLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">Amount change</SelectLabel>
                          {ADJUSTMENT_REMARK_TYPES
                            // Revised corrects a saved line, and only an admin does that.
                            .filter((r) => r.value !== "Revised" || (isAdmin && !!line.originalId) || line.remarks === "Revised")
                            .map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  )}
                  {showLoss && line.remarks === "LessAmount" && (
                    <Select value={line.lessMode} onValueChange={(v) => update(store.id, line.id, { lessMode: v as Line["lessMode"] })}>
                      <SelectTrigger aria-label="How the Less Amount is entered" className="h-8 w-28 shrink-0 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="discount">Discount</SelectItem>
                        <SelectItem value="newAmount">New amount</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                  {showLoss && isAmountRemark(line.remarks) && (
                    <LineInput
                      aria-label={line.remarks === "ExtraAmount" ? "Extra amount in rupees" : line.lessMode === "newAmount" ? "New line amount in rupees" : "Discount in rupees"}
                      title={line.remarks === "ExtraAmount" ? "Added to this line" : line.lessMode === "newAmount" ? "What the line should come to" : "Taken off this line"}
                      inputMode="decimal"
                      placeholder={line.remarks === "ExtraAmount" ? "extra" : line.lessMode === "newAmount" ? "new amt" : "discount"}
                      className="!h-8 w-28 text-xs"
                      value={line.adjustment_amount}
                      onChange={(e) => update(store.id, line.id, { adjustment_amount: sanitizeDecimal(e.target.value) })}
                      onBlur={() => update(store.id, line.id, { adjustment_amount: normalizeDecimal(line.adjustment_amount) })}
                    />
                  )}
                  <div className="ml-auto flex shrink-0 items-center gap-2 text-xs sm:gap-3">
                    <span className="tabular-nums text-muted-foreground">{(getSft(line) * line.qty).toFixed(2)} sft</span>
                    {getLineBillable(line) !== lineTotal && (
                      <span className="tabular-nums text-muted-foreground line-through">{inr(lineTotal)}</span>
                    )}
                    <span className="min-w-[4.5rem] text-right font-semibold tabular-nums">{inr(getLineBillable(line))}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => removeLine(store.id, line.id)}
                      disabled={store.lines.length === 1 || isReadOnlyItem}
                      aria-label={`Remove item ${idx + 1}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>

                {showLoss && remarkNeedsReason(line.remarks) && (
                  <Textarea
                    className="mt-2 min-h-[60px] text-xs sm:ml-8 sm:w-[calc(100%-2rem)]"
                    placeholder="Reason (required)"
                    aria-label="Remark reason"
                    value={line.remarks_other_text ?? ""}
                    onChange={(e) => update(store.id, line.id, { remarks_other_text: e.target.value })}
                  />
                )}
                {showLoss && line.remarks && !isAdmin && (
                  <p className="mt-1 text-[10px] text-muted-foreground sm:pl-8">
                    {isAmountRemark(line.remarks)
                      ? "Sent to an admin, who sets the final figure. Billed at the plain amount until then."
                      : "Still billed until an admin confirms."}
                  </p>
                )}
                {showLoss && line.remarks && isAdmin && (
                  <p className="mt-1 text-[10px] text-muted-foreground sm:pl-8">
                    {isLossRemark(line.remarks)
                      ? line.originalId ? "Confirmed loss: not billed." : "Not billed."
                      : line.remarks === "Revised"
                        ? `Revised: was ${inr(line.original_amount ?? lineTotal)}, now ${inr(lineTotal)}.`
                        : `Billed at ${inr(getLineBillable(line))} (${line.remarks === "ExtraAmount" ? "+" : "−"}${inr(getAdjustment(line))}).`}
                    {line.originalId && !line.confirmed && " Saving confirms the CSM's request."}
                  </p>
                )}
              </div>
            );})}
          </div>

          <div className="mt-2 flex min-h-8 items-center justify-between gap-2">
            {!lineItemsLocked ? (
              <Button type="button" size="sm" variant="ghost" onClick={() => addLine(store.id)} className="h-8 text-xs text-primary">
                <Plus className="mr-1 h-3.5 w-3.5" /> Add item
              </Button>
            ) : (
              <span />
            )}
            {stores.length > 1 && (
              <span className="text-xs">
                <span className="text-muted-foreground">Store total </span>
                <span className="font-semibold tabular-nums">{inr(storeTotal(store))}</span>
              </span>
            )}
          </div>
        </motion.section>
        ))}

        {!lineItemsLocked && (
          <Button
            type="button"
            variant="outline"
            onClick={addStoreBlock}
            className="h-10 w-full rounded-xl border-dashed text-sm"
          >
            <Plus className="mr-2 h-4 w-4" /> Add store
          </Button>
        )}
      </div>

      <motion.aside
        initial={false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="lg:sticky lg:top-20 lg:h-fit"
      >
        <div className="surface-panel overflow-hidden">
          <div className="border-b bg-gradient-to-br from-primary/10 to-transparent p-4">
            <div className={sectionTitle}>{billable !== total ? "Billable" : "Total"}</div>
            <div className="mt-1 text-2xl font-bold tabular-nums">{inr(billable)}</div>
            <div className="text-xs text-muted-foreground">
              {allLines.length} item{allLines.length === 1 ? "" : "s"} · {stores.length} store{stores.length === 1 ? "" : "s"} · {totalSft.toFixed(2)} sft
            </div>
            {lossCount > 0 && (
              <div className="mt-1 text-xs text-amber-600 dark:text-amber-500">
                {isAdmin ? "Loss" : "Proposed loss"}: {inr(lossTotal)} · {lossCount} item{lossCount === 1 ? "" : "s"}
              </div>
            )}
            {Math.abs(adjustmentNet) >= 0.005 && (
              <div className="mt-1 text-xs text-muted-foreground">
                Amount changes: {adjustmentNet > 0 ? "+" : "−"}{inr(Math.abs(adjustmentNet))}
              </div>
            )}
          </div>
          <div className="p-4">
            <Button type="submit" size="lg" className="w-full rounded-xl" disabled={isSubmitting}>
              <Send className="mr-2 h-4 w-4" /> {isSubmitting ? "Submitting…" : defaultValues ? "Save Changes" : "Submit Order"}
            </Button>
          </div>
        </div>
      </motion.aside>
      {/* Asked only when the form already has typed content, so an import never
          silently discards someone's work. */}
      <AlertDialog open={pendingImport !== null} onOpenChange={(o) => { if (!o) setPendingImport(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Import {pendingImport?.stores.length ?? 0} store
              {(pendingImport?.stores.length ?? 0) === 1 ? "" : "s"} from this file?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The form already has {stores.length} store{stores.length === 1 ? "" : "s"} with{" "}
              {allLines.filter(lineHasContent).length} line item
              {allLines.filter(lineHasContent).length === 1 ? "" : "s"}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
            <AlertDialogCancel onClick={() => setPendingImport(null)}>Cancel</AlertDialogCancel>
            <Button type="button" variant="outline" onClick={applyAppend}>
              Add as new stores
            </Button>
            <AlertDialogAction onClick={applyReplace}>Replace everything</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
