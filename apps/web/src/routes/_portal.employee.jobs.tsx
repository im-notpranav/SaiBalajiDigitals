import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  Check,
  ChevronsUpDown,
  HardHat,
  Loader2,
  MapPin,
  Pencil,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "@/components/layout/PageStates";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
import { JobStatusBadge } from "@/components/allocation/JobBits";
import {
  JOB_EDITABLE,
  apiErrorMessage,
  fetchCsmJobs,
  fetchCsmOrderOptions,
  formatJobDates,
  jobPlace,
  updateCsmJob,
  type WorkJob,
} from "@/api/allocation";

export const Route = createFileRoute("/_portal/employee/jobs")({
  head: () => ({ meta: [{ title: "Field Jobs — SB OMS" }] }),
  component: CsmJobsPage,
});

/** The field jobs a CSM is responsible for: they add the work details and link the order. */
function CsmJobsPage() {
  const [editing, setEditing] = useState<WorkJob | null>(null);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["csm-jobs"],
    queryFn: fetchCsmJobs,
  });

  return (
    <>
      <PageHeader
        title="Field Jobs"
        description="Jobs assigned to you. Add details or link the order."
        crumbs={[{ label: "Field Jobs" }]}
      />
      {isLoading ? (
        <LoadingState label="Loading your jobs…" />
      ) : !data ? (
        <ErrorState title="Couldn't load your jobs" error={error} onRetry={() => refetch()} />
      ) : data.jobs.length === 0 ? (
        <EmptyState
          icon={HardHat}
          title="No field jobs"
          description="Jobs assigned for you will show here."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {data.jobs.map((j) => (
            <JobCard key={j.id} job={j} onEdit={() => setEditing(j)} />
          ))}
        </div>
      )}
      <EditDialog job={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function JobCard({ job, onEdit }: { job: WorkJob; onEdit: () => void }) {
  return (
    <article className="surface-panel grid content-start gap-2 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono font-semibold">{job.order?.order_no ?? "No order yet"}</div>
          {job.order && (
            <div className="truncate text-xs text-muted-foreground" title={job.order.client_name}>
              {job.order.client_name}
            </div>
          )}
        </div>
        <JobStatusBadge status={job.status} />
      </div>
      <p className="break-words text-sm">
        {job.work_details ?? <span className="text-muted-foreground">No work details yet.</span>}
      </p>
      <dl className="grid gap-1 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 shrink-0" />
          {formatJobDates(job.start_date, job.end_date)}
        </div>
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 shrink-0" />
          {jobPlace(job) ?? "Location not set"}
        </div>
        <div className="flex items-start gap-2">
          <Users className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 break-words">{job.members.map((m) => m.name).join(", ")}</span>
        </div>
      </dl>
      {JOB_EDITABLE.includes(job.status) && (
        <div>
          <Button size="sm" variant="outline" className="rounded-xl" onClick={onEdit}>
            <Pencil className="mr-1.5 h-3.5 w-3.5" /> Update job
          </Button>
        </div>
      )}
    </article>
  );
}

type OrderOption = { id: number; order_no: string; client_name: string };

function EditDialog({ job, onClose }: { job: WorkJob | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [details, setDetails] = useState("");
  const [order, setOrder] = useState<OrderOption | null>(null);

  useEffect(() => {
    if (!job) return;
    setDetails(job.work_details ?? "");
    setOrder(job.order);
  }, [job]);

  const save = useMutation({
    mutationFn: () =>
      updateCsmJob(job!.id, {
        work_details: details.trim() || null,
        ...(order && order.id !== job!.order?.id ? { order_id: order.id } : {}),
      }),
    onSuccess: () => {
      toast.success("Job updated");
      qc.invalidateQueries({ queryKey: ["csm-jobs"] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not update the job")),
  });

  return (
    <Dialog open={!!job} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update the job</DialogTitle>
          <DialogDescription>The team is told when the work details change.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Order</Label>
            <OwnOrderPicker value={order} onChange={setOrder} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="csm-job-work">Work details</Label>
            <Textarea
              id="csm-job-work"
              rows={3}
              maxLength={500}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="e.g. Flex fixing and glow sign installation at 3 stores"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OwnOrderPicker({
  value,
  onChange,
}: {
  value: OrderOption | null;
  onChange: (o: OrderOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const { data, isFetching } = useQuery({
    queryKey: ["csm-jobs", "order-options", debounced],
    queryFn: () => fetchCsmOrderOptions(debounced),
    enabled: open,
  });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          className="h-auto min-h-10 w-full justify-between rounded-xl py-2 text-left font-normal"
        >
          {value ? (
            <span className="min-w-0 truncate">
              <span className="font-mono font-semibold">{value.order_no}</span> ·{" "}
              {value.client_name}
            </span>
          ) : (
            <span className="text-muted-foreground">Link one of your orders</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput value={q} onValueChange={setQ} placeholder="ORD26… or client" />
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
                  <span className="min-w-0 truncate">
                    <span className="font-mono font-semibold">{o.order_no}</span> · {o.client_name}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
