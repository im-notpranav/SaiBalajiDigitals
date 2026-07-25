import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { MessageSquare, Send } from "lucide-react";
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
import { PRODUCTION_REMARK_TYPES } from "@/lib/constants";
import { useQuery } from "@tanstack/react-query";
import { fetchOrders } from "@/api/orders";
import type { Order } from "@sb-oms/shared-types";

export const Route = createFileRoute("/_portal/production/remarks")({
  head: () => ({ meta: [{ title: "Production Remarks — SB OMS" }] }),
  component: RemarksPage,
});

function RemarksPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["orders", "Active"],
    queryFn: () => fetchOrders({ status: "Active" }),
  });

  const orders = data?.orders || [];
  
  const [order, setOrder] = useState<string>("");
  const [type, setType] = useState<string>(PRODUCTION_REMARK_TYPES[0]!);
  const [text, setText] = useState("");

  const submit = () => {
    if (!order) return toast.error("Please select an order");
    if (!text.trim()) return toast.error("Remark text is required");
    toast.success("Remark logged", { description: `${type} on ${order}` });
    setText("");
    setOrder("");
  };

  const recentRemarks = orders
    .filter((o: Order) => o.remarks)
    .slice(0, 5)
    .map((o: Order) => ({
      o: o.order_no,
      t: o.remarks,
      m: "Remark added during order creation or update.",
    }));

  return (
    <>
      <PageHeader title="Production Remarks" description="Log handoff context. Visible read-only to other portals." crumbs={[{ label: "Production" }, { label: "Remarks" }]} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="surface-panel space-y-4 p-6 lg:col-span-2">
          {isLoading ? (
            <div className="p-4 text-center text-sm text-muted-foreground">Loading active orders...</div>
          ) : orders.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">No active orders available.</div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold">Order</label>
                  <Select value={order} onValueChange={setOrder}>
                    <SelectTrigger><SelectValue placeholder="Select an order" /></SelectTrigger>
                    <SelectContent>
                      {orders.slice(0, 50).map((o: Order) => (
                        <SelectItem key={o.id} value={o.order_no}>{o.order_no} · {o.client_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold">Remark type</label>
                  <Select value={type} onValueChange={setType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PRODUCTION_REMARK_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold">Message</label>
                <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="Held for QC — awaiting print confirmation from customer…" />
              </div>
              <div className="flex justify-end">
                <Button onClick={submit} className="rounded-xl">
                  <Send className="mr-2 h-4 w-4" /> Log remark
                </Button>
              </div>
            </>
          )}
        </div>
        <div className="surface-panel p-6">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <MessageSquare className="h-4 w-4" /> Recent remarks
          </div>
          <ul className="space-y-3">
            {recentRemarks.length === 0 ? (
              <li className="text-sm text-muted-foreground">No recent remarks.</li>
            ) : (
              recentRemarks.map((r: any, i: number) => (
                <li key={i} className="rounded-lg border bg-background p-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono font-semibold text-primary">{r.o}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 font-semibold">{r.t}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{r.m}</p>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>
    </>
  );
}
