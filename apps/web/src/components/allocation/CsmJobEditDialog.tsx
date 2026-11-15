import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
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
import {
  apiErrorMessage,
  fetchCsmOrderOptions,
  updateCsmJob,
  type WorkJob,
} from "@/api/allocation";

type OrderOption = { id: number; order_no: string; client_name: string };

/**
 * What a CSM may change on his own job: its work details, and which of his orders it is on.
 * The team, dates and location stay with the Operation Manager. Used from Field Jobs and from
 * a job opened on the CSM's Weekly Grid or Daily Board.
 */
export function CsmJobEditDialog({ job, onClose }: { job: WorkJob | null; onClose: () => void }) {
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
      // His job list, grid, board and job details all live under this key.
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
