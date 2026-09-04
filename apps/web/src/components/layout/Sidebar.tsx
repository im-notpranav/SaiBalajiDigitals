import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { LogOut, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  LayoutDashboard,
  PlusCircle,
  ClipboardList,
  Bell,
  UserCircle,
  Workflow,
  MessageSquare,
  Wallet,
  Receipt,
  CalendarClock,
  AlarmClock,
  FileBarChart2,
  Users,
  ShieldCheck,
  Settings,
  Boxes,
  Upload,
} from "lucide-react";
import { type UserRole, useAuth } from "@/lib/auth-store";
import { cn } from "@/lib/utils";
import { BrandLockup } from "@/components/brand/Logo";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const NAV: Record<UserRole, NavItem[]> = {
  CSM: [
    { to: "/employee/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/employee/new-order", label: "New Order", icon: PlusCircle },
    { to: "/employee/orders", label: "My Orders", icon: ClipboardList },
    { to: "/employee/notifications", label: "Notifications", icon: Bell },
    { to: "/profile", label: "Profile", icon: UserCircle },
  ],
  PRODUCTION: [
    { to: "/production/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/production/queue", label: "Queue", icon: Workflow },
    { to: "/production/notifications", label: "Notifications", icon: Bell },
    { to: "/profile", label: "Profile", icon: UserCircle },
  ],
  ACCOUNTS: [
    { to: "/accountant/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/accountant/billing", label: "Billing Queue", icon: Receipt },
    { to: "/accountant/orders", label: "All Orders", icon: Boxes },
    { to: "/accountant/reports", label: "Financial Reports", icon: FileBarChart2 },
    { to: "/accountant/financial-year", label: "Financial Year", icon: CalendarClock },
    { to: "/accountant/notifications", label: "Notifications", icon: Bell },
    { to: "/profile", label: "Profile", icon: UserCircle },
  ],
  PRODUCTION_MANAGER: [
    { to: "/prod-manager/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/prod-manager/assign", label: "Assign Work", icon: Workflow },
    { to: "/prod-manager/notifications", label: "Notifications", icon: Bell },
    { to: "/profile", label: "Profile", icon: UserCircle },
  ],
  // Operation Manager shares the admin portal read-only (no Users / Settings /
  // Bulk Import — those are mutation surfaces).
  OPERATION_MANAGER: [
    { to: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/admin/orders", label: "Orders", icon: Boxes },
    { to: "/admin/loss-report", label: "Loss Report", icon: FileBarChart2 },
    { to: "/admin/overdue", label: "Overdue Orders", icon: AlarmClock },
    { to: "/admin/audit", label: "Audit Logs", icon: ShieldCheck },
    { to: "/admin/reports", label: "Reports", icon: FileBarChart2 },
    { to: "/admin/financial-year", label: "Financial Year", icon: CalendarClock },
    { to: "/profile", label: "Profile", icon: UserCircle },
  ],
  ADMIN: [
    { to: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/admin/users", label: "Users", icon: Users },
    { to: "/admin/orders", label: "Orders", icon: Boxes },
    { to: "/admin/loss-report", label: "Loss Report", icon: FileBarChart2 },
    { to: "/admin/overdue", label: "Overdue Orders", icon: AlarmClock },
    { to: "/admin/audit", label: "Audit Logs", icon: ShieldCheck },
    { to: "/admin/reports", label: "Reports", icon: FileBarChart2 },
    { to: "/admin/financial-year", label: "Financial Year", icon: CalendarClock },
    { to: "/admin/import", label: "Bulk Import", icon: Upload },
    { to: "/admin/settings", label: "Settings", icon: Settings },
    { to: "/profile", label: "Profile", icon: UserCircle },
  ],
};

const roleLabels: Record<UserRole, string> = {
  CSM: "Client Service Manager",
  PRODUCTION: "Production Team",
  ACCOUNTS: "Accountant Portal",
  ADMIN: "Administrator Portal",
  OPERATION_MANAGER: "Operation Manager (view only)",
  PRODUCTION_MANAGER: "Production Manager",
};

/** The nav items this user actually gets. Bulk import is super-admin only. */
function useNavItems(role: UserRole) {
  const { user } = useAuth();
  return NAV[role].filter((i) => i.to !== "/admin/import" || user?.is_super_admin);
}

/**
 * The sidebar's contents, shared by the permanent desktop rail and the mobile drawer so
 * the two can never drift apart.
 *
 * `layoutGroup` scopes the sliding active-indicator: both copies are mounted at once
 * (the desktop rail is only hidden with CSS), and two elements sharing one layoutId
 * makes framer-motion animate between them.
 */
function SidebarBody({
  role,
  layoutGroup,
  onNavigate,
}: {
  role: UserRole;
  layoutGroup: string;
  onNavigate?: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, logout } = useAuth();
  const items = useNavItems(role);
  const home = items[0]!.to;

  const handleLogout = async () => {
    onNavigate?.();
    queryClient.removeQueries({ queryKey: ["auth", "me"] });
    await logout();
    navigate({ to: "/login" });
  };

  return (
    <>
      <Link
        to={home}
        onClick={onNavigate}
        className="block shrink-0 border-b p-5 transition-colors hover:bg-sidebar-accent"
      >
        <BrandLockup logoSize={44} />
      </Link>
      <div className="shrink-0 px-5 pt-5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
        {roleLabels[role]}
      </div>
      {/* Scrolls on its own so a long nav (admin has eleven items) stays reachable on a
          short screen without pushing the sign-out block off the bottom. */}
      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3">
        {items.map((item, i) => {
          const active = location.pathname === item.to || location.pathname.startsWith(item.to + "/");
          const Icon = item.icon;
          return (
            <motion.div
              key={item.to}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.03 * i, duration: 0.3 }}
            >
              <Link
                to={item.to}
                onClick={onNavigate}
                className={cn(
                  // min-h-11 keeps every row at a comfortable touch target on a phone.
                  "group relative flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
                  active
                    ? "bg-primary/10 text-primary shadow-sm"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                {active && (
                  <motion.span
                    layoutId={`${layoutGroup}-active`}
                    className="absolute inset-y-1.5 left-0 w-1 rounded-r-full bg-primary"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                )}
                <Icon className="h-[18px] w-[18px] shrink-0" />
                <span className="truncate">{item.label}</span>
              </Link>
            </motion.div>
          );
        })}
      </nav>
      <div className="mt-auto shrink-0 border-t p-3">
        <div className="px-2 pb-2">
          <div className="truncate text-sm font-semibold">{user?.name}</div>
          <div className="truncate text-[11px] text-muted-foreground">@{user?.username}</div>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-destructive transition-all hover:bg-destructive/10"
        >
          <LogOut className="h-[18px] w-[18px]" />
          Sign out
        </button>
      </div>
    </>
  );
}

/** The permanent rail, from `lg` up. Below that the same nav lives in `MobileNav`. */
export function Sidebar({ role }: { role: UserRole }) {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r bg-sidebar md:flex lg:w-72">
      <SidebarBody role={role} layoutGroup="sidebar" />
    </aside>
  );
}

/**
 * The same navigation as a slide-in drawer, for phones and any desktop window too narrow
 * for the rail. Without this there is no navigation at all below `lg`.
 */
export function MobileNav({ role }: { role: UserRole }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  // Close on navigation, including a back/forward that did not come from a link click.
  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="-ml-1 shrink-0 rounded-xl md:hidden"
          aria-label="Open navigation menu"
        >
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="flex w-[19rem] max-w-[85vw] flex-col gap-0 bg-sidebar p-0"
      >
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SheetDescription className="sr-only">
          Links to every section of the {roleLabels[role]}.
        </SheetDescription>
        <SidebarBody role={role} layoutGroup="mobile-nav" onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
