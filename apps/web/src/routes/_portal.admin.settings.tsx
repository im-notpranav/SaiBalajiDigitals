import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { REMARK_TYPES } from "@/lib/constants";
import { toast } from "sonner";
import { useState } from "react";
import { apiClient } from "@/api/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";

export const Route = createFileRoute("/_portal/admin/settings")({
  head: () => ({ meta: [{ title: "System Settings — SB OMS" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newOrderNo, setNewOrderNo] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["order-sequence"],
    queryFn: async () => {
      const res = await apiClient.get("/admin/order-sequence");
      return res.data;
    }
  });

  const mutation = useMutation({
    mutationFn: async (payload: { next_order_number?: string, is_locked?: boolean }) => {
      const res = await apiClient.put("/admin/order-sequence", payload);
      return res.data;
    },
    onSuccess: () => {
      toast.success("Sequence updated successfully");
      queryClient.invalidateQueries({ queryKey: ["order-sequence"] });
      setDialogOpen(false);
      setNewOrderNo("");
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || "Failed to update sequence");
    }
  });

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">Loading settings...</div>;

  const seq = data?.seq;
  const nextOrderNumber = data?.next_order_number;

  return (
    <>
      <PageHeader title="System Configuration" description="Order-number sequence and reference data management." crumbs={[{ label: "Administrator" }, { label: "Settings" }]} />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="surface-panel p-6">
          <h3 className="mb-4 text-sm font-semibold">Order Number Sequence</h3>
          <div className="grid gap-3">
            <div><Label>Current prefix</Label><Input readOnly value={seq ? `ORD${seq.year_code}` : ""} className="mt-1.5 font-mono" /></div>
            <div><Label>Next number</Label><Input readOnly value={nextOrderNumber || ""} className="mt-1.5 font-mono" /></div>
            <div className="flex items-center justify-between rounded-lg border bg-background p-3">
              <div>
                <div className="text-sm font-semibold">Lock sequence adjustments</div>
                <div className="text-xs text-muted-foreground">Prevent manual overrides.</div>
              </div>
              <Switch 
                checked={seq?.is_locked || false} 
                onCheckedChange={(checked) => mutation.mutate({ is_locked: checked })}
                disabled={mutation.isPending}
              />
            </div>
            
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" className="rounded-xl" disabled={seq?.is_locked}>
                  Request sequence adjustment
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Adjust Next Order Number</DialogTitle>
                  <DialogDescription>
                    Warning: Changing the sequence can cause duplicate order numbers if set lower than the current value.
                    Current next number is <strong>{nextOrderNumber}</strong>.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label htmlFor="next_no">Desired Next Order Number</Label>
                    <Input 
                      id="next_no" 
                      value={newOrderNo} 
                      onChange={e => setNewOrderNo(e.target.value)} 
                      placeholder={nextOrderNumber} 
                      className="font-mono"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                  <Button 
                    variant="destructive" 
                    onClick={() => mutation.mutate({ next_order_number: newOrderNo })}
                    disabled={mutation.isPending || !newOrderNo.trim()}
                  >
                    Confirm Override
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            
          </div>
        </div>

        <div className="surface-panel p-6">
          <h3 className="mb-4 text-sm font-semibold">Reference data</h3>
          <div className="space-y-4">
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Order remark types</div>
              <div className="flex flex-wrap gap-1.5">
                {REMARK_TYPES.map((r) => <Badge key={r.value} variant="outline">{r.label}</Badge>)}
              </div>
            </div>
            <div className="rounded-lg border border-info/30 bg-info/5 p-3 text-xs text-info">
              Enum-backed values map 1:1 with Postgres enums. Changes require a DB migration.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
