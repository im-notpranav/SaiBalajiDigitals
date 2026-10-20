import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Paperclip, Plus, Search, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  OPEN_PAYMENT_STATUSES,
  PAYMENT_STATUS_LABELS,
  fetchPaymentRequests,
  formatRupees,
  formatWhen,
  nextStepFor,
  roleLabel,
  type PaymentRequest,
  type PaymentStatus,
} from "@/api/payments";
import { NewPaymentRequestDialog, PaymentStatusBadge } from "./PaymentBits";
import { PaymentRequestSheet } from "./PaymentRequestSheet";

type Crumbs = { label: string; to?: string }[];

/* ------------------------------------------------------------------ requester */

/** A CSM's or field staff member's own requests, newest first, with a button to raise one. */
export function MyPaymentRequests({ crumbs }: { crumbs: Crumbs }) {
  const [show, setShow] = useState<"open" | "all">("open");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["payment-requests", "mine"],
    queryFn: () => fetchPaymentRequests(),
  });
  const all = data?.requests ?? [];
  const rows = show === "open" ? all.filter((r) => OPEN_PAYMENT_STATUSES.includes(r.status)) : all;
  const returned = all.filter((r) => r.status === "INFO_REQUESTED").length;

  return (
    <>
      <PageHeader
        title="Payment Requests"
        description="Ask to be paid back for work expenses on your orders. The company pays to your UPI ID once it is approved."
        crumbs={crumbs}
        actions={
          <Button className="rounded-xl" onClick={() => setCreating(true)}>
            <Plus className="mr-2 h-4 w-4" /> New request
          </Button>
        }
      />

      {returned > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {returned === 1 ? "1 request was" : `${returned} requests were`} returned to you. Open it
          to correct and resubmit.
        </div>
      )}

      <div className="mb-3 inline-flex rounded-xl border p-1">
        {(["open", "all"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setShow(s)}
            className={cn(
              "rounded-lg px-3 py-1 text-sm",
              show === s ? "bg-primary text-primary-foreground" : "text-muted-foreground",
            )}
          >
            {s === "open" ? "Open" : "All"}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="surface-panel p-8 text-center text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="surface-panel flex flex-col items-center gap-3 p-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Wallet className="h-6 w-6" />
          </div>
          <div className="text-base font-semibold">
            {show === "open" ? "No open requests" : "No requests yet"}
          </div>
          <p className="max-w-sm text-sm text-muted-foreground">
            Use “New request” to ask for money spent on an order. Orders open for requests once
            production is finished.
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {rows.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setOpenId(r.id)}
              className={cn(
                "surface-panel grid gap-1 p-4 text-left transition-colors hover:bg-muted/40",
                r.status === "INFO_REQUESTED" && "border-warning/50",
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-semibold">{r.request_no}</span>
                  <PaymentStatusBadge status={r.status} />
                </div>
                <span className="text-lg font-semibold tabular-nums">{formatRupees(r.amount)}</span>
              </div>
              <div className="text-sm">{r.purpose}</div>
              <div className="text-xs text-muted-foreground">
                <span className="font-mono">{r.order.order_no}</span> · {r.order.client_name} ·{" "}
                {formatWhen(r.created_at)}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
                {nextStepFor(r)}
                {r.bill_missing && <BillMissing />}
              </div>
            </button>
          ))}
        </div>
      )}

      <NewPaymentRequestDialog
        open={creating}
        onClose={() => setCreating(false)}
        lastUpi={all[0]?.upi_id}
      />
      <PaymentRequestSheet requestId={openId} onClose={() => setOpenId(null)} />
    </>
  );
}

/* ------------------------------------------------------------------ reviewers */

const ALL = "__all__";

const QUEUE_HINTS: Partial<Record<PaymentStatus, string>> = {
  ADMIN_REVIEW: "No-bill requests waiting for the Admin",
  CCM_REVIEW: "Waiting for your approval",
  PAYMENT_PENDING: "Approved, to be paid",
  PAID: "Paid, to be closed",
};

/**
 * The Admin's and the Cost Control Manager's view: what waits on them (oldest first) and
 * every request, with each order's value against what has been asked for on it.
 */
