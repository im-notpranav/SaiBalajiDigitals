import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import {
  Factory,
  Ruler,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Users,
  ArrowRight,
} from "lucide-react";
import { KpiCard } from "@/components/kpi/KpiCard";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useQuery } from "@tanstack/react-query";
import { fetchProdManagerDashboard } from "@/api/dashboard";
import type { ProdTeamStat, ProdPendingItem } from "@/api/dashboard";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_portal/prod-manager/dashboard")({
  head: () => ({ meta: [{ title: "Production Dashboard — SB OMS" }] }),
  component: ProdManagerDashboard,
});

function agingLevel(days: number): "normal" | "warning" | "severe" {
  if (days > 7) return "severe";
  if (days > 3) return "warning";
  return "normal";
}

function AgingBadge({ days }: { days: number }) {
  const level = agingLevel(days);
  return (
    <Badge
      className={cn(
        "gap-1 font-mono text-[11px]",
        level === "severe" && "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
        level === "warning" && "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
        level === "normal" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      )}
      variant="outline"
    >
      {level === "severe" && <AlertTriangle className="h-3 w-3" />}
      {level === "warning" && <Clock className="h-3 w-3" />}
      {days}d
    </Badge>
  );
}

function ProdManagerDashboard() {
  const { data: dash, isLoading } = useQuery({
    queryKey: ["prod-manager-dashboard"],
    queryFn: fetchProdManagerDashboard,
  });

  return (
    <>
      <PageHeader
        title="Production Dashboard"
        description="SFT metrics, team workload, and pending items."
        crumbs={[{ label: "Production Manager" }, { label: "Dashboard" }]}
        actions={
          <Button asChild size="lg" className="rounded-xl shadow-soft">
            <Link to="/prod-manager/assign">
              <Users className="mr-2 h-4 w-4" /> Assign Work
            </Link>
          </Button>
        }
      />

      {isLoading ? (
        <div className="p-12 text-center text-muted-foreground">Loading production data...</div>
      ) : !dash ? (
        <div className="p-12 text-center text-muted-foreground">No data available.</div>
      ) : (
        <>
          {/* Summary KPIs */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard
              label="Active Orders"
              value={dash.summary.total_active_orders}
              icon={Factory}
              accent="primary"
              delay={0}
            />
            <KpiCard
              label="Pending SFT"
              value={`${dash.summary.total_sft_pending.toFixed(1)}`}
              icon={Ruler}
              accent="warning"
              delay={0.05}
              hint="Awaiting production"
            />
            <KpiCard
              label="Completed SFT"
              value={`${dash.summary.total_sft_completed.toFixed(1)}`}
              icon={CheckCircle2}
              accent="success"
              delay={0.1}
              hint="Production done"
            />
            <KpiCard
              label="Items Pending"
              value={`${dash.summary.total_items_pending} / ${dash.summary.total_items_pending + dash.summary.total_items_completed}`}
              icon={Clock}
              accent="info"
              delay={0.15}
              hint="Remaining line items"
            />
          </div>

          {/* Team breakdown */}
          {dash.team_stats.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="mt-8"
            >
              <h2 className="mb-4 text-lg font-semibold">Team Workload</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {dash.team_stats.map((member: ProdTeamStat, i: number) => (
                  <TeamCard key={member.user_id} member={member} delay={0.05 * i} />
                ))}
              </div>
            </motion.div>
          )}

          {/* Pending items table */}
          {dash.pending_items.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="mt-8"
            >
              <div className="rounded-xl border overflow-hidden">
                <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-3 flex items-center gap-2">
                  <Clock className="h-4 w-4 text-amber-500" />
                  <span className="font-semibold text-sm">Pending Production Items</span>
                  <Badge variant="secondary" className="ml-auto text-xs">
                    {dash.pending_items.length} items
                  </Badge>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Order</th>
                        <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Client</th>
                        <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Media</th>
                        <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">SFT</th>
                        <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Assigned To</th>
                        <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Age</th>
                        <th className="px-4 py-2.5"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {dash.pending_items.map((item: ProdPendingItem, idx: number) => (
                        <tr key={`${item.order_id}-${item.item_s_no}`} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-2.5">
                            <span className="font-mono text-xs font-medium">{item.order_no}</span>
                            <span className="ml-1.5 text-[11px] text-muted-foreground">#{item.item_s_no}</span>
                          </td>
                          <td className="px-4 py-2.5 text-xs">{item.client_name}</td>
                          <td className="px-4 py-2.5 text-xs">{item.media}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-xs font-medium">
                            {item.total_sft.toFixed(2)}
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex flex-wrap gap-1">
                              {item.assigned_to.map((a, j) => (
                                <span
                                  key={j}
                                  className={cn(
                                    "rounded px-1.5 py-0.5 text-[10px]",
                                    a.completed
                                      ? "bg-success/15 text-success"
                                      : "bg-muted text-muted-foreground",
                                  )}
                                >
                                  {a.name}{a.completed ? " ✓" : ""}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <AgingBadge days={item.days_since_assigned} />
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <Button asChild variant="ghost" size="sm" className="h-7 px-2">
                              <Link to="/prod-manager/assign">
                                <ArrowRight className="h-3.5 w-3.5" />
                              </Link>
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {dash.team_stats.length === 0 && dash.pending_items.length === 0 && (
            <div className="mt-8 surface-panel p-12 text-center text-muted-foreground">
              No items are currently assigned to production teams.
            </div>
          )}
        </>
      )}
    </>
  );
}

function TeamCard({ member, delay }: { member: ProdTeamStat; delay: number }) {
  const totalSft = member.pending_sft + member.completed_sft;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4 }}
      className="rounded-xl border bg-card p-5 shadow-soft"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
          {member.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-sm truncate">{member.name}</div>
          <div className="text-[11px] text-muted-foreground">
            {member.assigned_items} items assigned
          </div>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "text-xs tabular-nums",
            member.completion_rate >= 80
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
              : member.completion_rate >= 50
                ? "border-amber-500/30 bg-amber-500/10 text-amber-600"
                : "border-muted",
          )}
        >
          {member.completion_rate}%
        </Badge>
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Completion</span>
          <span className="tabular-nums font-medium">
            {member.completed_items} / {member.assigned_items}
          </span>
        </div>
        <Progress value={member.completion_rate} className="h-2" />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-amber-500/5 border border-amber-500/10 px-3 py-2 text-center">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Pending</div>
          <div className="text-sm font-bold tabular-nums text-amber-600 dark:text-amber-400">
            {member.pending_sft.toFixed(1)}
          </div>
          <div className="text-[10px] text-muted-foreground">sft</div>
        </div>
        <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/10 px-3 py-2 text-center">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Done</div>
          <div className="text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
            {member.completed_sft.toFixed(1)}
          </div>
          <div className="text-[10px] text-muted-foreground">sft</div>
        </div>
      </div>
    </motion.div>
  );
}
