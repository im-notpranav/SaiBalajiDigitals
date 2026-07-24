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
import { inr } from "@/lib/mock-data";

export const Route = createFileRoute("/_portal/employee/new-order")({
  head: () => ({ meta: [{ title: "New Order — SB OMS" }] }),
  component: NewOrder,
});

interface Line {
  id: string;
  description: string;
  quantity: number;
  rate: number;
  sft: number;
}

function NewOrder() {
  const navigate = useNavigate();
  const [customer, setCustomer] = useState("");
  const [contact, setContact] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([
    { id: crypto.randomUUID(), description: "", quantity: 1, rate: 0, sft: 0 },
  ]);
  const [saving, setSaving] = useState(false);

  const total = useMemo(() => lines.reduce((s, l) => s + l.quantity * l.rate, 0), [lines]);
  const totalSft = useMemo(() => lines.reduce((s, l) => s + l.sft, 0), [lines]);

  const update = (id: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const addLine = () =>
    setLines((ls) => [...ls, { id: crypto.randomUUID(), description: "", quantity: 1, rate: 0, sft: 0 }]);
  const removeLine = (id: string) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.id !== id) : ls));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customer.trim()) {
      toast.error("Customer is required");
      return;
    }
    if (lines.some((l) => !l.description.trim() || l.quantity <= 0 || l.rate <= 0)) {
      toast.error("Every line item needs a description, quantity, and rate.");
      return;
    }
    setSaving(true);
    await new Promise((r) => setTimeout(r, 800));
    const num = `ORD26${String(1050 + Math.floor(Math.random() * 900)).padStart(4, "0")}`;
    toast.success(`Order ${num} created`, { description: "Server assigned the number after trigger fired." });
    setSaving(false);
    navigate({ to: "/employee/orders" });
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
                <Label htmlFor="customer">Customer *</Label>
                <Input id="customer" value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Company / individual name" className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="contact">Contact person</Label>
                <Input id="contact" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Name, phone or email" className="mt-1.5" />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="notes">Internal notes</Label>
                <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional handoff notes for production" className="mt-1.5" rows={3} />
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
                  <div className="grid gap-2 sm:grid-cols-12">
                    <div className="sm:col-span-5">
                      <Label className="text-[10px] uppercase text-muted-foreground">Description</Label>
                      <Input
                        value={line.description}
                        onChange={(e) => update(line.id, { description: e.target.value })}
                        placeholder="e.g. Vinyl banner 8x4 ft"
                        className="mt-1"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Label className="text-[10px] uppercase text-muted-foreground">Qty</Label>
                      <Input
                        type="number"
                        min={1}
                        value={line.quantity}
                        onChange={(e) => update(line.id, { quantity: Number(e.target.value) })}
                        className="mt-1"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Label className="text-[10px] uppercase text-muted-foreground">Rate (₹)</Label>
                      <Input
                        type="number"
                        min={0}
                        value={line.rate}
                        onChange={(e) => update(line.id, { rate: Number(e.target.value) })}
                        className="mt-1"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Label className="text-[10px] uppercase text-muted-foreground">Sft (auto)</Label>
                      <div className="mt-1 flex h-9 items-center rounded-md border bg-muted/50 px-3 text-sm font-mono text-muted-foreground">
                        {line.quantity * (line.sft || 0) || "—"}
                      </div>
                    </div>
                    <div className="flex items-end sm:col-span-1">
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
                    <span className="text-muted-foreground">Line total (computed)</span>
                    <span className="font-semibold">{inr(line.quantity * line.rate)}</span>
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
                {lines.length} item{lines.length === 1 ? "" : "s"} · {totalSft.toFixed(0)} sft (computed)
              </div>
            </div>
            <div className="space-y-3 p-5">
              <div className="rounded-lg border border-info/30 bg-info/5 p-3 text-xs text-info">
                <CheckCircle2 className="mb-1 inline h-3.5 w-3.5" /> Totals and Sft are computed server-side via
                <code className="mx-1 rounded bg-background px-1 font-mono">fn_recalc_order_total</code>. This preview
                is read-only.
              </div>
              <Button type="submit" size="lg" className="w-full rounded-xl" disabled={saving}>
                <Send className="mr-2 h-4 w-4" /> {saving ? "Submitting…" : "Submit Order"}
              </Button>
              <Button type="button" variant="outline" size="lg" className="w-full rounded-xl">
                <Save className="mr-2 h-4 w-4" /> Save as draft
              </Button>
            </div>
          </div>
        </motion.aside>
      </form>
    </>
  );
}