export function PaymentReviewQueue({
  title,
  description,
  crumbs,
}: {
  title: string;
  description: string;
  crumbs: Crumbs;
}) {
  const [tab, setTab] = useState<"queue" | "all">("queue");
  const [status, setStatus] = useState<string>(ALL);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const params = {
    scope: tab === "queue" ? ("queue" as const) : undefined,
    status: status === ALL ? undefined : status,
    q: debouncedQ || undefined,
  };
  const { data, isLoading } = useQuery({
    queryKey: ["payment-requests", "review", params],
    queryFn: () => fetchPaymentRequests(params),
  });
  const rows = data?.requests ?? [];
  const queueStatuses = data?.queue_statuses ?? [];

  return (
    <>
      <PageHeader title={title} description={description} crumbs={crumbs} />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {queueStatuses.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setTab("queue");
              setStatus(s);
            }}
            className={cn(
              "surface-panel p-4 text-left transition-colors hover:bg-muted/40",
              tab === "queue" && status === s && "ring-2 ring-primary/40",
            )}
          >
            <div className="text-xs text-muted-foreground">{PAYMENT_STATUS_LABELS[s]}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{data?.counts[s] ?? 0}</div>
            <div className="text-xs text-muted-foreground">
              {formatRupees(data?.amounts[s] ?? 0)} · {QUEUE_HINTS[s]}
            </div>
          </button>
        ))}
      </div>

      <div className="surface-panel mb-4 grid gap-3 p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
        <div className="inline-flex rounded-xl border p-1">
          {(["queue", "all"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTab(t);
                setStatus(ALL);
              }}
              className={cn(
                "rounded-lg px-3 py-1 text-sm",
                tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground",
              )}
            >
              {t === "queue" ? "Waiting on me" : "All requests"}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Request no, order, client, requester or purpose"
            className="pl-9"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>
              {tab === "queue" ? "Everything waiting" : "All statuses"}
            </SelectItem>
            {(tab === "queue"
              ? queueStatuses
              : (Object.keys(PAYMENT_STATUS_LABELS) as PaymentStatus[])
            ).map((s) => (
              <SelectItem key={s} value={s}>
                {PAYMENT_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="surface-panel overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead>Request</TableHead>
              <TableHead>Requested by</TableHead>
              <TableHead>Order</TableHead>
              <TableHead>For</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Bill</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="p-8 text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="p-8 text-center text-muted-foreground">
                  {tab === "queue" ? "Nothing is waiting on you." : "No requests match."}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow
                  key={r.id}
                  className="cursor-pointer"
                  tabIndex={0}
                  onClick={() => setOpenId(r.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setOpenId(r.id);
                    }
                  }}
                >
                  <TableCell>
                    <div className="font-mono font-semibold">{r.request_no}</div>
                    <div className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatWhen(r.created_at)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="whitespace-nowrap">{r.requester.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {roleLabel(r.requester.role)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="font-mono text-sm">{r.order.order_no}</div>
                    <div className="max-w-[12rem] truncate text-xs text-muted-foreground">
                      {r.order.client_name}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[16rem]">
                    <div className="line-clamp-2 text-sm">{r.purpose}</div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="whitespace-nowrap font-semibold tabular-nums">
                      {formatRupees(r.amount)}
                    </div>
                    {r.order_money?.over_value && (
                      <div
                        className="flex items-center justify-end gap-1 whitespace-nowrap text-xs text-destructive"
                        title={`Asked ${formatRupees(r.order_money.requested)} on an order worth ${formatRupees(r.order_money.order_value)}`}
                      >
                        <AlertTriangle className="h-3 w-3" /> Over order value
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    <div>{r.bill_details_required ? "Yes" : "No"}</div>
                    {r.bill_missing ? (
                      <BillMissing />
                    ) : (
                      fileCount(r) > 0 && (
                        <div className="flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground">
                          <Paperclip className="h-3 w-3" /> {fileCount(r)}
                        </div>
                      )
                    )}
                  </TableCell>
                  <TableCell>
                    <PaymentStatusBadge status={r.status} />
                    <div className="mt-1 whitespace-nowrap text-xs text-muted-foreground">
                      since {formatWhen(r.status_changed_at)}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <PaymentRequestSheet requestId={openId} onClose={() => setOpenId(null)} />
    </>
  );
}

const fileCount = (r: PaymentRequest) =>
  r.attachment_counts.BILL + r.attachment_counts.PHOTO + r.attachment_counts.RECEIPT;

/** A bill request with no bill on file: it cannot be closed until one is attached. */
function BillMissing() {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning-foreground">
      <AlertTriangle className="h-3 w-3" /> Bill missing
    </span>
  );
}
