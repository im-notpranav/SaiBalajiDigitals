import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronsUpDown, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
  FIELD_ROLE_LABELS,
  apiErrorMessage,
  createWorkJob,
  fetchAreas,
  fetchCsmCodes,
  fetchFieldStaff,
  fetchOrderOptions,
  fetchVehicles,
  fetchWorkJobs,
  formatJobDates,
  todayIST,
  updateWorkJob,
  type FieldRole,
  type JobConflict,
  type OrderOption,
  type WorkJob,
  type WorkJobInput,
} from "@/api/allocation";
import { LocalityTag } from "./JobBits";

/** Mirrors TEAM_LIMITS in the API (utils/work-allocation.ts). */
const TEAM_LIMITS: Record<FieldRole, number> = { PASTER: 2, HELPER: 2, DRIVER: 1 };
const ROLES: FieldRole[] = ["PASTER", "HELPER", "DRIVER"];
const NONE = "__none__";

interface Form {
  order: Pick<OrderOption, "id" | "order_no" | "client_name" | "stores"> | null;
  store_ids: number[];
  start_date: string;
  end_date: string;
  work_details: string;
  area_id: number | null;
  vehicle_id: number | null;
  csm_code_id: number | null;
  csm2_code_id: number | null;
  member_ids: number[];
  route: string;
  extra_tag: string;
  instructions: string;
  allow_double_booking: boolean;
}

const blankForm = (start: string, members: number[] = []): Form => ({
  order: null,
  store_ids: [],
  start_date: start,
  end_date: start,
  work_details: "",
  area_id: null,
  vehicle_id: null,
  csm_code_id: null,
  csm2_code_id: null,
  member_ids: members,
  route: "",
  extra_tag: "",
  instructions: "",
  allow_double_booking: false,
});

const formFromJob = (job: WorkJob): Form => ({
  order: {
    id: job.order.id,
    order_no: job.order.order_no,
    client_name: job.order.client_name,
    stores: job.stores,
  },
  store_ids: job.stores.map((s) => s.id),
  start_date: job.start_date,
  end_date: job.end_date,
  work_details: job.work_details,
  area_id: job.area.id,
  vehicle_id: job.vehicle?.id ?? null,
  csm_code_id: job.csm_code?.id ?? null,
  csm2_code_id: job.csm2_code?.id ?? null,
  member_ids: job.members.map((m) => m.user_id),
  route: job.route ?? "",
  extra_tag: job.extra_tag ?? "",
  instructions: job.instructions ?? "",
  allow_double_booking: job.allow_double_booking,
});

/**
 * Create or edit a field job. Shows who is already booked over the chosen dates while the
 * team is being picked, and if the API still refuses with a clash (someone else booked them
 * a moment ago) lists the clashes with a one-click "book anyway".
 */
