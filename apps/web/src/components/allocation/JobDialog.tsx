import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronDown, ChevronsUpDown, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PLACE_LABELS,
  apiErrorMessage,
  createWorkJob,
  fetchOrderOptions,
  fetchLeave,
  fetchWorkJobs,
  formatJobDates,
  todayIST,
  updateWorkJob,
  type AreaLocality,
  type FieldRole,
  type JobConflict,
  type LeaveClash,
  type OrderOption,
  type WorkJob,
  type WorkJobInput,
} from "@/api/allocation";
import { TeamPicker, teamShortfall } from "./TeamPicker";
import { areasQuery, csmCodesQuery, csmOptionsQuery, fieldStaffQuery } from "./jobLookups";

const NONE = "__none__";

interface Form {
  order: Pick<OrderOption, "id" | "order_no" | "client_name" | "stores"> | null;
  store_ids: number[];
  start_date: string;
  end_date: string;
  work_details: string;
  locality: AreaLocality | null;
  area_name: string;
  csm_user_id: number | null;
  csm2_code_id: number | null;
  member_ids: number[];
  /** Roles marked Required; a role with people on it counts as required anyway. */
  required: Record<FieldRole, boolean>;
  /** Empty dropdowns opened with "+" under each role. */
  blanks: Record<FieldRole, number>;
  route: string;
  extra_tag: string;
  instructions: string;
}

const blankForm = (start: string, members: number[] = []): Form => ({
  order: null,
  store_ids: [],
  start_date: start,
  end_date: start,
  work_details: "",
  locality: null,
  area_name: "",
  csm_user_id: null,
  csm2_code_id: null,
  member_ids: members,
  // Every role starts as Not required (Q17); a person pre-picked from the grid makes theirs required.
  required: { PASTER: false, HELPER: false, DRIVER: false },
  blanks: { PASTER: 0, HELPER: 0, DRIVER: 0 },
  route: "",
  extra_tag: "",
  instructions: "",
});

const formFromJob = (job: WorkJob): Form => ({
  order: job.order && {
    id: job.order.id,
    order_no: job.order.order_no,
    client_name: job.order.client_name,
    stores: job.stores,
  },
  store_ids: job.stores.map((s) => s.id),
  start_date: job.start_date,
  end_date: job.end_date,
  work_details: job.work_details ?? "",
  locality: job.locality,
  area_name: job.area?.name ?? "",
  csm_user_id: job.csm?.id ?? null,
  csm2_code_id: job.csm2_code?.id ?? null,
  member_ids: job.members.map((m) => m.user_id),
  // The roles the job already has show as Required with their people.
  required: {
    PASTER: job.members.some((m) => m.slot_role === "PASTER"),
    HELPER: job.members.some((m) => m.slot_role === "HELPER"),
    DRIVER: job.members.some((m) => m.slot_role === "DRIVER"),
  },
  blanks: { PASTER: 0, HELPER: 0, DRIVER: 0 },
  route: job.route ?? "",
  extra_tag: job.extra_tag ?? "",
  instructions: job.instructions ?? "",
});

/**
 * Create or edit a field job. The order, location and work details may all come later. Shows
 * who is already booked over the chosen dates while the team is being picked; picking them
 * books both jobs, with a warning. If the API still refuses with a clash (someone else booked
 * them a moment ago) lists the clashes with a one-click "book anyway".
 */
