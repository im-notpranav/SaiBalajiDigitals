import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, Factory, Flag, Ruler, Workflow } from "lucide-react";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "@/components/layout/PageStates";
import { KpiCard } from "@/components/kpi/KpiCard";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { fetchOrders } from "@/api/orders";
import { storeLabel } from "@/lib/stores";
import { cn } from "@/lib/utils";
import type { Order, OrderItem } from "@sb-oms/shared-types";
import {
  AttentionList,
  DashboardGuide,
  SectionHeading,
  type AttentionItem,
} from "@/components/dashboard/DashboardBits";

export const Route = createFileRoute("/_portal/production/dashboard")({
  head: () => ({ meta: [{ title: "Production Dashboard — SB OMS" }] }),
  component: ProductionDashboard,
});

/** "Mine" is this person's own assignment, which can finish before the item as a whole does. */
const isMineDone = (item: OrderItem) => item.my_assignment_completed ?? item.production_completed ?? false;

/** This person's own work: the API returns only the orders and items assigned to them. */
function ProductionDashboard() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["orders", "Active"],
    queryFn: () => fetchOrders({ status: "Active" }),
  });
  const orders: Order[] = data?.orders ?? [];
  const items = orders.flatMap((o) => o.items ?? []);
  const toDo = items.filter((i) => !isMineDone(i));
  const flagged = toDo.filter((i) => i.is_flagged).length;
  const done = items.length - toDo.length;
  const sftToDo = toDo.reduce((sum, i) => sum + (Number(i.total_sft) || 0), 0);

  const leftOn = (o: Order) => (o.items ?? []).filter((i) => !isMineDone(i)).length;
  // Unfinished orders first; the order finished long ago has nothing to say.
  const sorted = [...orders].sort((a, b) => Number(leftOn(b) > 0) - Number(leftOn(a) > 0));

  const attention: AttentionItem[] =
    flagged > 0
      ? [
          {
            key: "flagged",
            tone: "danger",
            title: `${flagged} of your ${flagged === 1 ? "items is" : "items are"} flagged and on hold`,
            detail: "You can't finish a flagged item until an admin resolves it.",
            cta: "See which",
            to: "/production/queue",
            search: { filter: "flagged" },
          },
        ]
      : [];

  return (
    <>
      <PageHeader
        title="My Production"
        description="The work assigned to you and how far along it is."
        crumbs={[{ label: "Dashboard" }]}
        actions={
          <Button asChild size="lg" className="rounded-xl shadow-soft">
            <Link to="/production/queue">
              <Workflow className="mr-2 h-4 w-4" aria-hidden /> Open my queue
            </Link>
          </Button>
        }
      />

      <DashboardGuide>
        <p>
          <strong>Your queue</strong> is where you mark each item finished. This page shows how much is left.
        </p>
        <p>
          <strong>SFT</strong> means square feet, the size of the print work.
        </p>
        <p>
          <strong>Order cards:</strong> click one to see the order's sizes and details. An item is complete once
          everyone assigned to it has finished their part.
        </p>
      </DashboardGuide>

      {isLoading ? (
        <LoadingState label="Loading your work…" />
      ) : error && !data ? (
        <ErrorState title="Couldn't load your work" error={error} onRetry={() => refetch()} />
      ) : (
        <>
          <AttentionList items={attention} className="mb-6" />

          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <KpiCard
              label="Items To Do"
              value={toDo.length}
              icon={Factory}
              accent="info"
              hint="Assigned to you, not finished"
              cta="Open the list"
              to="/production/queue"
              search={{ filter: "todo" }}
            />
            <KpiCard
              label="SFT To Do"
              value={sftToDo.toFixed(1)}
              icon={Ruler}
              accent="primary"
              hint="Square feet left in those items"
              cta="Open the list"
              to="/production/queue"
              search={{ filter: "todo" }}
            />
            <KpiCard
              label="On Hold"
              value={flagged}
              icon={Flag}
              accent="warning"
              hint="Flagged, waiting for an admin"
              cta="See which"
              to="/production/queue"
              search={{ filter: "flagged" }}
            />
            <KpiCard
              label="Finished"
              value={done}
              icon={CheckCircle2}
              accent="success"
              hint="Your part done, order still active"
              cta="See which"
              to="/production/queue"
              search={{ filter: "done" }}
            />
          </div>

          <section className="mt-8" aria-labelledby="my-orders-heading">
            <SectionHeading
              id="my-orders-heading"
              title="My orders"
              description="Orders with work left come first."
            />
            {sorted.length === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                title="Nothing is assigned to you right now"
                description="Orders show here once items are assigned to you."
              />
            ) : (
              <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {sorted.map((o) => {
                  const total = o.items?.length ?? 0;
                  const left = leftOn(o);
                  const finished = total - left;
                  const percent = total === 0 ? 0 : Math.round((finished / total) * 100);
                  const held = (o.items ?? []).some((i) => i.is_flagged && !isMineDone(i));
                  return (
                    <li key={o.id}>
                      <Link
                        to="/production/orders/$id"
                        params={{ id: String(o.id) }}
                        aria-label={`Open order ${o.order_no}, ${o.client_name}. ${finished} of ${total} of your items finished${held ? ", on hold" : ""}`}
                        className="group grid gap-2 rounded-xl border bg-card p-4 transition-[color,background-color,border-color,box-shadow,opacity,transform] hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs font-semibold text-primary">{o.order_no}</span>
                          {held ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
                              <Flag className="h-3 w-3" aria-hidden /> On hold
                            </span>
                          ) : (
                            <span
                              className={cn(
                                "rounded-full px-2 py-0.5 text-[11px] font-medium",
                                left === 0 ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
                              )}
                            >
                              {left === 0 ? "All finished" : `${left} to do`}
                            </span>
                          )}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{o.client_name}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {storeLabel(o as never)}
                            {o.date ? ` · ${format(new Date(o.date), "dd MMM yyyy")}` : ""}
                          </span>
                        </span>
                        <Progress value={percent} className="h-1.5" aria-hidden />
                        <span className="flex items-center justify-between text-[11px] text-muted-foreground">
                          <span>
                            {finished} of {total} of your items finished
                          </span>
                          <ArrowRight className="h-3.5 w-3.5 text-primary transition-transform group-hover:translate-x-0.5" aria-hidden />
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}
