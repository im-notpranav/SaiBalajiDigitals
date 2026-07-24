import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { CLOSURE_REMARK_TYPES, ORDERS, inr } from "@/lib/mock-data";
import { CheckCircle2, Lock } from "lucide-react";

export const Route = createFileRoute("/_portal/accountant/closure")({
  head: () => ({ meta: [{ title: "Order Closure — SB OMS" }] }),
  component: ClosurePage,
});

function ClosurePage() {
  const eligible = ORDERS.filter((o) => o.status === "billed").slice(0, 8);
  const [orderNum, setOrderNum] = useState<string>(eligible[0]?.number ?? "");
  const [remark, setRemark] = useState<string>(CLOSURE_REMARK_TYPES[0]!);
  const [custom, setCustom] = useState("");

  const isCustom = remark === "Custom Reason";
  const canSubmit = !!orderNum && (!isCustom || custom.trim().length > 0);
  const target = eligible.find((o) => o.number === orderNum);

  const close = () => {
    toast.success(`${orderNum} closed`, { description: `Remark: ${isCustom ? custom : remark}` });
    setCustom("");
  };

  return (
    <>
      <PageHeader
        title="Order Closure"
        description="Closure is terminal. 'Custom Reason' requires a free-text remark, matching the DB CHECK constraint."
        crumbs={[{ label: "Accountant" }, { label: "Order Closure" }]}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="surface-panel space-y-4 p-6 lg:col-span-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-semibold">Eligible order</label>
              <Select value={orderNum} onValueChange={setOrderNum}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {eligible.map((o) => (
                    <SelectItem key={o.id} value={o.number}>
                      {o.number} · {o.customer} · {inr(o.total)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold">Closure remark type</label>
              <Select value={remark} onValueChange={setRemark}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CLOSURE_REMARK_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {isCustom && (
            <div className="animate-pop-in">
              <label className="mb-1.5 block text-xs font-semibold">
                Custom reason * <span className="text-destructive">(required)</span>
              </label>
              <Textarea rows={3} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Explain the custom closure reason…" />
              {!custom.trim() && <p className="mt-1 text-xs text-destructive">Free-text reason is required for Custom Reason.</p>}
            </div>
          )}

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="lg" disabled={!canSubmit} className="rounded-xl">
                <Lock className="mr-2 h-4 w-4" /> Close order
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Close {orderNum}?</AlertDialogTitle>
                <AlertDialogDescription>
                  Closure is a terminal, non-reversible transition. The audit log will record the closure remark type.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={close}>Confirm close</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        {target && (
          <div className="surface-panel p-6">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Order preview</div>
            <div className="mt-1 font-mono text-xl font-bold text-primary">{target.number}</div>
            <div className="text-sm">{target.customer}</div>
            <div className="mt-4 flex items-center gap-2 text-sm text-success">
              <CheckCircle2 className="h-4 w-4" /> Payment cleared · {inr(target.total)}
            </div>
            <div className="mt-4 space-y-1 text-xs text-muted-foreground">
              <div>Items: {target.items.length}</div>
              <div>Total sft: {target.sft}</div>
              <div>Created by: {target.createdBy}</div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