export function JobDialog({
  open,
  onClose,
  job,
  defaultDate,
  defaultMemberIds,
  defaultOrderNo,
}: {
  open: boolean;
  onClose: () => void;
  job?: WorkJob | null;
  defaultDate?: string;
  /** Starts a new job on this order (e.g. from the order's own page). */
  defaultOrderNo?: string;
  /** Pre-ticks these people on a new job (e.g. from an empty grid cell). */
  defaultMemberIds?: number[];
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(() =>
    job ? formFromJob(job) : blankForm(defaultDate ?? todayIST(), defaultMemberIds),
  );
  const [conflicts, setConflicts] = useState<JobConflict[]>([]);
  const [leaveConflicts, setLeaveConflicts] = useState<LeaveClash[]>([]);
  const [showMore, setShowMore] = useState(false);

  // Reset the form when the dialog opens (or is pointed at another job or date). This runs
  // during render, not in an effect, so the first frame of the dialog already holds the right
  // dates: an effect would paint once with the old form, fetch who is busy on the wrong days,
  // then render again in the middle of the opening animation.
  const [openedFor, setOpenedFor] = useState<{ job?: WorkJob | null; date?: string } | null>(null);
  if (open && (!openedFor || openedFor.job !== job || openedFor.date !== defaultDate)) {
    setOpenedFor({ job, date: defaultDate });
    setForm(job ? formFromJob(job) : blankForm(defaultDate ?? todayIST(), defaultMemberIds));
    setConflicts([]);
    setLeaveConflicts([]);
    setShowMore(!!job && !!(job.route || job.extra_tag || job.instructions || job.csm2_code));
  } else if (!open && openedFor) {
    setOpenedFor(null);
  }

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const { data: areaData } = useQuery({ ...areasQuery, enabled: open });
  const { data: codeData } = useQuery({ ...csmCodesQuery, enabled: open });
  const { data: csmData } = useQuery({ ...csmOptionsQuery, enabled: open });
  const { data: staffData } = useQuery({ ...fieldStaffQuery, enabled: open });

  const csms = csmData?.csms ?? [];
  // A CSM since made inactive still shows on their old job, in its alphabetical place.
  const csmChoices = [
    ...csms,
    ...(job?.csm && !csms.some((c) => c.id === job.csm!.id) ? [job.csm] : []),
  ].sort((a, b) => a.name.localeCompare(b.name));
  /** The order's creator, when a CSM: the order fills the CSM dropdown with them. */
  const csmOfOrder = (createdBy: number | null, current: number | null) =>
    csms.some((c) => c.id === createdBy) ? createdBy : current;

  // An edited job only carries the stores it covers; fetch the order for the full list. A
  // new job started from an order page fetches that order the same way.
  const lookupNo = job?.order?.order_no ?? defaultOrderNo;
  const { data: editOrder } = useQuery({
    queryKey: ["work-jobs", "order-options", lookupNo],
    queryFn: () => fetchOrderOptions(lookupNo!),
    enabled: open && !!lookupNo,
  });
  useEffect(() => {
    if (!open) return;
    if (job) {
      const full = editOrder?.orders.find((o) => o.id === job.order?.id);
      if (full) setForm((f) => (f.order?.id === full.id ? { ...f, order: full } : f));
      return;
    }
    const preset = editOrder?.orders.find((o) => o.order_no === defaultOrderNo);
    if (preset)
      setForm((f) =>
        f.order
          ? f.order.id === preset.id
            ? { ...f, csm_user_id: f.csm_user_id ?? csmOfOrder(preset.created_by, null) }
            : f
          : {
              ...f,
              order: preset,
              store_ids: preset.stores.length === 1 ? [preset.stores[0].id] : [],
              csm_user_id: csmOfOrder(preset.created_by, f.csm_user_id),
            },
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- csmOfOrder only reads csmData
  }, [editOrder, job, open, defaultOrderNo, csmData]);

  const end = form.end_date || form.start_date;
  const datesValid = !!form.start_date && end >= form.start_date;

  // Who is already booked over these dates (other jobs only), to mark them in the picker.
  const { data: overlapData, isPending: overlapPending } = useQuery({
    queryKey: ["work-jobs", "list", { from: form.start_date, to: end }],
    queryFn: () => fetchWorkJobs({ from: form.start_date, to: end }),
    enabled: open && datesValid,
  });
  const busy = useMemo(() => {
    const map = new Map<number, string[]>();
    for (const j of overlapData?.jobs ?? []) {
      if (j.id === job?.id || j.status === "CANCELLED") continue;
      for (const m of j.members)
        map.set(m.user_id, [
          ...(map.get(m.user_id) ?? []),
          `${j.order?.order_no ?? "a job with no order"} (${formatJobDates(j.start_date, j.end_date)})`,
        ]);
    }
    return map;
  }, [overlapData, job?.id]);

  // Who is on approved leave over these dates. Leave is a hard stop, so they cannot be picked.
  const { data: leaveData, isPending: leavePending } = useQuery({
    queryKey: ["leave", "list", { from: form.start_date, to: end, status: "APPROVED" }],
    queryFn: () => fetchLeave({ from: form.start_date, to: end, status: "APPROVED" }),
    enabled: open && datesValid,
  });
  // Until both answers are in for these dates, nobody can be called free or busy.
  const checking = datesValid && (overlapPending || leavePending);
  const onLeave = useMemo(() => {
    const map = new Map<number, string>();
    for (const l of leaveData?.leave ?? [])
      map.set(l.user.id, formatJobDates(l.from_date, l.to_date));
    return map;
  }, [leaveData]);

  // Only the admin adds area names (Master Library), so the form picks from the active ones.
  const areaNames = (locality: AreaLocality | null) =>
    (areaData?.areas ?? [])
      .filter((a) => a.is_active && a.locality === locality)
      .map((a) => a.name)
      .sort((a, b) => a.localeCompare(b));
  const codes = (codeData?.codes ?? []).filter((c) => c.is_active || c.id === form.csm2_code_id);
  const staff = (staffData?.staff ?? []).filter(
    (s) => s.is_active || form.member_ids.includes(s.id),
  );
  const chosen = staff.filter((s) => form.member_ids.includes(s.id));
  const roleCount = (r: FieldRole) => chosen.filter((s) => s.role === r).length;
  const clashing = chosen.filter((s) => busy.has(s.id));
  const chosenOnLeave = chosen.filter((s) => onLeave.has(s.id));
  // A grid cell can start a job with someone already on it, which makes their role required.
  const requiredOf = (r: FieldRole) => form.required[r] || roleCount(r) > 0;
  const required = { PASTER: requiredOf("PASTER"), HELPER: requiredOf("HELPER"), DRIVER: requiredOf("DRIVER") };

  const save = useMutation({
    mutationFn: (allowOverride?: boolean) => {
      const body: WorkJobInput = {
        order_id: form.order?.id ?? null,
        store_ids: form.store_ids,
        start_date: form.start_date,
        end_date: end,
        csm_user_id: form.csm_user_id,
        csm2_code_id: form.csm2_code_id,
        work_details: form.work_details.trim() || null,
        locality: form.locality,
        area_name: form.area_name.trim() || null,
        route: form.route.trim() || null,
        extra_tag: form.extra_tag.trim() || null,
        instructions: form.instructions.trim() || null,
        // Picking someone already booked is the go-ahead to book both jobs.
        allow_double_booking: allowOverride ?? clashing.length > 0,
        member_ids: form.member_ids,
      };
      return job ? updateWorkJob(job.id, body) : createWorkJob(body);
    },
    onSuccess: (saved) => {
      const on = saved.order ? ` on ${saved.order.order_no}` : "";
      toast.success(
        job
          ? `Job${on} updated`
          : saved.members.length
            ? `Job${on} assigned to ${saved.members.length} ${saved.members.length === 1 ? "person" : "people"}`
            : `Job${on} saved. No team yet.`,
      );
      qc.invalidateQueries({ queryKey: ["work-jobs"] });
      onClose();
    },
    onError: (err: unknown) => {
      const data = (
        err as { response?: { data?: { conflicts?: unknown; leave_conflicts?: unknown } } }
      )?.response?.data;
      setConflicts(Array.isArray(data?.conflicts) ? (data.conflicts as JobConflict[]) : []);
      setLeaveConflicts(
        Array.isArray(data?.leave_conflicts) ? (data.leave_conflicts as LeaveClash[]) : [],
      );
      toast.error(apiErrorMessage(err, "Could not save the job"));
    },
  });

  // What is still missing, said next to the save button rather than left to guess.
  const missing = !form.csm_user_id
    ? "Pick the CSM."
    : !datesValid
      ? "Fix the dates."
      : (teamShortfall(roleCount, requiredOf) ??
        // Saving before this is known could book someone twice without the warning showing.
        (checking ? "Checking who is free on these dates…" : null));
  const canSave = !missing;

  const roleOf = (id: number) => staff.find((s) => s.id === id)?.role;

  /**
   * A new team. A role that had people stays Required even when its last person is taken off,
   * so its dropdown stays open and the hint asks for someone, or for "Not required".
   */
  const setTeam = (ids: number[]) => {
    setForm((f) => {
      const had = (r: FieldRole) => f.member_ids.some((id) => roleOf(id) === r);
      return {
        ...f,
        member_ids: ids,
        required: {
          PASTER: f.required.PASTER || had("PASTER"),
          HELPER: f.required.HELPER || had("HELPER"),
          DRIVER: f.required.DRIVER || had("DRIVER"),
        },
      };
    });
    setConflicts([]);
    setLeaveConflicts([]);
  };

  /** Saying a role is not required takes its people off the team. */
  const setRoleRequired = (role: FieldRole, on: boolean) => {
    setForm((f) => ({
      ...f,
      member_ids: on ? f.member_ids : f.member_ids.filter((id) => roleOf(id) !== role),
      required: { ...f.required, [role]: on },
      blanks: { ...f.blanks, [role]: 0 },
    }));
    if (!on) {
      setConflicts([]);
      setLeaveConflicts([]);
    }
  };

  const setBlanks = (role: FieldRole, n: number) =>
    setForm((f) => ({ ...f, blanks: { ...f.blanks, [role]: Math.max(0, n) } }));

  /**
   * Pressing the chosen location again clears it, since the location is optional. Switching
   * between Hyderabad and Non-local keeps the area only if it is listed under the new choice.
   */
  const pickLocality = (l: AreaLocality) =>
    setForm((f) =>
      f.locality === l
        ? { ...f, locality: null, area_name: "" }
        : {
            ...f,
            locality: l,
            area_name: areaNames(l).some((n) => n.toLowerCase() === f.area_name.toLowerCase())
              ? f.area_name
              : "",
          },
    );

  const changeOrder = (o: OrderOption | null) =>
    setForm((f) => ({
      ...f,
      order: o,
      store_ids: o?.stores.length === 1 ? [o.stores[0].id] : [],
      csm_user_id: o ? csmOfOrder(o.created_by, f.csm_user_id) : f.csm_user_id,
    }));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="break-words">
            {job ? `Edit the job${job.order ? ` on ${job.order.order_no}` : ""}` : "New field job"}
          </DialogTitle>
          <DialogDescription>
            {job
              ? "Changes are recorded in the audit log, and anyone added or removed is told."
              : "The team is notified as soon as the job is saved."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 py-1">
          {/* Order and CSM */}
          <section className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>
                  Order <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <OrderPicker value={form.order} onChange={changeOrder} />
              </div>
              <div className="grid gap-2">
                <Label>CSM</Label>
                <Select
                  value={form.csm_user_id ? String(form.csm_user_id) : undefined}
                  onValueChange={(v) => set("csm_user_id", Number(v))}
                >
                  <SelectTrigger aria-label="CSM">
                    <SelectValue placeholder="Pick the CSM" />
                  </SelectTrigger>
                  <SelectContent>
                    {csmChoices.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {form.order && form.order.stores.length > 0 && (
              <div className="grid gap-2">
                <Label>
                  Stores covered{" "}
                  <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <div className="grid max-h-40 gap-1 overflow-y-auto rounded-xl border p-2 sm:grid-cols-2">
                  {form.order.stores.map((s) => (
                    <label
                      key={s.id}
                      className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted/50"
                    >
                      <Checkbox
                        className="mt-0.5"
                        checked={form.store_ids.includes(s.id)}
                        onCheckedChange={(c) =>
                          set(
                            "store_ids",
                            c
                              ? [...form.store_ids, s.id]
                              : form.store_ids.filter((x) => x !== s.id),
                          )
                        }
                      />
                      <span className="min-w-0">
                        <span className="font-medium">
                          {s.s_no}. {s.store_name}
                        </span>
                        {s.location && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {s.location}
                          </span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* When */}
          <section className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="job-start">Start date</Label>
              <Input
                id="job-start"
                type="date"
                value={form.start_date}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    start_date: e.target.value,
                    end_date: f.end_date < e.target.value ? e.target.value : f.end_date,
                  }))
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="job-end">End date</Label>
              <Input
                id="job-end"
                type="date"
                value={form.end_date}
                min={form.start_date}
                onChange={(e) => set("end_date", e.target.value)}
              />
              {!datesValid && (
                <p className="text-xs text-destructive">
                  End date must be on or after the start date.
                </p>
              )}
            </div>
          </section>

          {/* Team */}
          <section className="grid gap-3">
            <TeamPicker
              staff={staff}
              selected={form.member_ids}
              required={required}
              blanks={form.blanks}
              busy={busy}
              onLeave={onLeave}
              checking={checking}
              onChange={setTeam}
              onRequired={setRoleRequired}
              onBlanks={setBlanks}
              driverAside={
                // Where: on the Driver row, as the driver is the one who needs to know.
                <div className="grid content-start gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label>
                      Location{" "}
                      <span className="font-normal text-muted-foreground">(optional)</span>
                    </Label>
                    <div
                      role="radiogroup"
                      aria-label="Location"
                      className="inline-flex rounded-xl border bg-muted/40 p-1 text-sm"
                    >
                      {(["LOCAL", "NON_LOCAL"] as const).map((l) => (
                        <button
                          key={l}
                          type="button"
                          role="radio"
                          aria-checked={form.locality === l}
                          onClick={() => pickLocality(l)}
                          className={cn(
                            "min-h-8 rounded-lg px-3 font-medium transition-colors",
                            form.locality === l
                              ? "bg-background text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {PLACE_LABELS[l]}
                        </button>
                      ))}
                    </div>
                  </div>
                  {form.locality && (
                    <AreaNamePicker
                      names={areaNames(form.locality)}
                      value={form.area_name}
                      onChange={(name) => set("area_name", name)}
                    />
                  )}
                </div>
              }
            />
            {chosenOnLeave.length > 0 && (
              <p className="flex items-start gap-1.5 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {chosenOnLeave.map((s) => `${s.name} (${onLeave.get(s.id)})`).join(", ")}{" "}
                {chosenOnLeave.length === 1 ? "is" : "are"} on leave over these dates.
              </p>
            )}
            {clashing.length > 0 && (
              <p className="flex items-start gap-1.5 text-xs text-amber-600">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {clashing.map((s) => s.name).join(", ")} already{" "}
                {clashing.length === 1 ? "has" : "have"} work on these dates. Saving books both
                jobs.
              </p>
            )}
          </section>

          <section className="grid gap-2">
            <Label htmlFor="job-work">
              Work details <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="job-work"
              rows={2}
              value={form.work_details}
              maxLength={500}
              onChange={(e) => set("work_details", e.target.value)}
              placeholder="The CSM can add these later"
            />
          </section>

          <section className="grid gap-3">
            <button
              type="button"
              onClick={() => setShowMore((v) => !v)}
              aria-expanded={showMore}
              className="flex items-center gap-1.5 justify-self-start text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              <ChevronDown
                className={cn("h-4 w-4 transition-transform", showMore && "rotate-180")}
              />
              More options
              <span className="font-normal">(route, 2nd CSM, grid tag, instructions)</span>
            </button>
            {showMore && (
              <div className="grid gap-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="job-route">
                      Route <span className="font-normal text-muted-foreground">(optional)</span>
                    </Label>
                    <Input
                      id="job-route"
                      value={form.route}
                      onChange={(e) => set("route", e.target.value)}
                      placeholder="e.g. Hyd → Kurnool → Nandyal"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>
                      Second CSM code{" "}
                      <span className="font-normal text-muted-foreground">(optional)</span>
                    </Label>
                    <CodeSelect
                      codes={codes.filter((c) => c.user?.id !== form.csm_user_id)}
                      value={form.csm2_code_id}
                      onChange={(v) => set("csm2_code_id", v)}
                      placeholder="None"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="job-tag">
                      Grid tag <span className="font-normal text-muted-foreground">(optional)</span>
                    </Label>
                    <Input
                      id="job-tag"
                      value={form.extra_tag}
                      maxLength={20}
                      onChange={(e) => set("extra_tag", e.target.value.toUpperCase())}
                      placeholder="e.g. CN"
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="job-instructions">
                    Instructions for the team{" "}
                    <span className="font-normal text-muted-foreground">(optional)</span>
                  </Label>
                  <Textarea
                    id="job-instructions"
                    rows={2}
                    value={form.instructions}
                    maxLength={1000}
                    onChange={(e) => set("instructions", e.target.value)}
                  />
                </div>
              </div>
            )}
          </section>

          {leaveConflicts.length > 0 && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <div className="mb-2 flex items-center gap-2 font-medium text-destructive">
                <AlertTriangle className="h-4 w-4" /> On leave
              </div>
              <ul className="grid gap-1">
                {leaveConflicts.map((l) => (
                  <li key={l.leave_id}>
                    <span className="font-medium">{l.name}</span> is on leave{" "}
                    {formatJobDates(l.from_date, l.to_date)}
                    {l.reason ? ` (${l.reason})` : ""}. Take them off the team or change the dates.
                  </li>
                ))}
              </ul>
            </div>
          )}

          {conflicts.length > 0 && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <div className="mb-2 flex items-center gap-2 font-medium text-destructive">
                <AlertTriangle className="h-4 w-4" /> Already booked
              </div>
              <ul className="mb-3 grid gap-1">
                {conflicts.map((c) => (
                  <li key={`${c.user_id}-${c.job_id}`}>
                    <span className="font-medium">{c.name}</span> is on{" "}
                    {c.order_no ?? "a job with no order"} (
                    {formatJobDates(c.start_date, c.end_date)})
                    {c.work_details ? ` — ${c.work_details}` : ""}
                  </li>
                ))}
              </ul>
              <Button
                size="sm"
                variant="outline"
                disabled={save.isPending}
                onClick={() => save.mutate(true)}
              >
                Book anyway as a 2nd job
              </Button>
            </div>
          )}
        </div>

        <DialogFooter className="items-center gap-2 sm:gap-2">
          {!canSave && (
            <p className="mr-auto text-xs text-muted-foreground" aria-live="polite">
              {missing}
            </p>
          )}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate(undefined)} disabled={!canSave || save.isPending}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {job ? "Save changes" : "Assign job"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Pickers
// ---------------------------------------------------------------------------

function OrderPicker({
  value,
  onChange,
}: {
  value: Form["order"];
  onChange: (o: OrderOption | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const { data, isFetching } = useQuery({
    queryKey: ["work-jobs", "order-options", debounced],
    queryFn: () => fetchOrderOptions(debounced),
    enabled: open,
  });

  return (
    <div className="flex items-start gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            className="h-auto min-h-10 min-w-0 flex-1 justify-between rounded-xl py-2 text-left font-normal"
          >
            {value ? (
              <span className="min-w-0 truncate">
                <span className="font-mono font-semibold">{value.order_no}</span> ·{" "}
                {value.client_name}
              </span>
            ) : (
              <span className="truncate text-muted-foreground">
                Search by order no, client or store
              </span>
            )}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[var(--radix-popover-trigger-width)] min-w-72 p-0"
          align="start"
        >
          <Command shouldFilter={false}>
            <CommandInput value={q} onValueChange={setQ} placeholder="ORD26…, client or store" />
            <CommandList>
              {isFetching && !data ? (
                <div className="p-4 text-center text-sm text-muted-foreground">Searching…</div>
              ) : (
                <CommandEmpty>No orders found.</CommandEmpty>
              )}
              <CommandGroup>
                {(data?.orders ?? []).map((o) => (
                  <CommandItem
                    key={o.id}
                    value={String(o.id)}
                    onSelect={() => {
                      onChange(o);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value?.id === o.id ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate">
                        <span className="font-mono font-semibold">{o.order_no}</span> ·{" "}
                        {o.client_name}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {o.stores.length} store{o.stores.length === 1 ? "" : "s"} · {o.status}
                        {o.creator_name ? ` · ${o.creator_name}` : ""}
                      </div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-10 shrink-0"
          aria-label="Remove the order"
          onClick={() => onChange(null)}
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

/**
 * Pick an area from the active list. New names are not typed here: the admin adds them in the
 * Master Library (Q25), and the API refuses a name it does not know.
 */
function AreaNamePicker({
  names,
  value,
  onChange,
}: {
  /** Alphabetical. */
  names: string[];
  value: string;
  onChange: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const pick = (name: string) => {
    onChange(name);
    setOpen(false);
  };
  return (
    <div className="flex items-start gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            className="min-w-0 flex-1 justify-between rounded-xl font-normal"
          >
            {value ? (
              <span className="truncate">{value}</span>
            ) : (
              <span className="text-muted-foreground">Pick an area (optional)</span>
            )}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[var(--radix-popover-trigger-width)] min-w-64 p-0"
          align="start"
        >
          <Command>
            <CommandInput maxLength={100} placeholder="Search areas" />
            <CommandList>
              <CommandEmpty className="px-3 py-4 text-center text-sm text-muted-foreground">
                {names.length
                  ? "No area matches. Ask the admin to add it in Master Library."
                  : "No areas listed here yet. Ask the admin to add them in Master Library."}
              </CommandEmpty>
              <CommandGroup>
                {names.map((n) => (
                  <CommandItem key={n} value={n} onSelect={() => pick(n)}>
                    <Check
                      className={cn("mr-2 h-4 w-4", value === n ? "opacity-100" : "opacity-0")}
                    />
                    {n}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-10 shrink-0"
          aria-label="Clear the area name"
          onClick={() => onChange("")}
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

function CodeSelect({
  codes,
  value,
  onChange,
  placeholder,
}: {
  codes: { id: number; code: string; label: string | null; user: { name: string } | null }[];
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder: string;
}) {
  return (
    <Select
      value={value ? String(value) : NONE}
      onValueChange={(v) => onChange(v === NONE ? null : Number(v))}
    >
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{placeholder}</SelectItem>
        {codes.map((c) => (
          <SelectItem key={c.id} value={String(c.id)}>
            {c.code}
            {c.user ? ` · ${c.user.name}` : c.label ? ` · ${c.label}` : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
