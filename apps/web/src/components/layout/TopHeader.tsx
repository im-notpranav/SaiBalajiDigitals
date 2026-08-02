import { useNavigate } from "@tanstack/react-router";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Bell, LogOut, Search, User, Sun, Moon, ChevronDown, CalendarRange } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth-store";
import { fetchMyNotifications, markNotificationRead } from "@/api/notifications";
import { useGoToOrder } from "@/lib/use-order-nav";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import type { Notification } from "@sb-oms/shared-types";

export function TopHeader() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [dark, setDark] = useState(false);
  const goToOrder = useGoToOrder();
  const { data: notifications = [] } = useQuery({
    queryKey: ["notifications"],
    queryFn: fetchMyNotifications,
  });
  const unread = notifications.filter((n) => !n.read).length;

  const openNotification = async (n: Notification) => {
    if (!n.read) {
      try {
        await markNotificationRead(n.id);
        queryClient.invalidateQueries({ queryKey: ["notifications"] });
      } catch {
        /* non-blocking */
      }
    }
    if (n.order_id) goToOrder(n.order_id);
  };

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  const handleLogout = async () => {
    queryClient.removeQueries({ queryKey: ["auth", "me"] });
    await logout();
    navigate({ to: "/login" });
  };

  const handleSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const q = e.currentTarget.value;
      if (user?.role === "ADMIN") {
        navigate({ to: "/admin/orders", search: { q } as any });
      } else if (user?.role === "ACCOUNTS") {
        navigate({ to: "/accountant/orders", search: { q } as any });
      } else if (user?.role === "EMPLOYEE") {
        navigate({ to: "/employee/orders", search: { q } as any });
      }
    }
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-card/80 px-4 backdrop-blur-xl sm:px-6">
      {user?.role !== "PRODUCTION" && (
        <div className="relative hidden max-w-md flex-1 md:block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            placeholder="Search orders, clients, stores…    ↵"
            className="h-10 w-full rounded-xl border bg-background pl-9 pr-3 text-sm outline-none ring-primary/40 transition focus:ring-2"
            onKeyDown={handleSearch}
          />
        </div>
      )}
      <div className="flex-1 md:hidden" />
      <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
        <Badge variant="outline" className="hidden gap-1.5 rounded-full border-primary/30 bg-primary/5 px-3 py-1 text-primary sm:inline-flex">
          <CalendarRange className="h-3.5 w-3.5" /> FY 2026-27
        </Badge>

        <Button variant="ghost" size="icon" onClick={() => setDark((d) => !d)} className="rounded-full">
          {dark ? <Sun className="h-4.5 w-4.5" /> : <Moon className="h-4.5 w-4.5" />}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative rounded-full">
              <Bell className="h-4.5 w-4.5" />
              {unread > 0 && (
                <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                  {unread}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel className="flex items-center justify-between">
              Notifications
              <Badge variant="secondary">{unread} new</Badge>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {notifications.length === 0 && (
              <div className="px-2 py-6 text-center text-xs text-muted-foreground">You're all caught up!</div>
            )}
            {notifications.slice(0, 5).map((n) => (
              <DropdownMenuItem
                key={n.id}
                onSelect={() => openNotification(n)}
                className={cn("flex-col items-start gap-1 py-3", n.order_id && "cursor-pointer", !n.read && "bg-primary/5")}
              >
                <div className="flex w-full items-center gap-2">
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full",
                      n.kind === "success" && "bg-success",
                      n.kind === "info" && "bg-info",
                      n.kind === "warning" && "bg-warning",
                    )}
                  />
                  <span className="font-medium">{n.title}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">{formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}</span>
                </div>
                <span className="line-clamp-2 text-xs text-muted-foreground">{n.body}</span>
                {n.order_id ? <span className="text-[11px] font-medium text-primary">View order →</span> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="ml-1 flex items-center gap-2 rounded-full border bg-background py-1 pl-1 pr-3 transition hover:bg-accent">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-gradient-to-br from-primary to-primary-deep text-xs font-bold text-primary-foreground">
                  {user?.name?.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="hidden text-left leading-tight sm:block">
                <div className="text-xs font-semibold">{user?.name}</div>
                <div className="text-[10px] capitalize text-muted-foreground">{user?.role}</div>
              </div>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="font-semibold">{user?.name}</div>
              <div className="text-xs font-normal text-muted-foreground">@{user?.username}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => navigate({ to: "/profile" })}
            >
              <User className="mr-2 h-4 w-4" /> Profile
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive">
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
