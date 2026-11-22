import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "@/components/layout/PageStates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/api/client";
import { useAuth } from "@/lib/auth-store";
import { friendlyError } from "@/lib/friendly-error";
import { inr } from "@/lib/format";
import { cn } from "@/lib/utils";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const Route = createFileRoute("/_portal/day-sheet")({
  head: () => ({ meta: [{ title: "Day Sheet — SB OMS" }] }),
  validateSearch: (s: Record<string, unknown>): { day?: string; user?: number } => ({
    day: typeof s.day === "string" && DAY_RE.test(s.day) ? s.day : undefined,
    user: Number.isInteger(Number(s.user)) && Number(s.user) > 0 ? Number(s.user) : undefined,
  }),
  component: DaySheetPage,
});

const ACTIVITIES = ["Follow-up", "Visit", "Call", "Meeting", "Note", "Other"] as const;
const FIELD = new Set(["PASTER", "HELPER", "DRIVER"]);
const VIEW_ALL = new Set(["ADMIN", "OPERATION_MANAGER"]);

interface Entry {
  id: number;
  activity: string;
  client_name: string | null;
  note: string;
  time: string | null;
}
interface Sheet {
  day: string;
  person: { id: number; name: string; role: string };
  entries: Entry[];
  orders: { id: number; order_no: string; client_name: string; status: string; value: number; what: string }[];
  jobs: { id: number; status: string; order_id: number | null; order_no: string | null; client_name: string | null; area: string | null; work_details: string | null; completion_note: string | null }[];
  can_edit: boolean;
}

const IST_MS = 330 * 60_000;
const todayIst = () => new Date(Date.now() + IST_MS).toISOString().slice(0, 10);
const shift = (day: string, n: number) => new Date(new Date(`${day}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const longDay = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/**
 * One person's day. A CSM's sheet lists the orders they raised or changed by itself, and
 * they add their other work (follow-ups, visits, calls). A paster's lists the jobs they were
 * on, with a note of the work done. Admin and OM pick anyone.
 */
function DaySheetPage() {
  const { user } = useAuth();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const day = search.day ?? todayIst();
  const viewAll = VIEW_ALL.has(user?.role ?? "");
  const who = viewAll ? search.user : undefined;
  const set = (next: { day?: string; user?: number }) => navigate({ search: { ...search, ...next }, replace: true });

  const people = useQuery({
    queryKey: ["day-sheets", "people", day],
    queryFn: () => apiFetch<{ people: { id: number; name: string; role: string; entries: number }[] }>(`/day-sheets/people?day=${day}`),
    enabled: viewAll,
  });
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["day-sheets", who ?? "me", day],
    queryFn: () => apiFetch<Sheet>(`/day-sheets?day=${day}${who ? `&user=${who}` : ""}`),
  });

  return (
    <>
      <PageHeader
        title={viewAll ? "Day Sheets" : "My Day Sheet"}
        description={viewAll ? "What each person did on a day: their orders or jobs, and the rows they wrote." : "What you did today. Orders and jobs show by themselves; add the rest."}
        crumbs={[{ label: "Day Sheet" }]}
      />
      <div className="surface-panel mb-4 flex flex-col gap-3 p-3 sm:flex-row sm:items-end">
        <div className="flex items-end gap-1">
          <Button variant="outline" size="icon" aria-label="Day before" onClick={() => set({ day: shift(day, -1) })}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <label className="grid gap-1">
            <span className="text-xs font-semibold text-muted-foreground">Day</span>
            <Input type="date" value={day} max={todayIst()} onChange={(e) => DAY_RE.test(e.target.value) && set({ day: e.target.value })} className="w-40" />
          </label>
          <Button variant="outline" size="icon" aria-label="Next day" disabled={day >= todayIst()} onClick={() => set({ day: shift(day, 1) })}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          {day !== todayIst() && (
            <Button variant="ghost" onClick={() => set({ day: undefined })}>
              Today
            </Button>
          )}
        </div>
        {viewAll && (
          <label className="grid gap-1 sm:w-72">
            <span className="text-xs font-semibold text-muted-foreground">Person</span>
            <Select value={who ? String(who) : "me"} onValueChange={(v) => set({ user: v === "me" ? undefined : Number(v) })}>
              <SelectTrigger aria-label="Person"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="me">Me</SelectItem>
                {(people.data?.people ?? []).map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name} · {p.role === "PRODUCTION" ? "Operator" : p.role.charAt(0) + p.role.slice(1).toLowerCase()}
                    {p.entries ? ` (${p.entries})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        )}
        <p className="text-sm text-muted-foreground sm:ml-auto">{longDay(day)}</p>
      </div>

      {isLoading ? (
        <LoadingState />
      ) : error || !data ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <SheetBody sheet={data} orderBase={user?.role === "CSM" ? "/employee/orders/$id" : "/admin/orders/$id"} />
      )}
    </>
  );
}

