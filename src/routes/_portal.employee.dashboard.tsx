import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { PlusCircle, ClipboardList, Factory, Receipt, CheckCircle2, ArrowRight } from "lucide-react";
import { KpiCard } from "@/components/kpi/KpiCard";
import { PageHeader } from "@/components/layout/PageHeader";
import { OrdersTable } from "@/components/orders/OrdersTable";
import { Button } from "@/components/ui/button";
import { ORDERS, ordersByStatus } from "@/lib/mock-data";

export const Route = createFileRoute("/_portal/employee/dashboard")({
  head: () => ({ meta: [{ title: "Employee Dashboard — SB OMS" }] }),
  component: EmployeeDashboard,
});

function EmployeeDashboard() {
  const pending = ordersByStatus("pending").length;
  const inProd = ordersByStatus("in_production").length;
  const billed = ordersByStatus("billed").length;
  const closed = ordersByStatus("closed").length;
  const recent = ORDERS.slice(0, 8);

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
        <KpiCard label="Pending" value={pending} icon={ClipboardList} accent="warning" delay={0} hint="Awaiting production pickup" />
        <KpiCard label="In Production" value={inProd} icon={Factory} accent="info" delay={0.05} hint="Currently being worked" />
        <KpiCard label="Billed" value={billed} icon={Receipt} accent="primary" delay={0.1} hint="Invoiced by accounts" />
        <KpiCard label="Closed" value={closed} icon={CheckCircle2} accent="success" delay={0.15} hint="Delivered / finalised" />
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
        <OrdersTable orders={recent} detailBase="/employee/orders" />
      </motion.div>
    </>
  );
}
