import { useEffect, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  Building2,
  ChevronLeft,
  ChevronRight,
  MapPinOff,
  Route as RouteIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState, ErrorState } from "@/components/layout/PageStates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FIELD_ROLE_LABELS,
  addDays,
  formatJobDates,
  todayIST,
  type WorkJob,
} from "@/api/allocation";
import {
  fetchZoneBoard,
  mondayOf,
  type Zone,
  type ZoneArea,
  type ZoneBoard,
  type ZoneCount,
  type ZoneDistrict,
  type ZoneJob,
  type ZoneSpan,
} from "@/api/zoneBoard";
import { JobDetailDialog } from "./JobDetailDialog";
import { JobDialog } from "./JobDialog";
import { JobStatusBadge } from "./JobBits";
import { usePrefetchJobLookups } from "./jobLookups";

/**
 * Where the team is working, area-wise. The first view is two big tiles, Hyderabad and
 * Non-local (and a small one for jobs with no locality yet). Hyderabad opens its areas, each
 * with its jobs; Non-local opens its districts, then a district's areas and their jobs.
 *
 * Which day, the span and how far down the person has gone all live in the address, so the
 * phone's back gesture goes up a level and a dashboard tile can link straight to one zone.
 */

export interface ZoneSearch {
  date?: string;
  span?: ZoneSpan;
  zone?: Zone;
  /** A district's name, or NO_DISTRICT for non-local work whose area has none. */
  district?: string;
}

export const NO_DISTRICT = "__none__";