export function JobDialog({
  open,
  onClose,
  job,
  defaultDate,
  defaultMemberIds,
}: {
  open: boolean;
  onClose: () => void;
  job?: WorkJob | null;
  defaultDate?: string;
  /** Pre-ticks these people on a new job (e.g. from an empty grid cell). */
  defaultMemberIds?: number[];
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(() =>
    job ? formFromJob(job) : blankForm(defaultDate ?? todayIST(), defaultMemberIds),
  );
  const [conflicts, setConflicts] = useState<JobConflict[]>([]);

  useEffect(() => {
    if (!open) return;
    setForm(job ? formFromJob(job) : blankForm(defaultDate ?? todayIST(), defaultMemberIds));
    setConflicts([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the dialog opens
  }, [open, job, defaultDate]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const { data: areaData } = useQuery({
    queryKey: ["masters", "areas"],
    queryFn: fetchAreas,
    enabled: open,
  });
  const { data: vehicleData } = useQuery({
    queryKey: ["masters", "vehicles"],
    queryFn: fetchVehicles,
    enabled: open,
  });
  const { data: codeData } = useQuery({
    queryKey: ["masters", "csm-codes"],
    queryFn: fetchCsmCodes,
    enabled: open,
  });
  const { data: staffData } = useQuery({
    queryKey: ["field-staff"],
    queryFn: fetchFieldStaff,
    enabled: open,
  });

  // An edited job only carries the stores it covers; fetch the order for the full list.
  const { data: editOrder } = useQuery({
    queryKey: ["work-jobs", "order-options", job?.order.order_no],
    queryFn: () => fetchOrderOptions(job!.order.order_no),
    enabled: open && !!job,
  });
  useEffect(() => {
    const full = editOrder?.orders.find((o) => o.id === job?.order.id);
    if (full) setForm((f) => (f.order?.id === full.id ? { ...f, order: full } : f));
  }, [editOrder, job]);

  const end = form.end_date || form.start_date;
  const datesValid = !!form.start_date && end >= form.start_date;

  // Who is already booked over these dates (other jobs only), to mark them in the picker.
  const { data: overlapData } = useQuery({
    queryKey: ["work-jobs", "list", { from: form.start_date, to: end }],
    queryFn: () => fetchWorkJobs({ from: form.start_date, to: end }),
    enabled: open && datesValid,
  });
  const busy = useMemo(() => {
    const map = new Map<number, string[]>();
    for (const j of overlapData?.jobs ?? []) {
      if (j.id === job?.id || j.status === "CANCELLED" || j.allow_double_booking) continue;
      for (const m of j.members)
        map.set(m.user_id, [
          ...(map.get(m.user_id) ?? []),
          `${j.job_no} (${formatJobDates(j.start_date, j.end_date)})`,
        ]);
    }
    return map;
  }, [overlapData, job?.id]);

  const areas = (areaData?.areas ?? []).filter((a) => a.is_active || a.id === form.area_id);
  const area = areas.find((a) => a.id === form.area_id);
  const vehicles = (vehicleData?.vehicles ?? []).filter(
    (v) => v.is_active || v.id === form.vehicle_id,
  );
  const codes = (codeData?.codes ?? []).filter(
    (c) => c.is_active || c.id === form.csm_code_id || c.id === form.csm2_code_id,
  );
  const staff = (staffData?.staff ?? []).filter(
    (s) => s.is_active || form.member_ids.includes(s.id),
  );
  const chosen = staff.filter((s) => form.member_ids.includes(s.id));
  const roleCount = (r: FieldRole) => chosen.filter((s) => s.role === r).length;
  const clashing = chosen.filter((s) => busy.has(s.id));

  const save = useMutation({
    mutationFn: (allowOverride?: boolean) => {
      const body: WorkJobInput = {
        order_id: form.order!.id,
        store_ids: form.store_ids,
        start_date: form.start_date,
        end_date: end,
        csm_code_id: form.csm_code_id,
        csm2_code_id: form.csm2_code_id,
        work_details: form.work_details.trim(),
        area_id: form.area_id!,
        vehicle_id: form.vehicle_id,
        route: form.route.trim() || null,
        extra_tag: form.extra_tag.trim() || null,
        instructions: form.instructions.trim() || null,
        allow_double_booking: allowOverride ?? form.allow_double_booking,
        member_ids: form.member_ids,
      };
      return job ? updateWorkJob(job.id, body) : createWorkJob(body);
    },
    onSuccess: (saved) => {
      toast.success(
        job
          ? `${saved.job_no} updated`
          : `${saved.job_no} assigned to ${saved.members.length} ${saved.members.length === 1 ? "person" : "people"}`,
      );
      qc.invalidateQueries({ queryKey: ["work-jobs"] });
      onClose();
    },
    onError: (err: unknown) => {
      const found = (err as { response?: { data?: { conflicts?: unknown } } })?.response?.data
        ?.conflicts;
      setConflicts(Array.isArray(found) ? found : []);
      toast.error(apiErrorMessage(err, "Could not save the job"));
    },
  });

  const canSave =
    !!form.order &&
    datesValid &&
    form.work_details.trim().length >= 3 &&
    !!form.area_id &&
    form.member_ids.length > 0;

  const toggleMember = (id: number, role: FieldRole, on: boolean) => {
    if (on && roleCount(role) >= TEAM_LIMITS[role]) {
      toast.error(
        `A job can have at most ${TEAM_LIMITS[role]} ${FIELD_ROLE_LABELS[role].toLowerCase()}${TEAM_LIMITS[role] > 1 ? "s" : ""}.`,
      );
      return;
    }
    set("member_ids", on ? [...form.member_ids, id] : form.member_ids.filter((m) => m !== id));
    setConflicts([]);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{job ? `Edit ${job.job_no}` : "New field job"}</DialogTitle>
          <DialogDescription>
            {job
              ? "Changes are recorded in the audit log, and anyone added or removed is told."
              : "The team is notified as soon as the job is saved."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 py-1">
          {/* Order and stores */}
          <section className="grid gap-3">
            <div className="grid gap-2">
              <Label>Order</Label>
              <OrderPicker
                value={form.order}
                disabled={!!job}
                onChange={(o) => {
                  setForm((f) => ({
                    ...f,
                    order: o,
                    store_ids: o.stores.length === 1 ? [o.stores[0].id] : [],
                    csm_code_id: f.csm_code_id ?? o.csm_code?.id ?? null,
                  }));
                }}
              />
              {job && (
                <p className="text-xs text-muted-foreground">
                  A job stays on its order. Cancel it and create a new one to move the work.
                </p>
              )}
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

          {/* When, what, where */}
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
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="job-work">Work details</Label>
              <Textarea
                id="job-work"
                rows={2}
                value={form.work_details}
                maxLength={500}
                onChange={(e) => set("work_details", e.target.value)}
                placeholder="e.g. Flex fixing and glow sign installation at 3 stores"
              />
            </div>
            <div className="grid gap-2">
              <Label>Area</Label>
              <AreaPicker
                areas={areas}
                value={form.area_id}
                onChange={(id) => set("area_id", id)}
              />
              {area?.needs_confirmation && (
                <p className="text-xs text-amber-600">
                  Local / non-local for this area is not confirmed yet.
                </p>
              )}
            </div>
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
              <Label>CSM code</Label>
              <CodeSelect
                codes={codes}
                value={form.csm_code_id}
                onChange={(v) => set("csm_code_id", v)}
                placeholder="Order creator's code"
              />
            </div>
            <div className="grid gap-2">
              <Label>
                Second CSM code{" "}
                <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <CodeSelect
                codes={codes.filter((c) => c.id !== form.csm_code_id)}
                value={form.csm2_code_id}
                onChange={(v) => set("csm2_code_id", v)}
                placeholder="None"
              />
            </div>
            <div className="grid gap-2">
              <Label>
                Vehicle <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Select
                value={form.vehicle_id ? String(form.vehicle_id) : NONE}
                onValueChange={(v) => set("vehicle_id", v === NONE ? null : Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No vehicle</SelectItem>
                  {vehicles.map((v) => (
                    <SelectItem key={v.id} value={String(v.id)}>
                      {v.reg_no} · {v.type}
                      {v.usualDriver ? ` · ${v.usualDriver.name}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
          </section>

          {/* Team */}
          <section className="grid gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label>Team</Label>
              <div className="flex gap-2 text-xs">
                {ROLES.map((r) => (
                  <span
                    key={r}
                    className={cn(
                      "rounded-full border px-2 py-0.5",
                      roleCount(r) > 0
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "text-muted-foreground",
                    )}
                  >
                    {FIELD_ROLE_LABELS[r]}s {roleCount(r)}/{TEAM_LIMITS[r]}
                  </span>
                ))}
              </div>
            </div>
            <TeamPicker
              staff={staff}
              selected={form.member_ids}
              busy={busy}
              onToggle={toggleMember}
            />
            {clashing.length > 0 && !form.allow_double_booking && (
              <p className="flex items-start gap-1.5 text-xs text-amber-600">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {clashing.map((s) => s.name).join(", ")} already{" "}
                {clashing.length === 1 ? "has" : "have"} work on these dates. Pick someone else or
                turn on "Allow 2nd job".
              </p>
            )}
          </section>

          <section className="grid gap-3">
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
            <div className="flex items-center justify-between gap-4 rounded-xl border p-3">
              <div>
                <div className="text-sm font-medium">Allow 2nd job</div>
                <div className="text-xs text-muted-foreground">
                  Lets this team be on another job over the same dates. Use only for short or
                  same-route work.
                </div>
              </div>
              <Switch
                checked={form.allow_double_booking}
                onCheckedChange={(v) => set("allow_double_booking", v)}
              />
            </div>
          </section>

          {conflicts.length > 0 && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <div className="mb-2 flex items-center gap-2 font-medium text-destructive">
                <AlertTriangle className="h-4 w-4" /> Already booked
              </div>
              <ul className="mb-3 grid gap-1">
                {conflicts.map((c) => (
                  <li key={`${c.user_id}-${c.job_id}`}>
                    <span className="font-medium">{c.name}</span> is on {c.job_no} (
                    {formatJobDates(c.start_date, c.end_date)}) — {c.work_details}
                  </li>
                ))}
              </ul>
              <Button
                size="sm"
                variant="outline"
                disabled={save.isPending}
                onClick={() => {
                  set("allow_double_booking", true);
                  save.mutate(true);
                }}
              >
                Book anyway as a 2nd job
              </Button>
            </div>
          )}
        </div>

        <DialogFooter>
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
  disabled,
}: {
  value: Form["order"];
  onChange: (o: OrderOption) => void;
  disabled?: boolean;
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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          disabled={disabled}
          className="h-auto min-h-10 w-full justify-between rounded-xl py-2 text-left font-normal"
        >
          {value ? (
            <span className="min-w-0 truncate">
              <span className="font-mono font-semibold">{value.order_no}</span> ·{" "}
              {value.client_name}
            </span>
          ) : (
            <span className="text-muted-foreground">Search by order no, client or store</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
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
                    className={cn("mr-2 h-4 w-4", value?.id === o.id ? "opacity-100" : "opacity-0")}
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
  );
}

function AreaPicker({
  areas,
  value,
  onChange,
}: {
  areas: { id: number; name: string; locality: "LOCAL" | "NON_LOCAL"; district: string | null }[];
  value: number | null;
  onChange: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = areas.find((a) => a.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          className="w-full justify-between rounded-xl font-normal"
        >
          {current ? (
            <span className="flex min-w-0 items-center gap-2 truncate">
              {current.name} <LocalityTag locality={current.locality} />
            </span>
          ) : (
            <span className="text-muted-foreground">Pick an area</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search areas" />
          <CommandList>
            <CommandEmpty>No area by that name. Add it under Allocation Masters.</CommandEmpty>
            <CommandGroup>
              {areas.map((a) => (
                <CommandItem
                  key={a.id}
                  value={`${a.name} ${a.district ?? ""}`}
                  onSelect={() => {
                    onChange(a.id);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn("mr-2 h-4 w-4", value === a.id ? "opacity-100" : "opacity-0")}
                  />
                  <span className="flex-1">
                    {a.name}
                    {a.district ? (
                      <span className="text-xs text-muted-foreground"> · {a.district}</span>
                    ) : null}
                  </span>
                  <LocalityTag locality={a.locality} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
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

function TeamPicker({
  staff,
  selected,
  busy,
  onToggle,
}: {
  staff: { id: number; name: string; role: FieldRole; emp_code: string | null }[];
  selected: number[];
  busy: Map<number, string[]>;
  onToggle: (id: number, role: FieldRole, on: boolean) => void;
}) {
  const [q, setQ] = useState("");
  const match = (s: { name: string; emp_code: string | null }) =>
    `${s.name} ${s.emp_code ?? ""}`.toLowerCase().includes(q.toLowerCase());

  return (
    <div className="rounded-xl border">
      <div className="relative border-b p-2">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search staff by name or employee code"
          className="h-9 border-0 pl-8 shadow-none focus-visible:ring-0"
        />
      </div>
      <div className="grid max-h-72 gap-3 overflow-y-auto p-2 md:grid-cols-3">
        {ROLES.map((role) => {
          const people = staff.filter(
            (s) => s.role === role && (selected.includes(s.id) || match(s)),
          );
          // Free people first, then busy, so the obvious picks are on top.
          people.sort(
            (a, b) =>
              Number(busy.has(a.id)) - Number(busy.has(b.id)) || a.name.localeCompare(b.name),
          );
          return (
            <div key={role} className="min-w-0">
              <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {FIELD_ROLE_LABELS[role]}s
              </div>
              {people.length === 0 && (
                <div className="px-2 py-1 text-xs text-muted-foreground">Nobody matches.</div>
              )}
              {people.map((s) => {
                const on = selected.includes(s.id);
                const jobs = busy.get(s.id);
                return (
                  <label
                    key={s.id}
                    className={cn(
                      "flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted/50",
                      on && "bg-primary/5",
                    )}
                  >
                    <Checkbox
                      className="mt-0.5"
                      checked={on}
                      onCheckedChange={(c) => onToggle(s.id, role, !!c)}
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{s.name}</span>
                      {jobs ? (
                        <span
                          className="block truncate text-xs text-amber-600"
                          title={jobs.join(", ")}
                        >
                          Busy · {jobs.join(", ")}
                        </span>
                      ) : (
                        <span className="block text-xs text-success">Free</span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
