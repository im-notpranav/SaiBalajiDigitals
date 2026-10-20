import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ClipboardList, MapPin, Phone, Store, Truck, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { JobStatusBadge, LocalityTag } from "@/components/allocation/JobBits";
import { useAuth } from "@/lib/auth-store";
import { roleLabel } from "@/lib/constants";
import { FIELD_ROLE_LABELS, fetchMyJobs, formatJobDates, type MyJob } from "@/api/allocation";

export const Route = createFileRoute("/_portal/field/dashboard")({
  head: () => ({ meta: [{ title: "My Work — SB OMS" }] }),
  component: FieldDashboard,
});

/**
 * Home for Pasters, Helpers and Drivers, built for a phone: today's work first, then what
 * is coming up, then the last two weeks. Started / Completed buttons arrive in Phase E.
 */
function FieldDashboard() {
  const { user } = useAuth();
  const firstName = user?.name.split(" ")[0] ?? "";
  const { data, isLoading } = useQuery({
    queryKey: ["my", "work-jobs"],
    queryFn: fetchMyJobs,
    refetchInterval: 60_000,
  });

  const today = data?.today ?? "";
  const jobs = data?.jobs ?? [];
  const current = jobs.filter((j) => j.start_date <= today && j.end_date >= today);
  const upcoming = jobs.filter((j) => j.start_date > today);
  const past = jobs.filter((j) => j.end_date < today).reverse();

  return (
    <>
      <PageHeader
        title={`Hi ${firstName}`}
        description={roleLabel(user?.role)}
        crumbs={[{ label: "My Work" }]}
      />

      {!user?.phone && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
          <Phone className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span>
            Your WhatsApp number is missing. Add it on your Profile page so you receive job alerts.
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="surface-panel p-8 text-center text-muted-foreground">
          Loading your jobs…
        </div>
      ) : jobs.length === 0 ? (
        <div className="surface-panel flex flex-col items-center gap-3 p-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ClipboardList className="h-6 w-6" />
          </div>
          <div className="text-base font-semibold">No jobs assigned to you yet</div>
          <p className="max-w-sm text-sm text-muted-foreground">
            When the Operations Manager assigns you work, it shows up here with the CSM, location,
            team and vehicle.
          </p>
        </div>
      ) : (
        <div className="grid gap-6">
          <JobGroup title="Today" jobs={current} empty="Nothing for today." highlight />
          {upcoming.length > 0 && <JobGroup title="Coming up" jobs={upcoming} />}
          {past.length > 0 && <JobGroup title="Last two weeks" jobs={past} muted />}
        </div>
      )}
    </>
  );
}

function JobGroup({
  title,
  jobs,
  empty,
  highlight,
  muted,
}: {
  title: string;
  jobs: MyJob[];
  empty?: string;
  highlight?: boolean;
  muted?: boolean;
}) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      {jobs.length === 0 ? (
        <div className="surface-panel p-4 text-sm text-muted-foreground">{empty}</div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {jobs.map((j) => (
            <JobCard key={j.id} job={j} highlight={highlight} muted={muted} />
          ))}
        </div>
      )}
    </section>
  );
}

function JobCard({ job, highlight, muted }: { job: MyJob; highlight?: boolean; muted?: boolean }) {
  const { user } = useAuth();
  const team = job.members.filter((m) => m.user_id !== user?.id);
  return (
    <article
      className={cn(
        "surface-panel grid gap-3 p-4",
        highlight && "ring-1 ring-primary/30",
        muted && "opacity-75",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-sm font-semibold">{job.job_no}</div>
          <div className="truncate text-xs text-muted-foreground">
            {job.order.order_no} · {job.order.client_name}
          </div>
        </div>
        <JobStatusBadge status={job.status} />
      </div>

      <p className="text-sm font-medium">{job.work_details}</p>

      <dl className="grid gap-2 text-sm">
        <Row icon={CalendarDays}>
          {formatJobDates(job.start_date, job.end_date)} · {job.days} day{job.days === 1 ? "" : "s"}
        </Row>
        <Row icon={MapPin}>
          <span className="flex items-center gap-1.5">
            {job.area.name} <LocalityTag locality={job.locality} />
          </span>
          {job.route && <span className="block text-xs text-muted-foreground">{job.route}</span>}
        </Row>
        {job.stores.length > 0 && (
          <Row icon={Store}>
            {job.stores.map((s) => (
              <span key={s.id} className="block">
                {s.store_name}
                {s.location ? (
                  <span className="text-xs text-muted-foreground"> · {s.location}</span>
                ) : null}
              </span>
            ))}
          </Row>
        )}
        {team.length > 0 && (
          <Row icon={Users}>
            {team.map((m) => (
              <span key={m.user_id} className="flex items-center justify-between gap-2">
                <span>
                  {m.name}{" "}
                  <span className="text-xs text-muted-foreground">
                    · {FIELD_ROLE_LABELS[m.slot_role]}
                  </span>
                </span>
                {m.phone && <CallLink phone={m.phone} name={m.name} />}
              </span>
            ))}
          </Row>
        )}
        {job.vehicle && (
          <Row icon={Truck}>
            {job.vehicle.reg_no} · {job.vehicle.type}
          </Row>
        )}
      </dl>

      {job.instructions && <p className="rounded-lg bg-muted/50 p-2 text-sm">{job.instructions}</p>}

      {job.csm && (
        <div className="flex items-center justify-between gap-2 rounded-xl border p-2.5">
          <div className="min-w-0 text-sm">
            <div className="text-xs text-muted-foreground">CSM for this job</div>
            <div className="truncate font-medium">{job.csm.name}</div>
          </div>
          {job.csm.phone && (
            <a
              href={`tel:${job.csm.phone}`}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
            >
              <Phone className="h-4 w-4" /> Call
            </a>
          )}
        </div>
      )}
    </article>
  );
}

function Row({ icon: Icon, children }: { icon: typeof MapPin; children: ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}

function CallLink({ phone, name }: { phone: string; name: string }) {
  return (
    <a
      href={`tel:${phone}`}
      aria-label={`Call ${name}`}
      className="inline-flex h-7 w-7 items-center justify-center rounded-full border text-primary"
    >
      <Phone className="h-3.5 w-3.5" />
    </a>
  );
}
