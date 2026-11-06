import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { HardHat, Plus, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { JobDialog } from "@/components/allocation/JobDialog";
import { JobStatusBadge, LocalityTag } from "@/components/allocation/JobBits";
import { PaymentStatusBadge } from "@/components/payments/PaymentBits";
import { PaymentRequestSheet } from "@/components/payments/PaymentRequestSheet";
import {
  FIELD_ROLE_LABELS,
  JOB_EDITABLE,
  fetchWorkJobs,
  formatJobDates,
  jobPlace,
  type FieldRole,
  type WorkJob,
} from "@/api/allocation";
import { fetchPaymentRequests, formatRupees } from "@/api/payments";

const ROLES: FieldRole[] = ["PASTER", "HELPER", "DRIVER"];
/** Rows shown before "Show all", so a busy order does not push the page down. */
const SHOWN = 5;

/** "2 Pasters · 1 Driver": team size without names. */
function teamCounts(members: WorkJob["members"]) {
  return ROLES.map((r) => {
    const n = members.filter((m) => m.slot_role === r).length;
    return n ? `${n} ${FIELD_ROLE_LABELS[r]}${n === 1 ? "" : "s"}` : null;
  })
    .filter(Boolean)
    .join(" · ");
}

/**
 * Everything else filed under this order number: its field jobs and its payment requests.
 * Neither has a number of its own, so the order page is where both are found.
 */
export function OrderLinkedWork({
  orderId,
  orderNo,
  showPayments,
}: {
  orderId: number;
  orderNo: string;
  /** Payment requests are for the Admin; the Operation Manager sees only the jobs. */
  showPayments: boolean;
}) {
  const [dialog, setDialog] = useState<{ job: WorkJob | null } | null>(null);
  const [openPayment, setOpenPayment] = useState<number | null>(null);
  const [allJobs, setAllJobs] = useState(false);
  const [allPayments, setAllPayments] = useState(false);

  const { data: jobData, isLoading: jobsLoading } = useQuery({
    queryKey: ["work-jobs", "list", { order_id: String(orderId) }],
    queryFn: () => fetchWorkJobs({ order_id: String(orderId) }),
  });
  const { data: payData, isLoading: payLoading } = useQuery({
    queryKey: ["payment-requests", "order", orderId],
    queryFn: () => fetchPaymentRequests({ order_id: String(orderId) }),
    enabled: showPayments,
  });
  const jobs = jobData?.jobs ?? [];
  const payments = payData?.requests ?? [];

  return (
    <div className={showPayments ? "grid gap-4 lg:grid-cols-2" : "grid gap-4"}>
      <section className="surface-panel min-w-0 p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <HardHat className="h-4 w-4 text-primary" /> Field work
            <span className="text-xs font-normal text-muted-foreground">{jobs.length}</span>
          </h3>
          <Button size="sm" variant="outline" onClick={() => setDialog({ job: null })}>
            <Plus className="mr-1.5 h-4 w-4" /> Assign work
          </Button>
        </div>
        {jobsLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No field work on {orderNo} yet. “Assign work” books a team for a date.
          </p>
        ) : (
          <ul className="grid gap-2">
            {(allJobs ? jobs : jobs.slice(0, SHOWN)).map((j) => {
              const editable = JOB_EDITABLE.includes(j.status);
              return (
                <li key={j.id}>
                  <button
                    type="button"
                    disabled={!editable}
                    onClick={() => setDialog({ job: j })}
                    className="grid w-full gap-1 rounded-xl border p-3 text-left transition-colors enabled:hover:bg-muted/40 disabled:cursor-default"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium">
                        {formatJobDates(j.start_date, j.end_date)}
                      </span>
                      <JobStatusBadge status={j.status} />
                    </div>
                    <div className="break-words text-sm">{j.work_details}</div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        {jobPlace(j) ?? "Location not set"} <LocalityTag locality={j.locality} />
                      </span>
                      <span>· {teamCounts(j.members) || "No team"}</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {jobs.length > SHOWN && (
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => setAllJobs((v) => !v)}>
            {allJobs ? "Show fewer" : `Show all ${jobs.length}`}
          </Button>
        )}
      </section>

      {showPayments && (
        <section className="surface-panel min-w-0 p-4 sm:p-5">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Wallet className="h-4 w-4 text-primary" /> Payment requests
            <span className="text-xs font-normal text-muted-foreground">{payments.length}</span>
          </h3>
          {payLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nobody has asked to be paid for work on {orderNo}.
            </p>
          ) : (
            <ul className="grid gap-2">
              {(allPayments ? payments : payments.slice(0, SHOWN)).map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setOpenPayment(r.id)}
                    className="grid w-full gap-1 rounded-xl border p-3 text-left transition-colors hover:bg-muted/40"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold tabular-nums">{formatRupees(r.amount)}</span>
                      <PaymentStatusBadge status={r.status} />
                    </div>
                    <div className="break-words text-sm">{r.purpose}</div>
                    <div className="truncate text-xs text-muted-foreground">{r.requester.name}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {payments.length > SHOWN && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => setAllPayments((v) => !v)}
            >
              {allPayments ? "Show fewer" : `Show all ${payments.length}`}
            </Button>
          )}
        </section>
      )}

      <JobDialog
        open={!!dialog}
        job={dialog?.job}
        defaultOrderNo={orderNo}
        onClose={() => setDialog(null)}
      />
      {showPayments && (
        <PaymentRequestSheet requestId={openPayment} onClose={() => setOpenPayment(null)} />
      )}
    </div>
  );
}
