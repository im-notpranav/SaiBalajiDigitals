import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { Loader2, NotebookPen, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { addOrderNote, fetchOrderNotes } from "@/api/orders";
import { useAuth } from "@/lib/auth-store";
import { friendlyError } from "@/lib/friendly-error";
import { ROLES } from "@/lib/constants";
import { cn } from "@/lib/utils";

const roleLabel = (r: string) => ROLES.find((x) => x.value === r)?.label ?? r;

/**
 * The order's shared notes. The button is green when the order has notes, plain when it has
 * none, so a filled thread catches the eye. Anyone working on the order reads every note and
 * may add one; nobody edits another's.
 */
export function OrderNotesButton({
  orderId,
  orderNo,
  count,
  size = "default",
  className,
}: {
  orderId: number;
  orderNo: string;
  /** From the order payload, so the colour is right before the thread loads. */
  count?: number;
  size?: "default" | "sm";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ["order-notes", orderId],
    queryFn: () => fetchOrderNotes(orderId),
    enabled: open,
  });
  const n = data?.notes.length ?? count ?? 0;
  const filled = n > 0;
  return (
    <>
      <Button
        type="button"
        size={size}
        variant="outline"
        onClick={() => setOpen(true)}
        aria-label={filled ? `Notes on ${orderNo}: ${n}` : `Notes on ${orderNo}: none yet`}
        className={cn(
          filled && "border-emerald-500/60 bg-emerald-500/15 text-emerald-800 hover:bg-emerald-500/25 hover:text-emerald-900 dark:text-emerald-300",
          className,
        )}
      >
        <NotebookPen className={cn("h-4 w-4", size === "default" && "mr-2", size === "sm" && "mr-1")} aria-hidden />
        Notes{filled ? ` (${n})` : ""}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b p-4 text-left">
            <SheetTitle>Notes · {orderNo}</SheetTitle>
            <SheetDescription>Everyone working on this order sees these notes.</SheetDescription>
          </SheetHeader>
          {open && <NotesThread orderId={orderId} />}
        </SheetContent>
      </Sheet>
    </>
  );
}

function NotesThread({ orderId }: { orderId: number }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["order-notes", orderId],
    queryFn: () => fetchOrderNotes(orderId),
  });
  const notes = data?.notes ?? [];

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [notes.length]);

  const add = useMutation({
    mutationFn: () => addOrderNote(orderId, body.trim()),
    onSuccess: () => {
      setBody("");
      queryClient.invalidateQueries({ queryKey: ["order-notes", orderId] });
      queryClient.invalidateQueries({ queryKey: ["order", String(orderId)] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (err) => toast.error("Note not saved", { description: friendlyError(err) }),
  });

  return (
    <>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : error ? (
          <p className="text-sm text-destructive">{friendlyError(error)}</p>
        ) : notes.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No notes yet. Add the first one below.</p>
        ) : (
          notes.map((n) => {
            const mine = n.author_id === user?.id;
            return (
              <div key={n.id} className={cn("rounded-lg border p-3", mine ? "border-primary/30 bg-primary/5" : "bg-card")}>
                <p className="whitespace-pre-wrap text-sm">{n.body}</p>
                <p className="mt-1.5 text-[11px] text-muted-foreground" title={format(new Date(n.created_at), "dd MMM yyyy, h:mm a")}>
                  <span className="font-medium text-foreground/80">{n.author_name}</span> · {roleLabel(n.author_role)} ·{" "}
                  {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                </p>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>
      <form
        className="border-t p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (body.trim()) add.mutate();
        }}
      >
        <label htmlFor={`note-${orderId}`} className="sr-only">New note</label>
        <Textarea
          id={`note-${orderId}`}
          rows={3}
          value={body}
          maxLength={2000}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && body.trim()) add.mutate();
          }}
          placeholder="Write a note for everyone on this order…"
          className="resize-none"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">Ctrl+Enter to add</span>
          <Button type="submit" size="sm" disabled={!body.trim() || add.isPending}>
            {add.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" aria-hidden />}
            Add note
          </Button>
        </div>
      </form>
    </>
  );
}