function SheetBody({ sheet, orderBase }: { sheet: Sheet; orderBase: "/employee/orders/$id" | "/admin/orders/$id" }) {
  const isField = FIELD.has(sheet.person.role);
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
      <section className="surface-panel p-4 sm:p-5">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          {isField ? "Jobs that day" : "Orders that day"}
          <span className="rounded-full bg-muted px-2 text-xs font-medium tabular-nums text-muted-foreground">
            {isField ? sheet.jobs.length : sheet.orders.length}
          </span>
        </h2>
        {isField ? (
          sheet.jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No jobs booked.</p>
          ) : (
            <ul className="divide-y text-sm">
              {sheet.jobs.map((j) => (
                <li key={j.id} className="py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-primary">{j.order_no ?? `Job ${j.id}`}</span>
                    <span className="text-xs text-muted-foreground">{j.status.charAt(0) + j.status.slice(1).toLowerCase().replace(/_/g, " ")}</span>
                  </div>
                  <div>{[j.client_name, j.area].filter(Boolean).join(" · ") || "—"}</div>
                  {(j.work_details || j.completion_note) && <div className="text-xs text-muted-foreground">{j.completion_note || j.work_details}</div>}
                </li>
              ))}
            </ul>
          )
        ) : sheet.orders.length === 0 ? (
          <p className="text-sm text-muted-foreground">No orders raised or changed.</p>
        ) : (
          <ul className="divide-y text-sm">
            {sheet.orders.map((o) => (
              <li key={o.id} className="flex items-start justify-between gap-2 py-2">
                <div className="min-w-0">
                  <Link to={orderBase} params={{ id: String(o.id) }} className="font-mono text-xs font-semibold text-primary hover:underline">
                    {o.order_no}
                  </Link>
                  <div className="truncate">{o.client_name}</div>
                  <div className="text-xs text-muted-foreground">{o.what}</div>
                </div>
                <span className="whitespace-nowrap text-xs tabular-nums">{inr(o.value)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <Rows sheet={sheet} isField={isField} />
    </div>
  );
}

function Rows({ sheet, isField }: { sheet: Sheet; isField: boolean }) {
  const qc = useQueryClient();
  const [activity, setActivity] = useState<string>(isField ? "Note" : "Follow-up");
  const [client, setClient] = useState("");
  const [time, setTime] = useState("");
  const [note, setNote] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["day-sheets"] });
  const add = useMutation({
    mutationFn: () =>
      apiFetch("/day-sheets", {
        method: "POST",
        data: { day: sheet.day, activity: isField ? "Note" : activity, client_name: client.trim() || null, time: time || null, note: note.trim() },
      }),
    onSuccess: () => {
      setNote("");
      setClient("");
      setTime("");
      refresh();
      toast.success("Added to the day sheet");
    },
    onError: (err) => toast.error(friendlyError(err, "Could not add it")),
  });
  const remove = useMutation({
    mutationFn: (id: number) => apiFetch(`/day-sheets/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
    onError: (err) => toast.error(friendlyError(err, "Could not remove it")),
  });

  return (
    <section className="surface-panel p-4 sm:p-5">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        {isField ? "Work done" : "Other work"}
        <span className="rounded-full bg-muted px-2 text-xs font-medium tabular-nums text-muted-foreground">{sheet.entries.length}</span>
      </h2>
      {sheet.entries.length === 0 ? (
        <EmptyState title="Nothing written" description={sheet.can_edit ? (isField ? "Add a note of the work you did." : "Add follow-ups, visits and calls.") : undefined} />
      ) : (
        <ul className="mb-4 divide-y text-sm">
          {[...sheet.entries]
            // Rows with a time in time order; rows without one keep the order they were written in.
            .sort((a, b) => (a.time && b.time ? a.time.localeCompare(b.time) : a.time ? -1 : b.time ? 1 : 0))
            .map((e) => (
            <li key={e.id} className="flex items-start gap-2 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {!isField && <span className="rounded bg-muted px-1.5 py-0.5 font-medium text-foreground">{e.activity}</span>}
                  {e.time && <span>{e.time}</span>}
                  {e.client_name && <span>· {e.client_name}</span>}
                </div>
                <p className="mt-0.5 whitespace-pre-wrap">{e.note}</p>
              </div>
              {sheet.can_edit && (
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Remove this row" disabled={remove.isPending} onClick={() => remove.mutate(e.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {sheet.can_edit && (
        <form
          className={cn("grid gap-3 border-t pt-3", sheet.entries.length === 0 && "mt-3")}
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim()) add.mutate();
          }}
        >
          {!isField && (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <Label>Activity</Label>
                <Select value={activity} onValueChange={setActivity}>
                  <SelectTrigger aria-label="Activity"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ACTIVITIES.map((a) => (
                      <SelectItem key={a} value={a}>{a}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ds-client">Client</Label>
                <Input id="ds-client" value={client} onChange={(e) => setClient(e.target.value)} maxLength={200} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ds-time">Time</Label>
                <Input id="ds-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="ds-note">{isField ? "What you did" : "Note"}</Label>
            <Textarea
              id="ds-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && note.trim() && !add.isPending) {
                  e.preventDefault();
                  add.mutate();
                }
              }}
              maxLength={2000}
              className="min-h-[70px]"
              placeholder={isField ? "e.g. Installed 4 boards at the store, 1 left for tomorrow" : "e.g. Called about the pending payment, promised by Friday"}
            />
            <p className="text-[11px] text-muted-foreground">Ctrl + Enter adds it.</p>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={!note.trim() || add.isPending}>
              {add.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Add
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
