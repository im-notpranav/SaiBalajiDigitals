import type { RowLinkTarget } from "@/hooks/useRowLink";
import { remarkLabel, roleLabel } from "@/lib/constants";
import { BarList, COLORS, DataTable, Panel, Pill, StatGrid, TrendChart, fmt, words, type Column } from "./parts";

/**
 * One component per Reports tab. Each reads the JSON its /api/reports/:tab endpoint sends.
 * `orderLink` turns an order id into this portal's order page; without it rows stay put.
 */
export interface TabProps {
  data: any;
  orderLink?: (id: number) => RowLinkTarget | null;
}

const orderCell = { key: "order_no", label: "Order", className: "whitespace-nowrap font-mono text-xs font-semibold text-primary" };
const linkOf = (orderLink: TabProps["orderLink"]) => (row: any) => (row.order_id && orderLink ? orderLink(row.order_id) : null);
const grid2 = "grid gap-4 lg:grid-cols-2";
const grid3 = "grid gap-4 lg:grid-cols-3";

// ---------------------------------------------------------------------------------------

export function OrdersTab({ data, orderLink }: TabProps) {
  const k = data.kpis;
  const link = linkOf(orderLink);
  const buckets: string[] = data.stage_buckets;
  return (
    <div className="space-y-4">
      <StatGrid
        items={[
          { label: "Orders created", value: fmt.n(k.created), hint: `${fmt.n(k.items)} lines · ${fmt.n(k.stores)} stores · ${fmt.n(k.total_sft)} sft` },
          { label: "Value created", value: fmt.inr(k.created_value), hint: `Average ${fmt.inr(k.avg_value)} an order`, accent: "success" },
          { label: "Closed in range", value: fmt.n(k.closed), hint: k.avg_cycle_days == null ? "None closed in the range" : `Average cycle ${fmt.days(k.avg_cycle_days)}, working days`, accent: "info" },
          { label: "Closure rate", value: fmt.pct(k.closure_rate), hint: "Of the orders created in the range", accent: "info" },
          { label: "Open right now", value: fmt.n(k.open), hint: `${fmt.inr(k.open_value)} in progress`, accent: "orange" },
          { label: "Allotted, waiting for CSM", value: fmt.n(k.waiting), hint: "No stores or items yet", accent: "warning" },
          { label: "Loss on these orders", value: fmt.inr(k.loss_value), hint: "Confirmed loss remarks", accent: "warning" },
          { label: "Net adjustments", value: fmt.signed(k.net_adjustment), hint: "Revised, Extra and Less Amount" },
        ]}
      />
      <div className={grid2}>
        <Panel title="Created and closed" description="Orders created, and orders closed, each month.">
          <TrendChart
            data={data.by_month}
            series={[
              { key: "created", label: "Created", color: COLORS.primary },
              { key: "closed", label: "Closed", color: COLORS.success },
            ]}
          />
        </Panel>
        <Panel title="Value created" description="Billable value of the orders created each month.">
          <TrendChart data={data.by_month} money series={[{ key: "value", label: "Value", color: COLORS.orange }]} />
        </Panel>
      </div>
      <Panel
        title="Open orders by stage"
        description="Right now, whatever the dates. Working days in the current stage; more than 5 counts as overdue."
      >
        <DataTable
          rows={data.stages}
          empty="No open orders."
          columns={[
            { key: "stage", label: "Stage", className: "font-medium" },
            { key: "count", label: "Orders", align: "right" },
            { key: "value", label: "Value", align: "right", render: (r) => fmt.inr(r.value) },
            ...buckets.map((b) => ({
              key: `b-${b}`,
              label: `${b} days`,
              align: "right" as const,
              render: (r: any) => r.buckets[b] || <span className="text-muted-foreground/60">0</span>,
            })),
            {
              key: "overdue",
              label: "Overdue",
              align: "right",
              render: (r) => (r.overdue ? <Pill tone="bad">{r.overdue}</Pill> : <span className="text-muted-foreground/60">0</span>),
            },
          ]}
        />
      </Panel>
      <Panel title="Stuck longest" description="Open orders that have sat in one stage the longest. Click a row to open it.">
        <DataTable
          rows={data.stuck}
          rowLink={link}
          empty="No open orders."
          columns={[
            orderCell,
            { key: "client_name", label: "Client" },
            { key: "creator_name", label: "CSM" },
            { key: "stage", label: "Stage" },
            { key: "days", label: "Working days", align: "right", render: (r) => <span className={r.days > 10 ? "font-semibold text-destructive" : r.days > 5 ? "font-semibold text-amber-600" : ""}>{r.days}</span> },
            { key: "value", label: "Value", align: "right", render: (r) => fmt.inr(r.value) },
          ]}
        />
      </Panel>
      <div className={grid3}>
        <Panel title="Top clients" description="By value of orders created.">
          <BarList
            rows={data.clients.map((c: any) => ({ label: c.client_name, value: c.value, sub: `${c.orders} orders · ${fmt.pct(c.share)}` }))}
            format={fmt.inr}
            color={COLORS.orange}
          />
        </Panel>
        <Panel title="Status of these orders" description="Where the orders created in the range are now.">
          <BarList rows={data.by_status.map((s: any) => ({ label: words(s.status), value: s.count, sub: fmt.inr(s.value) }))} />
        </Panel>
        <Panel title="Store locations" description="Stores on the orders created.">
          <BarList rows={data.locations.map((l: any) => ({ label: l.location, value: l.stores }))} color={COLORS.info} />
        </Panel>
      </div>
      <div className={grid2}>
        <Panel title="Media" description="Line items on the orders created, by media.">
          <DataTable
            rows={data.media}
            columns={[
              { key: "media", label: "Media", className: "font-medium" },
              { key: "lines", label: "Lines", align: "right" },
              { key: "sft", label: "Sft", align: "right", render: (r) => fmt.n(r.sft) },
              { key: "amount", label: "Amount", align: "right", render: (r) => fmt.inr(r.amount) },
            ]}
          />
        </Panel>
        <Panel title="Allotted, waiting for CSM" description="Open orders with no stores or items yet, oldest first.">
          <DataTable
            rows={data.waiting}
            rowLink={link}
            empty="Nothing is waiting."
            columns={[
              orderCell,
              { key: "client_name", label: "Client" },
              { key: "creator_name", label: "CSM" },
              { key: "days", label: "Days waiting", align: "right" },
            ]}
          />
        </Panel>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------

export function MoneyTab({ data, orderLink }: TabProps) {
  const k = data.kpis;
  const link = linkOf(orderLink);
  return (
    <div className="space-y-4">
      <StatGrid
        items={[
          { label: "Billed", value: fmt.inr(k.billed), hint: `${fmt.n(k.invoices_raised)} invoices raised in the range`, accent: "primary" },
          { label: "Received", value: fmt.inr(k.received), hint: `${fmt.n(k.payments)} payments in the range`, accent: "success" },
          { label: "Outstanding now", value: fmt.inr(k.outstanding), hint: `${fmt.n(k.outstanding_invoices)} invoices not fully paid`, accent: "orange" },
          { label: "Due 90+ days", value: fmt.inr(k.overdue_90), hint: "Billed over 90 days ago, still unpaid", accent: "warning" },
          { label: "Days to collect", value: fmt.days(k.avg_collection_days), hint: "Average, billing to payment", accent: "info" },
          { label: "Installed, not billed", value: fmt.inr(k.unbilled_value), hint: `${fmt.n(k.unbilled_stores)} stores ready to invoice`, accent: "warning" },
          { label: "Billed or paid short", value: fmt.inr(k.short_billed), hint: "Pending orders: value still to collect" },
          { label: "Paid out on requests", value: fmt.inr(k.paid_out), hint: "Payment requests paid in the range" },
        ]}
      />
      <div className={grid3}>
        <Panel title="Billed and received" description="Each month." className="lg:col-span-2">
          <TrendChart
            data={data.by_month}
            money
            series={[
              { key: "billed", label: "Billed", color: COLORS.primary },
              { key: "received", label: "Received", color: COLORS.success },
            ]}
          />
        </Panel>
        <Panel title="Outstanding by age" description="Days since the invoice was billed.">
          <BarList rows={data.aging.map((a: any) => ({ label: `${a.bucket} days`, value: a.due, sub: `${a.invoices} invoices` }))} format={fmt.inr} color={COLORS.orange} empty="Nothing outstanding." />
        </Panel>
      </div>
      <Panel title="Outstanding invoices" description="Biggest first. Orders an admin closed are left out (see Written off). Click a row to open the order.">
        <DataTable
          rows={data.outstanding}
          rowLink={link}
          empty="Nothing outstanding."
          columns={[
            orderCell,
            { key: "client_name", label: "Client" },
            { key: "creator_name", label: "CSM" },
            { key: "invoice_no", label: "Invoice" },
            { key: "billed_on", label: "Billed", render: (r) => fmt.date(r.billed_on) },
            { key: "days", label: "Days", align: "right", render: (r) => <span className={r.days > 90 ? "font-semibold text-destructive" : r.days > 60 ? "font-semibold text-amber-600" : ""}>{r.days}</span> },
            { key: "bill_amount", label: "Billed", align: "right", render: (r) => fmt.inr(r.bill_amount) },
            { key: "due", label: "Due", align: "right", render: (r) => <span className="font-semibold">{fmt.inr(r.due)}</span> },
            { key: "follow_ups", label: "Follow-ups", align: "right", render: (r) => (r.follow_ups ? `${r.follow_ups} · ${fmt.date(r.last_follow_up)}` : <Pill tone="warn">None</Pill>) },
          ]}
        />
      </Panel>
      <div className={grid2}>
        <Panel title="Clients who owe the most">
          <BarList rows={data.clients.map((c: any) => ({ label: c.client_name, value: c.due, sub: `${c.invoices} invoices` }))} format={fmt.inr} color={COLORS.orange} empty="Nothing outstanding." />
        </Panel>
        <Panel title="Loss and adjustments" description="Confirmed in the range. Loss is written off; adjustments change the bill.">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="mb-2 flex items-baseline justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Loss <span className="text-sm normal-case tracking-normal text-destructive">{fmt.inr(k.loss)}</span>
              </div>
              <BarList rows={data.loss_by_reason.map((l: any) => ({ label: remarkLabel(l.reason), value: l.amount }))} format={fmt.inr} color={COLORS.bad} empty="No loss." />
            </div>
            <div>
              <div className="mb-2 flex items-baseline justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Adjustments <span className="text-sm normal-case tracking-normal">{fmt.signed(k.net_adjustment)}</span>
              </div>
              <BarList rows={data.adjustments_by_type.map((a: any) => ({ label: remarkLabel(a.type), value: a.amount }))} format={fmt.signed} color={COLORS.info} empty="No adjustments." />
            </div>
          </div>
          {k.written_off > 0 && (
            <p className="mt-4 rounded-lg bg-warning/10 p-2.5 text-xs text-amber-700 dark:text-amber-400">
              Written off: {fmt.inr(k.written_off)} was still due on orders an admin closed by hand.
            </p>
          )}
        </Panel>
      </div>
      <div className={grid2}>
        <Panel title="Installed, not billed" description="Stores fitted with no invoice yet, oldest first.">
          <DataTable
            rows={data.unbilled}
            rowLink={link}
            empty="Every installed store is billed."
            columns={[
              orderCell,
              { key: "store_name", label: "Store" },
              { key: "days", label: "Days", align: "right" },
              { key: "value", label: "Value", align: "right", render: (r) => fmt.inr(r.value) },
            ]}
          />
        </Panel>
        <Panel title="Billed or paid short" description="Pending orders whose value is not all collected.">
          <DataTable
            rows={data.short_billed}
            rowLink={link}
            empty="No pending orders."
            columns={[
              orderCell,
              { key: "client_name", label: "Client" },
              { key: "expected", label: "Value", align: "right", render: (r) => fmt.inr(r.expected) },
              { key: "received", label: "Received", align: "right", render: (r) => fmt.inr(r.received) },
              { key: "gap", label: "Gap", align: "right", render: (r) => <span className="font-semibold text-destructive">{fmt.inr(r.gap)}</span> },
            ]}
          />
        </Panel>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------

export function CsmTab({ data }: TabProps) {
  const k = data.kpis;
  return (
    <div className="space-y-4">
      <StatGrid
        items={[
          { label: "People with orders", value: fmt.n(k.people) },
          { label: "Orders", value: fmt.n(k.orders), hint: "Created in the range" },
          { label: "Value", value: fmt.inr(k.value), accent: "success" },
          { label: "Overdue now", value: fmt.n(k.overdue_now), hint: `Open orders over ${data.overdue_days} working days in a stage`, accent: "warning" },
          { label: "Waiting for stores", value: fmt.n(k.waiting_now), hint: "Allotted orders not filled in", accent: "orange" },
          { label: "Outstanding", value: fmt.inr(k.outstanding), hint: "Unpaid on their orders, all time", accent: "info" },
        ]}
      />
      <Panel title="Value by CSM" description="Orders created in the range.">
        <BarList rows={data.rows.filter((r: any) => r.orders > 0).slice(0, 12).map((r: any) => ({ label: r.name, value: r.value, sub: `${r.orders} orders` }))} format={fmt.inr} color={COLORS.orange} />
      </Panel>
      <Panel
        title="CSM performance"
        description="Orders and money for orders each person created in the range; open, waiting, overdue and outstanding are as of now. Field jobs count where the person is the job's CSM or holds code 1 or code 2."
      >
        <DataTable
          rows={data.rows}
          limit={50}
          columns={[
            {
              key: "name",
              label: "Name",
              className: "whitespace-nowrap font-medium",
              render: (r) => (
                <span className="inline-flex items-center gap-1.5">
                  {r.name}
                  {r.role !== "CSM" && <Pill tone="info">{roleLabel(r.role)}</Pill>}
                  {!r.active && <Pill>Inactive</Pill>}
                </span>
              ),
            },
            { key: "orders", label: "Orders", align: "right" },
            { key: "value", label: "Value", align: "right", render: (r) => fmt.inr(r.value) },
            { key: "avg_value", label: "Average", align: "right", render: (r) => fmt.inr(r.avg_value) },
            { key: "closure_rate", label: "Closed", align: "right", render: (r) => `${r.closed} · ${fmt.pct(r.closure_rate)}` },
            { key: "avg_cycle_days", label: "Cycle", align: "right", render: (r) => fmt.days(r.avg_cycle_days) },
            { key: "loss_pct", label: "Loss", align: "right", render: (r) => (r.loss ? <span title={fmt.inr(r.loss)} className="text-destructive">{fmt.pct(r.loss_pct)}</span> : "—") },
            { key: "net_adjustment", label: "Adjusted", align: "right", render: (r) => (r.net_adjustment ? fmt.signed(r.net_adjustment) : "—") },
            { key: "open_now", label: "Open", align: "right" },
            { key: "waiting_now", label: "Waiting", align: "right", render: (r) => (r.waiting_now ? <Pill tone="warn">{r.waiting_now}</Pill> : 0) },
            { key: "overdue_now", label: "Overdue", align: "right", render: (r) => (r.overdue_now ? <Pill tone="bad">{r.overdue_now}</Pill> : 0) },
            { key: "outstanding", label: "Outstanding", align: "right", render: (r) => fmt.inr(r.outstanding) },
            { key: "jobs", label: "Field jobs", align: "right", render: (r) => (r.jobs ? `${r.jobs_completed}/${r.jobs} done` : "—") },
            { key: "paid", label: "Requests paid", align: "right", render: (r) => (r.requests ? `${fmt.inr(r.paid)} (${r.requests})` : "—") },
          ]}
        />
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------------------

export function ProductionTab({ data, orderLink }: TabProps) {
  const k = data.kpis;
  const link = linkOf(orderLink);
  return (
    <div className="space-y-4">
      <StatGrid
        items={[
          { label: "Items assigned", value: fmt.n(k.assigned), hint: "Given to a production person in the range" },
          { label: "Items finished", value: fmt.n(k.completed), hint: `${fmt.n(k.sft)} sft`, accent: "success" },
          { label: "Days to finish", value: fmt.days(k.avg_days), hint: "Average working days, assigned to done", accent: "info" },
          { label: "Open assignments", value: fmt.n(k.open_now), hint: "Right now", accent: "orange" },
          { label: "On hold", value: fmt.n(k.on_hold), hint: "Flagged items on open orders", accent: "warning" },
          { label: "Not assigned yet", value: fmt.n(k.unassigned_items), hint: `${fmt.n(k.unassigned_sft)} sft on active orders`, accent: "warning" },
        ]}
      />
      <Panel title="Assigned and finished" description="Items each month.">
        <TrendChart
          data={data.by_month}
          series={[
            { key: "assigned", label: "Assigned", color: COLORS.primary },
            { key: "completed", label: "Finished", color: COLORS.success },
          ]}
        />
      </Panel>
      <Panel title="People" description="Production work by person.">
        <DataTable
          rows={data.people}
          limit={25}
          empty="No production work in this range."
          columns={[
            { key: "name", label: "Name", className: "font-medium" },
            { key: "role", label: "Role", render: (r) => roleLabel(r.role) },
            { key: "assigned", label: "Assigned", align: "right" },
            { key: "completed", label: "Finished", align: "right" },
            { key: "sft", label: "Sft", align: "right", render: (r) => fmt.n(r.sft) },
            { key: "avg_days", label: "Average days", align: "right", render: (r) => fmt.days(r.avg_days) },
            { key: "open_now", label: "Open now", align: "right" },
          ]}
        />
      </Panel>
      <div className={grid2}>
        <Panel title="On hold" description="Flagged items still waiting, oldest first.">
          <DataTable
            rows={data.holds}
            rowLink={link}
            empty="Nothing on hold."
            columns={[
              orderCell,
              { key: "media", label: "Media" },
              { key: "reason", label: "Reason", render: (r) => <span className="line-clamp-2 max-w-[220px]" title={r.reason ?? ""}>{r.reason || "—"}</span> },
              { key: "days", label: "Days", align: "right", render: (r) => fmt.n(r.days) },
            ]}
          />
        </Panel>
        <Panel title="Not assigned yet" description="Active orders with items nobody is making, oldest first.">
          <DataTable
            rows={data.unassigned}
            rowLink={link}
            empty="Every item is assigned."
            columns={[
              orderCell,
              { key: "client_name", label: "Client" },
              { key: "items", label: "Items", align: "right" },
              { key: "sft", label: "Sft", align: "right", render: (r) => fmt.n(r.sft) },
              { key: "days", label: "Days", align: "right" },
            ]}
          />
        </Panel>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------

const LOCALITY: Record<string, string> = { LOCAL: "Hyderabad", NON_LOCAL: "Outside Hyderabad", UNSET: "Not set" };
const ISSUE_TONE: Record<string, "bad" | "warn" | "info" | "muted"> = {
  Cancelled: "muted",
  "On hold": "warn",
  "No order linked": "info",
  "Nobody on it": "bad",
  "Not started": "bad",
  "Local or not unset": "info",
};

export function AllocationTab({ data, orderLink }: TabProps) {
  const k = data.kpis;
  const link = linkOf(orderLink);
  return (
    <div className="space-y-4">
      <StatGrid
        items={[
          { label: "Field jobs", value: fmt.n(k.jobs), hint: `${fmt.n(k.live_jobs)} not cancelled` },
          { label: "Completed", value: fmt.n(k.completed), hint: `${fmt.n(k.on_hold)} on hold · ${fmt.n(k.cancelled)} cancelled`, accent: "success" },
          { label: "Job-days", value: fmt.n(k.job_days), hint: `${fmt.n(k.person_days)} person-days booked`, accent: "info" },
          { label: "Utilisation", value: fmt.pct(k.avg_utilisation), hint: `Average over ${fmt.n(k.staff)} field staff, ${k.working_days} working days`, accent: "orange" },
          { label: "Approved leave", value: fmt.days(k.leave_days), hint: "Days inside the range" },
          { label: "Overtime", value: fmt.hours(k.ot_hours), hint: `${fmt.hours(k.ot_pending_hours)} still to decide`, accent: "warning" },
          { label: "Needs attention", value: fmt.n(k.attention), hint: "Jobs listed below", accent: "warning" },
        ]}
      />
      <Panel title={data.timeline.daily ? "Each day" : "Each month"} description="Jobs running, and people booked on them (cancelled jobs left out).">
        <TrendChart
          data={data.timeline.rows}
          series={[
            { key: "jobs", label: data.timeline.daily ? "Jobs" : "Job-days", color: COLORS.primary },
            { key: "people", label: data.timeline.daily ? "People" : "Person-days", color: COLORS.orange },
          ]}
        />
      </Panel>
      <div className={grid3}>
        <Panel title="Hyderabad or outside" description="Job-days.">
          <BarList rows={data.locality.map((l: any) => ({ label: LOCALITY[l.locality] ?? l.locality, value: l.days, sub: `${l.jobs} jobs` }))} color={COLORS.info} />
        </Panel>
        <Panel title="Busiest areas" description="Job-days.">
          <BarList rows={data.areas.map((a: any) => ({ label: a.area, value: a.days, sub: `${a.jobs} jobs` }))} />
        </Panel>
        <Panel title="Outside Hyderabad, by district" description="Job-days.">
          <BarList rows={data.districts.map((d: any) => ({ label: d.district, value: d.days, sub: `${d.jobs} jobs` }))} color={COLORS.orange} empty="No work outside Hyderabad." />
        </Panel>
      </div>
      <Panel
        title="Field staff"
        description="Days on jobs against working days (Monday to Saturday) less approved leave. Idle days are working days with no job."
      >
        <DataTable
          rows={data.staff}
          limit={25}
          empty="No field staff."
          columns={[
            {
              key: "name",
              label: "Name",
              className: "whitespace-nowrap font-medium",
              render: (r) => (
                <span className="inline-flex items-center gap-1.5">
                  {r.name}
                  {!r.active && <Pill>Inactive</Pill>}
                </span>
              ),
            },
            { key: "role", label: "Role", render: (r) => roleLabel(r.role) },
            { key: "jobs", label: "Jobs", align: "right" },
            { key: "job_days", label: "Days on jobs", align: "right" },
            { key: "leave_days", label: "Leave", align: "right" },
            { key: "idle_days", label: "Idle", align: "right", render: (r) => r.idle_days },
            {
              key: "utilisation",
              label: "Used",
              align: "right",
              render: (r) =>
                r.utilisation == null ? "—" : (
                  <span className="inline-flex items-center gap-2">
                    <span className="hidden h-1.5 w-12 overflow-hidden rounded-full bg-muted sm:inline-block">
                      <span className="block h-full rounded-full bg-primary" style={{ width: `${r.utilisation}%` }} />
                    </span>
                    {r.utilisation}%
                  </span>
                ),
            },
            { key: "ot_hours", label: "Overtime", align: "right", render: (r) => (r.ot_hours || r.ot_pending_hours ? `${r.ot_hours} h${r.ot_pending_hours ? ` (+${r.ot_pending_hours} waiting)` : ""}` : "—") },
            { key: "paid", label: "Paid on requests", align: "right", render: (r) => (r.paid ? fmt.inr(r.paid) : "—") },
          ]}
        />
      </Panel>
      <Panel title="Jobs that need attention" description="Cancelled, on hold, no order linked, nobody on it, past their start and not started, or Hyderabad/outside not set.">
        <DataTable
          rows={data.attention.map((a: any, i: number) => ({ ...a, key: `${a.job_id}-${a.issue}-${i}` }))}
          rowLink={link}
          empty="Nothing needs attention."
          columns={[
            { key: "issue", label: "Issue", render: (r) => <Pill tone={ISSUE_TONE[r.issue] ?? "muted"}>{r.issue}</Pill> },
            orderCell,
            { key: "client_name", label: "Client" },
            { key: "csm", label: "CSM" },
            { key: "area", label: "Area" },
            { key: "start_date", label: "Dates", className: "whitespace-nowrap", render: (r) => (r.start_date === r.end_date ? r.start_date : `${r.start_date} – ${r.end_date}`) },
            { key: "note", label: "Note", render: (r) => <span className="line-clamp-2 max-w-[220px]" title={r.note}>{r.note || "—"}</span> },
          ]}
        />
      </Panel>
      <div className={grid3}>
        <Panel title="Vehicles" description="Days on jobs.">
          <BarList rows={data.vehicles.map((v: any) => ({ label: v.reg_no, value: v.days, sub: `${v.type} · ${v.jobs} jobs` }))} color={COLORS.info} empty="No vehicles used." />
        </Panel>
        <Panel title="CSM codes" description="Jobs by code 1 or code 2.">
          <BarList rows={data.codes.map((c: any) => ({ label: c.code, value: c.jobs, sub: `${c.days} days` }))} />
        </Panel>
        <Panel title="Leave and overtime" description="Records inside the range.">
          <div className="space-y-4">
            <BarList rows={data.leave.map((l: any) => ({ label: `Leave · ${words(l.status)}`, value: l.days, sub: `${l.records} records` }))} format={(v) => fmt.days(v)} empty="No leave." />
            <BarList rows={data.overtime.map((o: any) => ({ label: `Overtime · ${words(o.status)}`, value: o.hours, sub: `${o.entries} entries` }))} format={(v) => fmt.hours(v)} color={COLORS.orange} empty="No overtime." />
          </div>
        </Panel>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------

const ROUTE: Record<string, string> = { ADMIN_THEN_CCM: "Admin, then Cost Control", CCM_ONLY: "Cost Control only" };

export function PaymentsTab({ data, orderLink }: TabProps) {
  const k = data.kpis;
  const link = linkOf(orderLink);
  return (
    <div className="space-y-4">
      <StatGrid
        items={[
          { label: "Requests raised", value: fmt.n(k.requests), hint: `${fmt.inr(k.requested)} asked for` },
          { label: "Paid", value: fmt.inr(k.paid), hint: `${fmt.n(k.paid_count)} requests paid in the range`, accent: "success" },
          { label: "Open now", value: fmt.n(k.open), hint: `${fmt.inr(k.open_amount)} waiting`, accent: "orange" },
          { label: "Days to pay", value: fmt.days(k.avg_days_to_pay), hint: "Average, raised to paid", accent: "info" },
          { label: "Stuck over 7 days", value: fmt.n(k.stuck_7), hint: "Open, and in the same step that long", accent: "warning" },
          { label: "Rejected or cancelled", value: fmt.n(k.rejected + k.cancelled), hint: `${k.rejected} rejected · ${k.cancelled} cancelled` },
        ]}
      />
      <Panel title="Requested and paid" description="Each month.">
        <TrendChart
          data={data.by_month}
          money
          series={[
            { key: "requested", label: "Requested", color: COLORS.primary },
            { key: "paid", label: "Paid", color: COLORS.success },
          ]}
        />
      </Panel>
      <div className={grid3}>
        <Panel title="By status" description="Requests raised in the range, where they are now.">
          <BarList rows={data.by_status.map((s: any) => ({ label: words(s.key), value: s.amount, sub: `${s.count}` }))} format={fmt.inr} />
        </Panel>
        <Panel title="By category">
          <BarList rows={data.by_category.map((s: any) => ({ label: s.key === "UNSET" ? "Not set" : words(s.key), value: s.amount, sub: `${s.count}` }))} format={fmt.inr} color={COLORS.orange} />
        </Panel>
        <Panel title="By route" description="Fixed by whether bill details were given.">
          <BarList rows={data.by_route.map((s: any) => ({ label: ROUTE[s.key] ?? words(s.key), value: s.amount, sub: `${s.count}` }))} format={fmt.inr} color={COLORS.info} />
        </Panel>
      </div>
      <Panel title="Open requests" description="Longest in their current step first. Click a row to open the order.">
        <DataTable
          rows={data.open}
          rowLink={link}
          empty="No open requests."
          columns={[
            orderCell,
            { key: "requester", label: "Requested by" },
            { key: "category", label: "Category", render: (r) => words(r.category) },
            { key: "status", label: "Step", render: (r) => <Pill tone={r.status === "INFO_REQUESTED" ? "warn" : "info"}>{words(r.status)}</Pill> },
            { key: "days", label: "Days", align: "right", render: (r) => <span className={r.days > 7 ? "font-semibold text-destructive" : ""}>{r.days}</span> },
            { key: "amount", label: "Amount", align: "right", render: (r) => fmt.inr(r.amount) },
          ]}
        />
      </Panel>
      <div className={grid2}>
        <Panel title="People" description="Raised in the range, and paid in the range.">
          <DataTable
            rows={data.people}
            columns={[
              { key: "name", label: "Name", className: "font-medium" },
              { key: "role", label: "Role", render: (r) => roleLabel(r.role) },
              { key: "requests", label: "Raised", align: "right" },
              { key: "requested", label: "Asked", align: "right", render: (r) => fmt.inr(r.requested) },
              { key: "paid", label: "Paid", align: "right", render: (r) => fmt.inr(r.paid) },
            ]}
          />
        </Panel>
        <Panel title="Orders that cost the most" description="Paid in the range, against the order's value.">
          <DataTable
            rows={data.orders}
            rowLink={link}
            columns={[
              orderCell,
              { key: "client_name", label: "Client" },
              { key: "paid", label: "Paid", align: "right", render: (r) => fmt.inr(r.paid) },
              { key: "order_value", label: "Order value", align: "right", render: (r) => fmt.inr(r.order_value) },
              { key: "cost_pct", label: "Cost", align: "right", render: (r) => (r.cost_pct != null && r.cost_pct > 20 ? <Pill tone="bad">{r.cost_pct}%</Pill> : fmt.pct(r.cost_pct)) },
            ]}
          />
        </Panel>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------

export function MastersTab({ data }: TabProps) {
  const k = data.kpis;
  const yes = (b: boolean) => (b ? "Yes" : <Pill>Archived</Pill>);
  return (
    <div className="space-y-4">
      <StatGrid
        items={[
          { label: "Clients", value: fmt.n(k.clients), hint: `${k.clients_archived} archived · ${k.clients_no_code} with no code` },
          { label: "Media", value: fmt.n(k.media), hint: `${k.media_unused} never used`, accent: "info" },
          { label: "Locations", value: fmt.n(k.locations), hint: `${k.locations_unconfirmed} to confirm · ${k.locations_unused} never used`, accent: "orange" },
          { label: "Name requests waiting", value: fmt.n(k.requests_pending), hint: "From CSMs", accent: "warning" },
          { label: "Not in the library", value: fmt.n(k.strays), hint: "Names on orders the library lacks", accent: "warning" },
          { label: "Clients never used", value: fmt.n(k.clients_unused), hint: "Active, with no order" },
          { label: "CSM codes to sort out", value: fmt.n(k.codes_unknown + k.codes_unlinked), hint: `${k.codes_unknown} unknown kind · ${k.codes_unlinked} CSM codes with no person` },
        ]}
      />
      <div className={grid2}>
        <Panel title="Name requests waiting" description="Oldest first. Decide them in the Master Library.">
          <DataTable
            rows={data.requests}
            empty="No requests waiting."
            columns={[
              { key: "kind", label: "Kind", render: (r) => words(r.kind) },
              { key: "name", label: "Name", className: "font-medium" },
              { key: "requester", label: "Asked by" },
              { key: "days", label: "Days", align: "right" },
            ]}
          />
        </Panel>
        <Panel title="Used on orders, not in the library" description="Old names, or typed before the library. Merge or add them.">
          <DataTable
            rows={data.strays.map((s: any) => ({ ...s, key: `${s.kind}-${s.name}` }))}
            empty="Every name on an order is in the library."
            columns={[
              { key: "kind", label: "Kind" },
              { key: "name", label: "Name", className: "font-medium" },
              { key: "uses", label: "Uses", align: "right" },
            ]}
          />
        </Panel>
      </div>
      <Panel title="Clients" description="Most used first. Orders in range counts the dates you picked.">
        <DataTable
          rows={data.clients}
          limit={15}
          columns={[
            { key: "name", label: "Client", className: "font-medium" },
            { key: "code", label: "Code", render: (r) => r.code || <Pill tone="warn">No code</Pill> },
            { key: "active", label: "Active", render: (r) => yes(r.active) },
            { key: "orders", label: "Orders", align: "right" },
            { key: "in_range", label: "In range", align: "right" },
            { key: "last_used", label: "Last order", align: "right", render: (r) => fmt.date(r.last_used) },
          ]}
        />
      </Panel>
      <div className={grid2}>
        <Panel title="Media">
          <DataTable
            rows={data.media}
            limit={15}
            columns={[
              { key: "name", label: "Media", className: "font-medium" },
              { key: "active", label: "Active", render: (r) => yes(r.active) },
              { key: "lines", label: "Lines", align: "right" },
              { key: "sft", label: "Sft", align: "right", render: (r) => fmt.n(r.sft) },
            ]}
          />
        </Panel>
        <Panel title="Locations" description="Store locations and field-job areas.">
          <DataTable
            rows={data.locations}
            limit={15}
            columns={[
              {
                key: "name",
                label: "Location",
                className: "font-medium",
                render: (r) => (
                  <span className="inline-flex items-center gap-1.5">
                    {r.name}
                    {r.needs_confirmation && <Pill tone="warn">Confirm</Pill>}
                  </span>
                ),
              },
              { key: "locality", label: "Where", render: (r) => LOCALITY[r.locality] ?? r.locality },
              { key: "stores", label: "Stores", align: "right" },
              { key: "jobs", label: "Jobs", align: "right" },
            ]}
          />
        </Panel>
      </div>
      <div className={grid2}>
        <Panel title="CSM codes">
          <DataTable
            rows={data.codes}
            limit={15}
            columns={[
              { key: "code", label: "Code", className: "font-mono text-xs font-semibold" },
              { key: "kind", label: "Kind", render: (r) => (r.kind === "UNKNOWN" ? <Pill tone="warn">Unknown</Pill> : words(r.kind)) },
              { key: "user", label: "Person", render: (r) => r.user ?? r.label ?? (r.kind === "CSM" ? <Pill tone="bad">Nobody</Pill> : "—") },
              { key: "jobs", label: "Jobs", align: "right" },
            ]}
          />
        </Panel>
        <Panel title="Vehicles">
          <DataTable
            rows={data.vehicles.map((v: any) => ({ ...v, key: v.reg_no }))}
            columns={[
              { key: "reg_no", label: "Vehicle", className: "font-medium" },
              { key: "type", label: "Type" },
              { key: "active", label: "Active", render: (r) => yes(r.active) },
              { key: "jobs", label: "Jobs", align: "right" },
            ]}
          />
        </Panel>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------

export function SystemTab({ data }: TabProps) {
  const k = data.kpis;
  const staleCols: Column<any>[] = [
    { key: "name", label: "Name", className: "font-medium" },
    { key: "role", label: "Role", render: (r) => roleLabel(r.role) },
    { key: "last_login_at", label: "Last login", align: "right", render: (r) => (r.last_login_at ? fmt.date(r.last_login_at) : <Pill tone="warn">Never</Pill>) },
  ];
  return (
    <div className="space-y-4">
      <StatGrid
        items={[
          { label: "WhatsApp messages", value: fmt.n(k.whatsapp), hint: `${fmt.n(k.whatsapp_read)} read` },
          { label: "Delivered", value: fmt.pct(k.whatsapp_delivery_rate), hint: `${fmt.n(k.whatsapp_delivered)} of those sent`, accent: "success" },
          { label: "WhatsApp failed", value: fmt.n(k.whatsapp_failed), hint: `${fmt.n(k.whatsapp_skipped)} skipped (no number or opted out)`, accent: "warning" },
          { label: "Active users", value: fmt.n(k.users), hint: `${fmt.n(k.opted_out)} opted out of WhatsApp`, accent: "info" },
          { label: `No login for ${data.stale_days}+ days`, value: fmt.n(k.stale), hint: `${fmt.n(k.never_logged_in)} never logged in`, accent: "orange" },
          { label: "No phone number", value: fmt.n(k.no_phone), hint: "They get no WhatsApp", accent: "warning" },
          { label: "Recorded changes", value: fmt.n(k.changes), hint: "Audit log rows in the range" },
        ]}
      />
      <div className={grid3}>
        <Panel title="WhatsApp by status">
          <BarList rows={data.whatsapp.map((w: any) => ({ label: words(w.status), value: w.count }))} color={COLORS.success} empty="No messages." />
        </Panel>
        <Panel title="WhatsApp problems by event">
          <BarList rows={data.problem_events.map((e: any) => ({ label: e.event, value: e.count }))} color={COLORS.bad} empty="No problems." />
        </Panel>
        <Panel title="Active users by role">
          <BarList rows={data.roles.map((r: any) => ({ label: roleLabel(r.role), value: r.count }))} color={COLORS.info} />
        </Panel>
      </div>
      <Panel title="Latest WhatsApp problems">
        <DataTable
          rows={data.problems.map((p: any, i: number) => ({ ...p, key: i }))}
          empty="No problems."
          columns={[
            { key: "at", label: "When", className: "whitespace-nowrap", render: (r) => fmt.date(r.at) },
            { key: "event", label: "Event", className: "font-mono text-xs" },
            { key: "status", label: "Status", render: (r) => <Pill tone={r.status === "FAILED" ? "bad" : "warn"}>{words(r.status)}</Pill> },
            { key: "user", label: "Person" },
            { key: "error", label: "Error", render: (r) => <span className="line-clamp-2 max-w-[320px]" title={r.error ?? ""}>{r.error || "—"}</span> },
          ]}
        />
      </Panel>
      <div className={grid3}>
        <Panel title="Not logging in" className="lg:col-span-1">
          <DataTable rows={data.stale} columns={staleCols} empty="Everyone has logged in lately." />
        </Panel>
        <Panel title="No phone number">
          <DataTable
            rows={data.no_phone}
            empty="Everyone has a number."
            columns={[
              { key: "name", label: "Name", className: "font-medium" },
              { key: "role", label: "Role", render: (r) => roleLabel(r.role) },
            ]}
          />
        </Panel>
        <Panel title="Changes by table" description="From the audit log.">
          <BarList rows={data.changes.map((c: any) => ({ label: c.table, value: c.count }))} empty="No changes." />
        </Panel>
      </div>
    </div>
  );
}

