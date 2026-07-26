import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Info, AlertTriangle, BellOff, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { fetchMyNotifications, markAllNotificationsRead } from "@/api/notifications";

function iconFor(kind: string) {
  if (kind === "success") return <CheckCircle2 className="h-4 w-4 text-success" />;
  if (kind === "warning") return <AlertTriangle className="h-4 w-4 text-warning" />;
  return <Info className="h-4 w-4 text-info" />;
}

interface NotificationsListProps {
  title?: string;
  crumbs?: { label: string }[];
}

export function NotificationsList({ title = "Notifications", crumbs = [{ label: "Notifications" }] }: NotificationsListProps) {
  const queryClient = useQueryClient();

  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ["notifications"],
    queryFn: fetchMyNotifications,
  });

  const markReadMutation = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <>
      <PageHeader
        title={title}
        crumbs={crumbs}
        actions={
          <Button
            variant="outline"
            className="rounded-xl"
            disabled={unreadCount === 0 || markReadMutation.isPending}
            onClick={() => markReadMutation.mutate()}
          >
            {markReadMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <BellOff className="mr-2 h-4 w-4" />
            )}
            Mark all read
          </Button>
        }
      />
      
      <div className="surface-panel divide-y min-h-[50vh]">
        {isLoading ? (
          <div className="flex items-center justify-center p-12 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-muted-foreground">
            <CheckCircle2 className="mb-2 h-12 w-12 text-muted-foreground/30" />
            <p>You're all caught up!</p>
          </div>
        ) : (
          notifications.map((n) => (
            <div
              key={n.id}
              className={cn("flex items-start gap-3 p-4 transition hover:bg-muted/40", !n.read && "bg-primary/5")}
            >
              <div className="mt-0.5 rounded-lg border bg-card p-2">{iconFor(n.kind)}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div className="truncate font-semibold">{n.title}</div>
                  {!n.read && (
                    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                      New
                    </span>
                  )}
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                  </span>
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">{n.body}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
