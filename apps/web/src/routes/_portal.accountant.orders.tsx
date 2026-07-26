import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { OrdersTable } from "@/components/orders/OrdersTable";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery } from "@tanstack/react-query";
import { fetchOrders } from "@/api/orders";
import { Globe } from "lucide-react";

export const Route = createFileRoute("/_portal/accountant/orders")({
  head: () => ({ meta: [{ title: "Company Orders — SB OMS" }] }),
  component: AccountantOrders,
});

function AccountantOrders() {
  const [section, setSection] = useState<"active" | "completed">("active");

  const { data, isLoading } = useQuery({
    queryKey: ["orders", "accountant", section],
    queryFn: () => fetchOrders({ section }),
  });

  return (
    <>
      <PageHeader
        title="Company-Wide Orders"
        description="Global view of all orders across the company for auditing and oversight."
        crumbs={[{ label: "Accountant" }, { label: "All Orders" }]}
      />
      
      <div className="mb-4 rounded-xl border border-info/40 bg-info/10 p-3 text-sm text-info-foreground">
        <Globe className="mr-2 inline h-4 w-4" />
        <span className="font-semibold">Global View:</span> You have read-only access to all orders across the company. To reconcile pending orders, please use the Billing Queue.
      </div>
      
      <div className="surface-panel mb-4 p-3">
        <Tabs value={section} onValueChange={(v) => setSection(v as "active" | "completed")} className="w-[300px]">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="completed">Completed</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-muted-foreground">Loading orders...</div>
      ) : (
        <OrdersTable 
          orders={data?.orders || []} 
          showCreator 
        />
      )}
    </>
  );
}
