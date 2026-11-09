import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, Clock, Factory, Flag, Ruler, Users } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { KpiCard } from "@/components/kpi/KpiCard";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "@/components/layout/PageStates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { fetchProdManagerDashboard } from "@/api/dashboard";
import type { ProdPendingItem, ProdTeamStat } from "@/api/dashboard";
import { cn } from "@/lib/utils";
import {
  AgingBadge,
  AgingLegend,
  AttentionList,
  DashboardGuide,
  FilterChip,
  ScrollTable,
  SectionHeading,
  scrollToSection,
  type AttentionItem,
} from "@/components/dashboard/DashboardBits";

export const Route = createFileRoute("/_portal/prod-manager/dashboard")({
  head: () => ({ meta: [{ title: "Production Dashboard — SB OMS" }] }),
  component: ProdManagerDashboard,
});

const PENDING_SECTION = "pending-items";
const TEAM_SECTION = "team-workload";

function ProdManagerDashboard() {
  const { data: dash, isLoading, error, refetch } = useQuery({
    queryKey: ["prod-manager-dashboard"],
    queryFn: fetchProdManagerDashboard,
  });
  const [person, setPerson] = useState<string | null>(null);

  const pending = useMemo(() => {
    const items = dash?.pending_items ?? [];
    if (!person) return items;
    // Only what this person still owes: an item they've finished may still wait on someone else.
    return items.filter((i) => i.assigned_to.some((a) => a.name === person && !a.completed));
  }, [dash?.pending_items, person]);

  const showPerson = (name: string) => {
    const next = person === name ? null : name;
    setPerson(next);
    if (next) scrollToSection(PENDING_SECTION);
  };

  const attention: AttentionItem[] = [];
  if (dash && dash.summary.total_items_flagged > 0) {
    const n = dash.summary.total_items_flagged;
    attention.push({
      key: "flagged",
      tone: "danger",
      title: `${n} ${n === 1 ? "item is" : "items are"} flagged and on hold`,
      detail: "Production can't finish a flagged item until an admin resolves it.",
      cta: "See which",
      to: "/prod-manager/assign",
      search: { filter: "flagged" },
    });
  }
  if (dash && dash.summary.total_items_unassigned > 0) {
    const n = dash.summary.total_items_unassigned;
    attention.push({
      key: "unassigned",
      tone: "info",
      title: `${n} ${n === 1 ? "item has" : "items have"} nobody assigned`,
      detail: "Assign anything that needs production. An order with nothing assigned can go straight to billing.",
      cta: "Assign work",
      to: "/prod-manager/assign",
      search: { filter: "unassigned" },
    });
  }

  return (
    <>
      <PageHeader
        title="Production Dashboard"
        description="How much work is left, and who is doing it."
        crumbs={[{ label: "Dashboard" }]}
        actions={
          <Button asChild size="lg" className="rounded-xl shadow-soft">
            <Link to="/prod-manager/assign">
              <Users className="mr-2 h-4 w-4" aria-hidden /> Assign Work
            </Link>
          </Button>
        }
      />

      <DashboardGuide>
        <p>
          <strong>SFT</strong> means square feet, the size of the print work. Pending SFT is assigned and not finished.
        </p>
        <p>
          <strong>Team workload:</strong> click a person to see only the items they still have to finish.
        </p>
        <p>
          <strong>Pending items:</strong> click an order number to open it on the Assign Work page and change who does
          it. An item is finished only when everyone assigned to it has finished, shown with a tick.
        </p>
        <AgingLegend />
      </DashboardGuide>

      {isLoading ? (
        <LoadingState label="Loading production data…" />
      ) : !dash ? (
        <ErrorState title="Couldn't load the dashboard" error={error} onRetry={() => refetch()} />
      ) : (
        <>
          <AttentionList items={attention} className="mb-6" />

          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <KpiCard
              label="Active Orders"
              value={dash.summary.total_active_orders}
              icon={Factory}
              accent="primary"
              hint="Orders still in production"
              cta="Open Assign Work"
              to="/prod-manager/assign"
            />
            <KpiCard
              label="Pending SFT"
              value={dash.summary.total_sft_pending.toFixed(1)}
              icon={Ruler}
              accent="warning"
              hint="Square feet assigned, not finished"
              cta="See the items"
              onClick={() => scrollToSection(PENDING_SECTION)}
            />
            <KpiCard
              label="Completed SFT"
              value={dash.summary.total_sft_completed.toFixed(1)}
              icon={CheckCircle2}
              accent="success"
              hint="Square feet finished on active orders"
              cta="See by person"
              onClick={() => scrollToSection(TEAM_SECTION)}
            />
            <KpiCard
              label="Items Pending"
              value={`${dash.summary.total_items_pending} / ${dash.summary.total_items_pending + dash.summary.total_items_completed}`}
              icon={Clock}
              accent="info"
              hint="Left to finish, out of all assigned"
              cta="See the items"
              onClick={() => scrollToSection(PENDING_SECTION)}
            />
          </div>

          {dash.team_stats.length > 0 && (
            <section id={TEAM_SECTION} className="mt-8 scroll-mt-20" aria-labelledby="team-heading">
              <SectionHeading
                id="team-heading"
                title="Team workload"
                description="Most pending first. Click a person to see their work."
              />
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {dash.team_stats.map((member: ProdTeamStat) => (
                  <TeamCard
                    key={member.user_id}
                    member={member}
                    selected={person === member.name}
                    onSelect={() => showPerson(member.name)}
                  />
                ))}
              </div>
            </section>
          )}

          {dash.pending_items.length > 0 && (
            <section id={PENDING_SECTION} className="mt-8 scroll-mt-20" aria-labelledby="pending-heading">
              <div className="overflow-hidden rounded-xl border">
                <div className="flex flex-wrap items-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-4 py-3">
                  <Clock className="h-4 w-4 text-amber-500" aria-hidden />
                  <h2 id="pending-heading" className="text-sm font-semibold">Pending production items</h2>
                  <Badge variant="secondary" className="text-xs">
                    {pending.length} {pending.length === 1 ? "item" : "items"}
                  </Badge>
                  {person && <FilterChip label={`Still with ${person}`} onClear={() => setPerson(null)} />}
                  <span className="ml-auto text-xs text-muted-foreground">Longest wait first</span>
                </div>
                {pending.length === 0 ? (
                  <p className="p-6 text-center text-sm text-muted-foreground">
                    {person} has finished everything assigned to them.
                  </p>
                ) : (
                  <ScrollTable label="Pending production items">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th scope="col" className="px-4 py-2.5 text-left font-medium text-muted-foreground">Order</th>
                          <th scope="col" className="px-4 py-2.5 text-left font-medium text-muted-foreground">Client</th>
                          <th scope="col" className="px-4 py-2.5 text-left font-medium text-muted-foreground">Media</th>
                          <th scope="col" className="px-4 py-2.5 text-right font-medium text-muted-foreground">SFT</th>
                          <th scope="col" className="px-4 py-2.5 text-left font-medium text-muted-foreground">Assigned to</th>
                          <th scope="col" className="px-4 py-2.5 text-right font-medium text-muted-foreground">Waiting</th>
                          <th scope="col" className="px-4 py-2.5"><span className="sr-only">Change</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {pending.map((item: ProdPendingItem) => (
                          <tr key={`${item.order_id}-${item.item_s_no}`} className="border-b transition-colors last:border-0 hover:bg-muted/20">
                            <td className="whitespace-nowrap px-4 py-2.5">
                              <Link
                                to="/prod-manager/assign"
                                search={{ order: item.order_id }}
                                className="-my-1 inline-block py-1.5 font-mono text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                {item.order_no}
                              </Link>
                              <span className="ml-1.5 text-[11px] text-muted-foreground">item {item.item_s_no}</span>
                            </td>
                            <td className="px-4 py-2.5 text-xs">{item.client_name}</td>
                            <td className="px-4 py-2.5 text-xs">
                              {item.media}
                              {item.is_flagged && (
                                <span className="ml-1.5 inline-flex items-center gap-1 rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                                  <Flag className="h-3 w-3" aria-hidden /> On hold
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-right text-xs font-medium tabular-nums">
                              {item.total_sft.toFixed(2)}
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="flex flex-wrap gap-1">
                                {item.assigned_to.map((a) => (
                                  <span
                                    key={a.name}
                                    className={cn(
                                      "rounded px-1.5 py-0.5 text-[10px]",
                                      a.completed ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
                                    )}
                                  >
                                    {a.name}
                                    {a.completed ? " ✓" : ""}
                                    {a.completed && <span className="sr-only"> finished</span>}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <AgingBadge days={item.days_since_assigned} />
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <Link
                                to="/prod-manager/assign"
                                search={{ order: item.order_id }}
                                aria-label={`Change who does item ${item.item_s_no} of ${item.order_no}`}
                                className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                Change <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </ScrollTable>
                )}
              </div>
            </section>
          )}

          {dash.team_stats.length === 0 && dash.pending_items.length === 0 && (
            <EmptyState
              className="mt-8"
              icon={CheckCircle2}
              title="Nothing is assigned to production right now"
              description="Assign items in Assign Work to see progress here."
              action={
                <Button asChild variant="outline" size="sm">
                  <Link to="/prod-manager/assign">Open Assign Work</Link>
                </Button>
              }
            />
          )}
        </>
      )}
    </>
  );
}

function TeamCard({
  member,
  selected,
  onSelect,
}: {
  member: ProdTeamStat;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "rounded-xl border bg-card p-5 text-left shadow-soft transition-[color,background-color,border-color,box-shadow,opacity,transform] hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        selected && "border-primary ring-1 ring-primary/40",
      )}
    >
      <span className="flex items-center gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary"
          aria-hidden
        >
          {member.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{member.name}</span>
          <span className="block text-[11px] text-muted-foreground">{member.assigned_items} items assigned</span>
        </span>
        <Badge
          variant="outline"
          className={cn(
            "text-xs tabular-nums",
            member.completion_rate >= 80
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : member.completion_rate >= 50
                ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                : "border-muted",
          )}
        >
          {member.completion_rate}% done
        </Badge>
      </span>

      <span className="mt-4 block space-y-2">
        <span className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Items finished</span>
          <span className="font-medium tabular-nums">
            {member.completed_items} of {member.assigned_items}
          </span>
        </span>
        <Progress value={member.completion_rate} className="h-2" aria-label={`${member.name}: ${member.completion_rate}% finished`} />
      </span>

      <span className="mt-3 grid grid-cols-2 gap-3">
        <span className="block rounded-lg border border-amber-500/10 bg-amber-500/5 px-3 py-2 text-center">
          <span className="block text-[11px] text-muted-foreground">Pending sft</span>
          <span className="block text-sm font-bold tabular-nums text-amber-700 dark:text-amber-400">
            {member.pending_sft.toFixed(1)}
          </span>
        </span>
        <span className="block rounded-lg border border-emerald-500/10 bg-emerald-500/5 px-3 py-2 text-center">
          <span className="block text-[11px] text-muted-foreground">Finished sft</span>
          <span className="block text-sm font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
            {member.completed_sft.toFixed(1)}
          </span>
        </span>
      </span>
    </button>
  );
}
