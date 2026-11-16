import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { completeProduction } from "@/api/orders";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { friendlyError } from "@/lib/friendly-error";

export type CompleteRequest = { order_id: number; item_ids?: number[] }[];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Asks before the Production Manager marks work produced, then does it. `what` names the work
 * in the question ("ORD260021", "3 items on ORD260021", "5 orders"). Unassigned items count as
 * made by the Production Manager; flagged items are left for the admin.
 */
export function ProductionCompleteDialog({
  request,
  what,
  onClose,
  onDone,
}: {
  request: CompleteRequest | null;
  what: string;
  onClose: () => void;
  onDone?: () => void;
}) {
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: completeProduction,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["prod-manager-dashboard"] });
      const notes = [
        res.skipped_flagged > 0 ? `${plural(res.skipped_flagged, "flagged item")} left for the admin.` : "",
        res.skipped_orders > 0 ? `${plural(res.skipped_orders, "order")} already past production.` : "",
      ].filter(Boolean);
      toast.success(
        res.items === 0 ? "Nothing left to mark complete." : `Marked ${plural(res.items, "item")} complete.`,
        { description: notes.join(" ") || undefined },
      );
      onDone?.();
      onClose();
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string } }; message?: string } | null;
      toast.error("Could not mark complete", { description: friendlyError(e) });
    },
  });

  return (
    <AlertDialog open={request !== null} onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Mark {what} complete?</AlertDialogTitle>
          <AlertDialogDescription>
            Every open item is marked produced, including items nobody was assigned (those are recorded
            as done by you). Flagged items stay on hold. The CSM is told when an order is ready to install.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={save.isPending}>Cancel</AlertDialogCancel>
          <Button onClick={() => request && save.mutate(request)} disabled={save.isPending}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            Mark complete
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
