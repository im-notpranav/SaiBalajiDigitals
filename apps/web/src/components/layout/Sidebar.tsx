import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  MessageCircle,
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
  HardHat,
  MapPinned,
  CalendarRange,
  CalendarOff,
  Clock,
  LayoutGrid,
  Truck,
} from "lucide-react";
import { type UserRole, useAuth } from "@/lib/auth-store";
import { cn } from "@/lib/utils";
import { BrandLockup } from "@/components/brand/Logo";
import { fetchMyNotifications } from "@/api/notifications";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** The admin portal's module the item sits under; items without one are listed plainly. */
  group?: NavGroup;
}

/**
 * The admin portal is four modules: the dashboard, the order system (orders, their reports
 * and the automation around them), work allocation, and payment requests.
 */
type NavGroup = "Automated System" | "Work Allocation" | "Payment Request";

const DASHBOARD: NavItem[] = [
  { to: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
];

const ORDER_SYSTEM: NavItem[] = (
  [
    { to: "/admin/orders", label: "Orders", icon: Boxes },
    { to: "/admin/overdue", label: "Overdue Orders", icon: AlarmClock },
    { to: "/admin/loss-report", label: "Loss Report", icon: FileBarChart2 },
    { to: "/admin/reports", label: "Reports", icon: FileBarChart2 },
    { to: "/admin/financial-year", label: "Financial Year", icon: CalendarClock },
    { to: "/admin/audit", label: "Audit Logs", icon: ShieldCheck },
  ] as NavItem[]
).map((i) => ({ ...i, group: "Automated System" as const }));

const WORK_ALLOCATION: NavItem[] = (
  [
    { to: "/admin/grid", label: "Weekly Grid", icon: CalendarRange },
    { to: "/admin/board", label: "Daily Board", icon: LayoutGrid },
    { to: "/admin/jobs", label: "Field Jobs", icon: Truck },
    { to: "/admin/leave", label: "Leave", icon: CalendarOff },
    { to: "/admin/overtime", label: "Overtime", icon: Clock },
    { to: "/admin/field-staff", label: "Field Staff", icon: HardHat },
    { to: "/admin/masters", label: "Allocation Masters", icon: MapPinned },
  ] as NavItem[]
).map((i) => ({ ...i, group: "Work Allocation" as const }));

const FIELD_NAV: NavItem[] = [
  { to: "/field/dashboard", label: "My Work", icon: ClipboardList },
  { to: "/field/leave", label: "Leave & Overtime", icon: CalendarOff },
  { to: "/field/payments", label: "Payments", icon: Wallet },
  { to: "/field/notifications", label: "Notifications", icon: Bell },
  { to: "/profile", label: "Profile", icon: UserCircle },
];

/** Shorter labels for the phone tab bar, where five items share one row. */
const FIELD_TAB_LABELS: Record<string, string> = {
  "/field/dashboard": "Work",
  "/field/leave": "Leave",
  "/field/payments": "Payments",
  "/field/notifications": "Alerts",
  "/profile": "Profile",
};

const FIELD_ROLES: UserRole[] = ["PASTER", "HELPER", "DRIVER"];
export const isFieldRole = (role: UserRole) => FIELD_ROLES.includes(role);

const NAV: Record<UserRole, NavItem[]> = {
  CSM: [
    { to: "/employee/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/employee/new-order", label: "New Order", icon: PlusCircle },
    { to: "/employee/upload-orders", label: "Upload Orders", icon: Upload },
    { to: "/employee/orders", label: "My Orders", icon: ClipboardList },
    { to: "/employee/jobs", label: "Field Jobs", icon: CalendarRange },
    { to: "/employee/payments", label: "Payment Requests", icon: Wallet },
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
  COST_CONTROL_MANAGER: [
    { to: "/cost-control/dashboard", label: "Dashboard", icon: Wallet },
    { to: "/cost-control/notifications", label: "Notifications", icon: Bell },
    { to: "/profile", label: "Profile", icon: UserCircle },
  ],
  PASTER: FIELD_NAV,
  HELPER: FIELD_NAV,
  DRIVER: FIELD_NAV,
  // Operation Manager shares the admin portal read-only for orders and billing (no Users /
  // Settings / Bulk Import), but runs field staff and the allocation masters.
  OPERATION_MANAGER: [
    ...DASHBOARD,
    ...ORDER_SYSTEM,
    ...WORK_ALLOCATION,
    { to: "/profile", label: "Profile", icon: UserCircle },
  ],
  ADMIN: [
    ...DASHBOARD,
    ...ORDER_SYSTEM,
    { to: "/admin/import", label: "Bulk Import", icon: Upload, group: "Automated System" },
    { to: "/admin/users", label: "Users", icon: Users, group: "Automated System" },
    { to: "/admin/whatsapp", label: "WhatsApp", icon: MessageCircle, group: "Automated System" },
    { to: "/admin/settings", label: "Settings", icon: Settings, group: "Automated System" },
    ...WORK_ALLOCATION,
    { to: "/admin/payments", label: "Payment Requests", icon: Wallet, group: "Payment Request" },
    { to: "/profile", label: "Profile", icon: UserCircle },
  ],
};

const roleLabels: Record<UserRole, string> = {
  CSM: "Client Service Manager",
  PRODUCTION: "Production Team",
  ACCOUNTS: "Accountant Portal",
  ADMIN: "Administrator Portal",
  OPERATION_MANAGER: "Operation Manager",
  PRODUCTION_MANAGER: "Production Manager",
  COST_CONTROL_MANAGER: "Cost Control",
  PASTER: "Field Staff · Paster",
  HELPER: "Field Staff · Helper",
  DRIVER: "Field Staff · Driver",
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
      {/* Scrolls on its own so a long nav (admin has four modules) stays reachable on a
          short screen without pushing the sign-out block off the bottom. */}
      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3">
        {items.map((item, i) => {
          const heading = item.group && item.group !== items[i - 1]?.group ? item.group : null;
          // Profile after the modules belongs to none of them, so it gets a rule above it.
          const ruled = !item.group && !!items[i - 1]?.group;
          const active =
            location.pathname === item.to || location.pathname.startsWith(item.to + "/");
          const Icon = item.icon;
          return (
            <motion.div
              key={item.to}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.02 * i, duration: 0.3 }}
            >
              {ruled && <div className="mx-3 my-2 border-t" />}
              {heading && (
                <div className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {heading}
                </div>
              )}
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
 * Field staff work from a phone, so below `md` their five destinations also sit in a bottom
 * tab bar within thumb reach — no menu to open to get to leave or payments.
 */
export function FieldTabBar() {
  const location = useLocation();
  const { data: notifications = [] } = useQuery({
    queryKey: ["notifications"],
    queryFn: fetchMyNotifications,
  });
  const unread = notifications.filter((n) => !n.read).length;
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
    >
      <ul className="grid grid-cols-5">
        {FIELD_NAV.map((item) => {
          const active =
            location.pathname === item.to || location.pathname.startsWith(item.to + "/");
          const Icon = item.icon;
          const badge = item.to === "/field/notifications" && unread > 0;
          return (
            <li key={item.to}>
              <Link
                to={item.to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors [-webkit-tap-highlight-color:transparent]",
                  active ? "text-primary" : "text-muted-foreground active:text-foreground",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="field-tab-active"
                    className="absolute inset-x-4 top-0 h-0.5 rounded-b-full bg-primary"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                )}
                <span className="relative">
                  <Icon className="h-5 w-5" />
                  {badge && (
                    <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                      {unread > 9 ? "9+" : unread}
                    </span>
                  )}
                </span>
                {FIELD_TAB_LABELS[item.to] ?? item.label}
                {badge && <span className="sr-only">, {unread} unread</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
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
