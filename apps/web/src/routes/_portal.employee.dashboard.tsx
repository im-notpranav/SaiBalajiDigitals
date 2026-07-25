import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { PlusCircle, ClipboardList, Factory, Receipt, CheckCircle2, ArrowRight } from "lucide-react";
import { KpiCard } from "@/components/kpi/KpiCard";
import { PageHeader } from "@/components/layout/PageHeader";
import { OrdersTable } from "@/components/orders/OrdersTable";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { fetchDashboard } from "@/api/dashboard";
import { fetchOrders } from "@/api/orders";

export const Route = createFileRoute("/_portal/employee/dashboard")({
  head: () => ({ meta: [{ title: "Employee Dashboard — SB OMS" }] }),
  component: EmployeeDashboard,
});

function EmployeeDashboard() {
  const { data: dash } = useQuery({ queryKey: ["dashboard"], queryFn: fetchDashboard });
  const { data: ordersData, isLoading } = useQuery({ 
    queryKey: ["orders", "recent", 8], 
    queryFn: () => fetchOrders({ limit: 8 }) 
  });

  const recent = ordersData?.orders || [];

  return (
    <>
      <PageHeader
        title="Employee Dashboard"
        description="Track the orders you've created and originate new ones."
        crumbs={[{ label: "Employee" }, { label: "Dashboard" }]}
        actions={
          <Button asChild size="lg" className="rounded-xl shadow-soft">
            <Link to="/employee/new-order">
              <PlusCircle className="mr-2 h-4 w-4" /> New Order
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Active" value={dash?.active_orders || 0} icon={Factory} accent="info" delay={0.05} hint="Currently in production" />
        <KpiCard label="Pending" value={dash?.pending_orders || 0} icon={Receipt} accent="warning" delay={0.1} hint="Awaiting billing/closure" />
        <KpiCard label="Completed" value={dash?.completed_orders || 0} icon={CheckCircle2} accent="success" delay={0.15} hint="Closed & finalised" />
        <KpiCard label="Total Orders" value={dash?.total_orders || 0} icon={ClipboardList} accent="primary" delay={0} />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.5 }}
        className="mt-8"
      >
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="text-lg font-semibold">Recent Orders</h2>
            <p className="text-xs text-muted-foreground">Your latest activity, newest first.</p>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link to="/employee/orders">
              View all <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">Loading recent orders...</div>
        ) : (
          <OrdersTable orders={recent} detailBase="/employee/orders" />
        )}
      </motion.div>
    </>
  );
}