const ZONES: Record<Zone, { label: string; icon: LucideIcon }> = {
  LOCAL: { label: "Hyderabad", icon: Building2 },
  NON_LOCAL: { label: "Non-local", icon: RouteIcon },
  NOT_SET: { label: "Not set", icon: MapPinOff },
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const counts = (c: ZoneCount) =>
  `${plural(c.jobs, "job", "jobs")} · ${plural(c.people, "person", "people")}`;
const districtKey = (name: string | null) => (name === null ? NO_DISTRICT : name.toLowerCase());

const fmt = (d: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { ...opts, timeZone: "UTC" });

export function ZoneBoardPage({
  search,
  onSearch,
}: {
  search: ZoneSearch;
  /** `replace` for a date change, so stepping through days does not fill the back history. */
  onSearch: (next: ZoneSearch, opts?: { replace?: boolean }) => void;
}) {
  const today = todayIST();
  const date = search.date ?? today;
  const span: ZoneSpan = search.span ?? "day";
  const zone = search.zone;
  const district = zone === "NON_LOCAL" ? search.district : undefined;
  const [detail, setDetail] = useState<number | null>(null);
  const [editing, setEditing] = useState<WorkJob | null>(null);
  usePrefetchJobLookups();

  const { data, isLoading, isPlaceholderData, error, refetch } = useQuery({
    // Under "work-jobs", so a job saved or moved elsewhere refreshes this board too.
    queryKey: ["work-jobs", "zones", date, span],
    queryFn: () => fetchZoneBoard(date, span),
    // A new day keeps the last one on screen, dimmed, instead of dropping to a loader and back.
    placeholderData: keepPreviousData,
  });

  const setDate = (d: string) =>
    onSearch({ ...search, date: d === today ? undefined : d }, { replace: true });
  const setSpan = (s: ZoneSpan) =>
    onSearch({ ...search, span: s === "day" ? undefined : s }, { replace: true });
  const go = (next: Pick<ZoneSearch, "zone" | "district">) =>
    onSearch({ date: search.date, span: search.span, ...next });

  const step = span === "week" ? 7 : 1;
  const week = span === "week" ? { from: mondayOf(date), to: addDays(mondayOf(date), 6) } : null;
  const when = week ? "in this week" : "on this day";
  const rangeLabel = week
    ? `${fmt(week.from, { day: "numeric", month: "short" })} – ${fmt(week.to, { day: "numeric", month: "short", year: "numeric" })}`
    : `${date === today ? "Today · " : ""}${fmt(date, { weekday: "long", day: "numeric", month: "long" })}`;
  const onToday = week ? week.from === mondayOf(today) : date === today;

  // The trail: All zones › Non-local › Warangal. The last is where the person is.
  const districtGroup =
    data && district !== undefined
      ? data.NON_LOCAL.districts.find((d) => districtKey(d.name) === district.toLowerCase())
      : undefined;
  const districtLabel =
    district === undefined
      ? null
      : district === NO_DISTRICT
        ? "District not set"
        : (districtGroup?.name ?? district);
  const trail: { label: string; to: Pick<ZoneSearch, "zone" | "district"> }[] = [
    { label: "All zones", to: {} },
    ...(zone ? [{ label: ZONES[zone].label, to: { zone } }] : []),
    ...(zone && districtLabel ? [{ label: districtLabel, to: { zone, district } }] : []),
  ];
  const level = trail.length - 1;

  // Going down from far down a long list starts the next view at its top, not mid-way.
  const trailRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const viewKey = `${zone ?? ""}|${district ?? ""}`;
  const firstView = useRef(true);
  useEffect(() => {
    if (firstView.current) {
      firstView.current = false;
      return;
    }
    const el = trailRef.current;
    if (el && el.getBoundingClientRect().top < 0) {
      el.scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
    }
  }, [viewKey, reduceMotion]);

  return (
    <>
      <PageHeader
        title="Zone Board"
        description="Where the team is working, area-wise."
        crumbs={[{ label: "Work Allocation" }, { label: "Zone Board" }]}
      />

      <div className="surface-panel mb-4 flex flex-wrap items-center gap-2 p-3">
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Button
            variant="outline"
            size="icon"
            className="shrink-0"
            aria-label={span === "week" ? "Previous week" : "Previous day"}
            onClick={() => setDate(addDays(date, -step))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Input
            type="date"
            aria-label="Date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="min-w-0 flex-1 sm:w-40 sm:flex-none"
          />
          <Button
            variant="outline"
            size="icon"
            className="shrink-0"
            aria-label={span === "week" ? "Next week" : "Next day"}
            onClick={() => setDate(addDays(date, step))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          {!onToday && (
            <Button variant="ghost" className="shrink-0 px-3" onClick={() => setDate(today)}>
              Today
            </Button>
          )}
        </div>
        <span className="min-w-0 text-sm text-muted-foreground">{rangeLabel}</span>
        <div
          role="radiogroup"
          aria-label="Show"
          className="grid w-full grid-cols-2 rounded-xl border bg-muted/40 p-1 text-sm sm:ml-auto sm:inline-flex sm:w-auto"
        >
          {(
            [
              ["day", "Day"],
              ["week", "Week"],
            ] as const
          ).map(([s, label]) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={span === s}
              onClick={() => setSpan(s)}
              className={cn(
                "min-h-8 rounded-lg px-4 font-medium transition-colors",
                span === s
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Always one row high, so the views below never jump when it gains a level. */}
      <div ref={trailRef} className="mb-3 flex min-h-9 scroll-mt-20 items-center gap-1.5">
        {level > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 shrink-0 rounded-xl"
            onClick={() => go(trail[level - 1].to)}
          >
            <ChevronLeft className="mr-1 h-4 w-4" aria-hidden /> Back
          </Button>
        )}
        <nav
          aria-label="Zone"
          className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-sm"
        >
          {trail.map((t, i) => (
            <span key={i} className="flex min-w-0 items-center gap-1">
              {i > 0 && (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              )}
              {i === level ? (
                <span aria-current="location" className="truncate font-semibold">
                  {t.label}
                </span>
              ) : (
                <button
                  type="button"
                  className="truncate text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => go(t.to)}
                >
                  {t.label}
                </button>
              )}
            </span>
          ))}
        </nav>
      </div>

      {isLoading ? (
        <ZoneSkeleton
          level={
            zone
              ? district !== undefined || zone !== "NON_LOCAL"
                ? "areas"
                : "districts"
              : "tiles"
          }
        />
      ) : !data ? (
        <ErrorState title="Couldn't load the Zone Board" error={error} onRetry={() => refetch()} />
      ) : (
        // The dimming sits on its own wrapper: the entrance below sets opacity inline, which
        // would override the class.
        <div
          aria-busy={isPlaceholderData}
          className={cn(
            "transition-opacity duration-150",
            isPlaceholderData && "pointer-events-none opacity-60",
          )}
        >
          <motion.div
            key={viewKey}
            initial={reduceMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            {!zone ? (
              <ZoneTiles data={data} onPick={(z) => go({ zone: z })} />
            ) : zone === "NON_LOCAL" && district === undefined ? (
              <DistrictList
                districts={data.NON_LOCAL.districts}
                empty={`No non-local jobs ${when}.`}
                onPick={(d) => go({ zone, district: districtKey(d.name) })}
              />
            ) : (
              <AreaList
                areas={
                  zone === "NON_LOCAL"
                    ? (districtGroup?.areas ?? [])
                    : zone === "LOCAL"
                      ? data.LOCAL.areas
                      : data.NOT_SET.areas
                }
                empty={`No jobs ${zone === "NON_LOCAL" ? `in ${districtLabel}` : zone === "LOCAL" ? "in Hyderabad" : "without a locality"} ${when}.`}
                onOpen={setDetail}
              />
            )}
          </motion.div>
        </div>
      )}

      <JobDetailDialog
        jobId={detail}
        onClose={() => setDetail(null)}
        onEdit={(job) => {
          setDetail(null);
          setEditing(job);
        }}
      />
      <JobDialog open={!!editing} job={editing} onClose={() => setEditing(null)} />
    </>
  );
}

/** The first view: Hyderabad and Non-local side by side, Not set small beneath. */
function ZoneTiles({ data, onPick }: { data: ZoneBoard; onPick: (z: Zone) => void }) {
  const big: { zone: Zone; count: ZoneCount; cta: string; tone: string }[] = [
    {
      zone: "LOCAL",
      count: data.LOCAL.count,
      cta: "View areas",
      tone: "from-primary/15 text-primary",
    },
    {
      zone: "NON_LOCAL",
      count: data.NON_LOCAL.count,
      cta: "View districts",
      tone: "from-brand-orange/20 text-brand-orange",
    },
  ];
  const notSet = data.NOT_SET.count;
  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {big.map((t) => {
          const Icon = ZONES[t.zone].icon;
          return (
            <button
              key={t.zone}
              type="button"
              onClick={() => onPick(t.zone)}
              aria-label={`${ZONES[t.zone].label}: ${counts(t.count)}. ${t.cta}.`}
              className="surface-panel group relative flex min-h-40 flex-col justify-between overflow-hidden p-5 text-left transition-[box-shadow,transform] hover:shadow-md active:scale-[0.99] sm:min-h-48 sm:p-6"
            >
              <div
                className={cn(
                  "pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent opacity-70",
                  t.tone,
                )}
              />
              <div className="relative flex items-center gap-2.5">
                <span
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-2xl bg-background/70",
                    t.tone,
                  )}
                >
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <span className="text-lg font-semibold">{ZONES[t.zone].label}</span>
              </div>
              <div className="relative mt-4 flex flex-wrap items-end justify-between gap-3">
                <div className="flex items-end gap-6">
                  <div>
                    <div className="text-4xl font-bold tabular-nums sm:text-5xl">
                      {t.count.jobs}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {t.count.jobs === 1 ? "job" : "jobs"}
                    </div>
                  </div>
                  <div>
                    <div className="text-2xl font-semibold tabular-nums sm:text-3xl">
                      {t.count.people}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {t.count.people === 1 ? "person" : "people"}
                    </div>
                  </div>
                </div>
                <span className="flex items-center gap-1 text-sm font-medium text-primary">
                  {t.cta}
                  <ArrowRight
                    className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </span>
              </div>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => onPick("NOT_SET")}
        aria-label={`Not set: ${counts(notSet)}. Jobs with no Hyderabad or Non-local chosen. View jobs.`}
        className="surface-panel flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left transition-colors hover:bg-muted/40"
      >
        <MapPinOff className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="font-medium">Not set</span>
        <span
          className={cn(
            "text-sm tabular-nums",
            notSet.jobs > 0 ? "font-medium text-warning-foreground" : "text-muted-foreground",
          )}
        >
          {counts(notSet)}
        </span>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          No Hyderabad / Non-local chosen on the job
        </span>
        <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>
    </div>
  );
}

function DistrictList({
  districts,
  empty,
  onPick,
}: {
  districts: ZoneDistrict[];
  empty: string;
  onPick: (d: ZoneDistrict) => void;
}) {
  if (districts.length === 0) return <EmptyState icon={RouteIcon} title={empty} />;
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {districts.map((d) => (
        <li key={districtKey(d.name)}>
          <button
            type="button"
            onClick={() => onPick(d)}
            className="surface-panel group flex h-full w-full items-center gap-3 p-4 text-left transition-colors hover:bg-muted/40"
          >
            <div className="min-w-0 flex-1">
              <div
                className={cn("truncate font-semibold", d.name === null && "text-muted-foreground")}
              >
                {d.name ?? "District not set"}
              </div>
              <div className="mt-0.5 text-sm text-muted-foreground">
                {plural(d.areas.length, "area", "areas")} · {counts(d.count)}
              </div>
            </div>
            <ChevronRight
              className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Each area with its jobs laid out under it. */
function AreaList({
  areas,
  empty,
  onOpen,
}: {
  areas: ZoneArea[];
  empty: string;
  onOpen: (id: number) => void;
}) {
  if (areas.length === 0) return <EmptyState icon={Building2} title={empty} />;
  return (
    <div className="grid gap-4">
      {areas.map((a) => (
        <section
          key={a.id ?? "none"}
          className="surface-panel overflow-hidden"
          aria-label={a.name ?? "Area not set"}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b bg-muted/40 px-4 py-2.5">
            <h2
              className={cn(
                "min-w-0 truncate font-semibold",
                a.name === null && "text-muted-foreground",
              )}
            >
              {a.name ?? "Area not set"}
            </h2>
            <span className="text-sm tabular-nums text-muted-foreground">{counts(a.count)}</span>
          </div>
          <ul className="grid gap-3 p-3 md:grid-cols-2">
            {a.jobs.map((j) => (
              <li key={j.id} className="min-w-0">
                <ZoneJobCard job={j} onOpen={() => onOpen(j.id)} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ZoneJobCard({ job, onOpen }: { job: ZoneJob; onOpen: () => void }) {
  const days = Math.round((Date.parse(job.end_date) - Date.parse(job.start_date)) / 86_400_000) + 1;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="grid h-full w-full content-start gap-2 rounded-xl border p-3 text-left transition-colors hover:bg-muted/40"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono font-semibold">{job.order?.order_no ?? "No order"}</div>
          {job.order && (
            <div className="truncate text-xs text-muted-foreground" title={job.order.client_name}>
              {job.order.client_name}
            </div>
          )}
        </div>
        <JobStatusBadge status={job.status} />
      </div>
      <div className="text-xs text-muted-foreground">
        {formatJobDates(job.start_date, job.end_date)}
        {days > 1 && ` · ${days} days`}
      </div>
      <dl className="grid gap-1 text-sm">
        <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-2">
          <dt className="text-xs leading-5 text-muted-foreground">CSM</dt>
          <dd className="break-words">{job.csm ?? "Not set"}</dd>
        </div>
        <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-2">
          <dt className="text-xs leading-5 text-muted-foreground">Team</dt>
          <dd>
            {job.members.length === 0 ? (
              <span className="text-muted-foreground">No one yet</span>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {job.members.map((m) => (
                  <li
                    key={m.user_id}
                    className="rounded-full border bg-muted/40 px-2 py-0.5 text-xs"
                  >
                    {m.name}{" "}
                    <span className="text-muted-foreground">· {FIELD_ROLE_LABELS[m.role]}</span>
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>
    </button>
  );
}

/** The shape of what is coming, so nothing moves when it arrives. */
function ZoneSkeleton({ level }: { level: "tiles" | "districts" | "areas" }) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Loading the Zone Board…</span>
      <div aria-hidden>
        {level === "tiles" ? (
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {[0, 1].map((i) => (
                <div
                  key={i}
                  className="surface-panel flex min-h-40 flex-col justify-between p-5 sm:min-h-48 sm:p-6"
                >
                  <div className="flex items-center gap-2.5">
                    <Skeleton className="h-10 w-10 rounded-2xl" />
                    <Skeleton className="h-5 w-28" />
                  </div>
                  <div className="flex items-end gap-6">
                    <Skeleton className="h-12 w-14" />
                    <Skeleton className="h-9 w-12" />
                  </div>
                </div>
              ))}
            </div>
            <div className="surface-panel flex min-h-14 items-center gap-3 px-4 py-3">
              <Skeleton className="h-4 w-4" />
              <Skeleton className="h-4 w-40" />
            </div>
          </div>
        ) : level === "districts" ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="surface-panel grid gap-2 p-4">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-48" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid gap-4">
            {[0, 1].map((i) => (
              <div key={i} className="surface-panel overflow-hidden">
                <div className="flex justify-between border-b bg-muted/40 px-4 py-3">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-4 w-28" />
                </div>
                <div className="grid gap-3 p-3 md:grid-cols-2">
                  {[0, 1].map((k) => (
                    <div key={k} className="grid gap-2 rounded-xl border p-3">
                      <Skeleton className="h-5 w-28" />
                      <Skeleton className="h-3 w-24" />
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-3/4" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
