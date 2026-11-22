import { BarList, COLORS, DataTable, Panel, Pill, StatGrid, TrendChart, fmt, words } from "./parts";
import type { TabProps } from "./tabs";

/**
 * Report tabs added with the Nov 17 change list: Printing (line by line), Turnover (raised,
 * billed and received) and Delay (days in each stage against the limits in Settings).
 */

const linkOf = (orderLink: TabProps["orderLink"]) => (row: any) => (row.order_id && orderLink ? orderLink(row.order_id) : null);
const when = (v: string | null) =>
  v ? new Date(v).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "—";

export function PrintingTab({ data, orderLink }: TabProps) {
  const t = data.totals;
  const rows = (data.rows as any[]).map((r) => ({ ...r, key: r.line_id }));
  return (
    <div className="space-y-4">
      <StatGrid
        items={[
          { label: "Lines", value: fmt.n(t.lines), hint: "Started or finished in the range" },
          { label: "Finished", value: fmt.n(t.completed), accent: "success" },
          { label: "SFT", value: fmt.n(t.sft), accent: "info" },
          { label: "Operators", value: fmt.n(data.by_operator.length), accent: "orange" },
        ]}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="SFT by operator">
          <BarList rows={data.by_operator.slice(0, 12).map((o: any) => ({ label: o.operator, value: o.sft, sub: `${o.lines} lines` }))} color={COLORS.orange} />
        </Panel>
        <Panel title="SFT by machine">
          <BarList rows={data.by_machine.map((m: any) => ({ label: m.machine, value: m.sft, sub: `${m.lines} lines` }))} />
        </Panel>
      </div>
      <Panel
        title="Printing"
        description={data.row_count > rows.length ? `First ${rows.length} of ${data.row_count} lines; the Excel file has all.` : "Every line started or finished in the range."}
      >
        <DataTable
          rows={rows}
          limit={50}
          rowLink={linkOf(orderLink)}
          columns={[
            { key: "date", label: "Date", className: "whitespace-nowrap", render: (r) => fmt.date(r.date) },
            { key: "order_no", label: "Order", className: "whitespace-nowrap font-mono text-xs font-semibold text-primary" },
            { key: "csm", label: "CSM", className: "whitespace-nowrap" },
            { key: "client", label: "Client" },
            { key: "store", label: "Store" },
            { key: "line_item", label: "Line item" },
            { key: "machine", label: "Machine", render: (r) => r.machine ?? "—" },
            { key: "size", label: "Size", className: "whitespace-nowrap" },
            { key: "qty", label: "Qty", align: "right" },
            { key: "sft", label: "SFT", align: "right" },
            { key: "operators", label: "Operator", render: (r) => r.operators || "—" },
            { key: "started", label: "Started", className: "whitespace-nowrap", render: (r) => when(r.started) },
            { key: "completed", label: "Completed", className: "whitespace-nowrap", render: (r) => (r.done ? when(r.completed) : <Pill tone="warn">In progress</Pill>) },
          ]}
        />
      </Panel>
    </div>
  );
}

export function TurnoverTab({ data }: TabProps) {
  const t = data.totals;
  return (
    <div className="space-y-4">
      <StatGrid
        items={[
          { label: "Orders raised", value: fmt.n(t.orders) },
          { label: "Order value", value: fmt.inr(t.raised), accent: "info" },
          { label: "Billed", value: fmt.inr(t.billed), accent: "orange" },
          { label: "Received", value: fmt.inr(t.received), accent: "success" },
        ]}
      />
      <Panel title="By month" description="Order value by order date, billed by invoice date, received by payment date.">
        <TrendChart
          data={data.by_month}
          money
          series={[
            { key: "raised", label: "Order value", color: COLORS.info },
            { key: "billed", label: "Billed", color: COLORS.orange },
            { key: "received", label: "Received", color: COLORS.success },
          ]}
        />
      </Panel>
      <Panel title="CSM business" description="Orders and money for orders each person raised.">
        <DataTable
          rows={(data.by_csm as any[]).map((c) => ({ ...c, key: c.csm }))}
          limit={50}
          columns={[
            { key: "csm", label: "CSM", className: "whitespace-nowrap font-medium" },
            { key: "orders", label: "Orders", align: "right" },
            { key: "raised", label: "Order value", align: "right", render: (r) => fmt.inr(r.raised) },
            { key: "billed", label: "Billed", align: "right", render: (r) => fmt.inr(r.billed) },
            { key: "received", label: "Received", align: "right", render: (r) => fmt.inr(r.received) },
          ]}
        />
      </Panel>
    </div>
  );
}

const STAGE_LABEL: Record<string, string> = { production: "Production", installation: "Installation", invoice: "Invoice", payment: "Payment" };

export function DelayTab({ data, orderLink }: TabProps) {
  const stageCell = (stage: string) => ({
    key: stage,
    label: STAGE_LABEL[stage]!,
    align: "right" as const,
    render: (r: any) => {
      const s = r.stages[stage];
      if (!s) return <span className="text-muted-foreground">—</span>;
      const late = r.late.includes(stage);
      return (
        <span className={late ? "font-semibold text-destructive" : s.open ? "text-warning" : undefined} title={s.open ? "Still in this stage" : undefined}>
          {s.days}
          {s.open ? "…" : ""}
        </span>
      );
    },
  });
  return (
    <div className="space-y-4">
      <StatGrid
        items={[
          ...data.summary.map((s: any) => ({
            label: `${s.label} (limit ${s.limit} d)`,
            value: s.average_days == null ? "—" : `${s.average_days} d avg`,
            hint: `${s.over_limit} over limit · ${s.open_now} in it now`,
            accent: s.over_limit > 0 ? ("warning" as const) : ("success" as const),
          })),
        ]}
      />
      <Panel
        title="Orders by delay"
        description={`${data.late_orders} of ${data.row_count} orders raised in the range went over a stage limit. Red is over the limit; "…" means still in that stage. Limits are in Settings.`}
      >
        <DataTable
          rows={(data.rows as any[]).map((r) => ({ ...r, key: r.order_id }))}
          limit={50}
          rowLink={linkOf(orderLink)}
          columns={[
            { key: "order_no", label: "Order", className: "whitespace-nowrap font-mono text-xs font-semibold text-primary" },
            { key: "date", label: "Date", className: "whitespace-nowrap", render: (r) => fmt.date(r.date) },
            { key: "client", label: "Client" },
            { key: "csm", label: "CSM", className: "whitespace-nowrap" },
            { key: "status", label: "Status", render: (r) => words(r.status) },
            stageCell("production"),
            stageCell("installation"),
            stageCell("invoice"),
            stageCell("payment"),
            { key: "total_days", label: "Total", align: "right", render: (r) => fmt.days(r.total_days) },
          ]}
        />
      </Panel>
    </div>
  );
}
