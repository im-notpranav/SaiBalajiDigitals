import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorState, LoadingState } from "@/components/layout/PageStates";
import {
  FIELD_ROLE_LABELS,
  fetchJobOverview,
  fetchWorkJobs,
  formatJobDates,
  todayIST,
  type FieldRole,
  type WorkJob,
} from "@/api/allocation";
import { JobDialog } from "./JobDialog";
import { JobDetailDialog } from "./JobDetailDialog";
import { JobStatusBadge } from "./JobBits";

const ALL = "__all__";
const LIVE = "ASSIGNED,STARTED,HOLD,COMPLETED";
type Tile = "LOCAL" | "NON_LOCAL" | "NOT_SET";
const TILES: { key: Tile; label: string }[] = [
  { key: "LOCAL", label: "Hyderabad" },
  { key: "NON_LOCAL", label: "Non-local" },
  { key: "NOT_SET", label: "Not set" },
];
const FREE_ROLES: FieldRole[] = ["PASTER", "HELPER"];

/**
 * The Operation Manager's first view: a shortcut to assign work, who is free over a date range,
 * and how many jobs run where. A tile opens that location's jobs, grouped by area.
 */
export function OperationsOverview() {
  const today = todayIST();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [area, setArea] = useState(ALL);
  const [tile, setTile] = useState<Tile | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [detail, setDetail] = useState<number | null>(null);
  const [editing, setEditing] = useState<WorkJob | null>(null);

  const areaName = area === ALL ? undefined : area;
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["work-jobs", "overview", { from, to, area: areaName }],
    queryFn: () => fetchJobOverview({ from, to, area: areaName }),
    placeholderData: keepPreviousData,
  });
  // Keeps a chosen area in the list even when the new dates have no job there.
  const areas = [...new Set([...(data?.areas ?? []), ...(areaName ? [areaName] : [])])].sort();

  return (
    <section className="surface-panel mb-6 grid gap-4 p-4 sm:p-5" aria-label="Field work overview">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="lg" className="rounded-xl" onClick={() => setAssigning(true)}>
            <Plus className="mr-2 h-5 w-5" aria-hidden /> Assign Work
          </Button>
          <Button asChild variant="outline" size="lg" className="rounded-xl">
            <Link to="/admin/board" search={{ date: from }}>Daily Board</Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="rounded-xl">
            <Link to="/admin/grid">Weekly Grid</Link>
          </Button>
        </div>
        <div className="flex flex-wrap items-end gap-2 sm:ml-auto">
          <label className="grid gap-1 text-xs text-muted-foreground">
            From
            <Input
              type="date"
              value={from}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                setFrom(v);
                if (to < v) setTo(v);
              }}
              className="w-40"
            />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            To
            <Input
              type="date"
              value={to}
              min={from}
              onChange={(e) => e.target.value && setTo(e.target.value)}
              className="w-40"
            />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Area
            <Select value={area} onValueChange={setArea}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All areas</SelectItem>
                {areas.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
      </div>

      {isLoading ? (
        <LoadingState bare />
      ) : !data ? (
        <ErrorState bare title="Couldn't load the overview" error={error} onRetry={() => refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {TILES.map((t) => (
              <button
                key={t.key}
                type="button"
                aria-expanded={tile === t.key}
                onClick={() => setTile(tile === t.key ? null : t.key)}
                className={cn(
                  "min-w-0 rounded-xl border p-3 text-left transition-colors",
                  tile === t.key ? "border-primary bg-primary/10" : "hover:bg-muted/50",
                )}
              >
                <div className="text-2xl font-bold tabular-nums">{data.jobs[t.key]}</div>
                <div className="truncate text-xs text-muted-foreground sm:text-sm">{t.label}</div>
                <div className="mt-1 text-xs font-medium text-primary">
                  {tile === t.key ? "Hide jobs" : "List jobs"}
                </div>
              </button>
            ))}
          </div>

          {tile && (
            <TileJobs
              filters={{ from, to, locality: tile, area: areaName }}
              onOpen={(id) => setDetail(id)}
            />
          )}

          <div className="grid gap-3 md:grid-cols-2">
            {FREE_ROLES.map((r) => (
              <div key={r} className="min-w-0">
                <div className="mb-1.5 text-sm font-medium">
                  Free {FIELD_ROLE_LABELS[r].toLowerCase()}s{" "}
                  <span
                    className={cn(
                      "tabular-nums",
                      data.free[r].length === 0 ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    ({data.free[r].length})
                  </span>
                  <span className="ml-1 text-xs font-normal text-muted-foreground">on all of these dates</span>
                </div>
                {data.free[r].length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nobody is free on all of these dates.
                  </p>
                ) : (
                  <ul className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
                    {data.free[r].map((p) => (
                      <li
                        key={p.id}
                        className="rounded-full border bg-muted/40 px-2.5 py-0.5 text-xs"
                      >
                        {p.name}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <JobDialog open={assigning} onClose={() => setAssigning(false)} defaultDate={from} />
      <JobDetailDialog
        jobId={detail}
        onClose={() => setDetail(null)}
        onEdit={(job) => {
          setDetail(null);
          setEditing(job);
        }}
      />
      <JobDialog open={!!editing} job={editing} onClose={() => setEditing(null)} />
    </section>
  );
}

/** One location's jobs over the range, grouped by area name. */
function TileJobs({
  filters,
  onOpen,
}: {
  filters: { from: string; to: string; locality: Tile; area?: string };
  onOpen: (id: number) => void;
}) {
  const params = { ...filters, status: LIVE };
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["work-jobs", "list", params],
    queryFn: () => fetchWorkJobs(params),
  });
  if (isLoading) return <LoadingState bare className="p-4" />;
  if (!data) return <ErrorState bare error={error} onRetry={() => refetch()} />;
  if (data.jobs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
        No jobs here over these dates.
      </div>
    );
  }

  const groups = new Map<string, WorkJob[]>();
  for (const j of data.jobs) {
    const name = j.area?.name ?? "No area name";
    groups.set(name, [...(groups.get(name) ?? []), j]);
  }
  return (
    <div className="grid gap-3">
      {[...groups.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, jobs]) => (
          <div key={name} className="overflow-hidden rounded-xl border">
            <div className="flex items-center justify-between gap-2 bg-muted/40 px-3 py-2 text-sm font-medium">
              <span className="min-w-0 truncate">{name}</span>
              <span className="tabular-nums text-muted-foreground">{jobs.length}</span>
            </div>
            <ul>
              {jobs.map((j) => (
                <li key={j.id} className="border-t">
                  <button
                    type="button"
                    onClick={() => onOpen(j.id)}
                    className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/40"
                  >
                    <span className="min-w-0">
                      <span className="font-mono font-semibold">
                        {j.order?.order_no ?? "No order"}
                      </span>
                      {j.order && (
                        <span className="text-muted-foreground"> · {j.order.client_name}</span>
                      )}
                      <span className="block text-xs text-muted-foreground">
                        {formatJobDates(j.start_date, j.end_date)}
                        {j.csm ? ` · ${j.csm.name}` : ""}
                      </span>
                    </span>
                    <JobStatusBadge status={j.status} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
    </div>
  );
}
