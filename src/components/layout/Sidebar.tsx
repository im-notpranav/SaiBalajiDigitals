import { Link, useLocation } from "@tanstack/react-router";
import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
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
  FileBarChart2,
  Users,
  ShieldCheck,
  Settings,
  Boxes,
} from "lucide-react";
import type { UserRole } from "@/lib/auth-store";
import { cn } from "@/lib/utils";
import { BrandLockup } from "@/components/brand/Logo";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const NAV: Record<UserRole, NavItem[]> = {
  EMPLOYEE: [
    { to: "/employee/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/employee/new-order", label: "New Order", icon: PlusCircle },
    { to: "/employee/orders", label: "My Orders", icon: ClipboardList },
    { to: "/employee/notifications", label: "Notifications", icon: Bell },
    { to: "/employee/profile", label: "Profile", icon: UserCircle },
  ],
  PRODUCTION: [
    { to: "/production/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/production/queue", label: "Queue", icon: Workflow },
    { to: "/production/remarks", label: "Remarks", icon: MessageSquare },
    { to: "/production/notifications", label: "Notifications", icon: Bell },
  ],
  ACCOUNTS: [
    { to: "/accountant/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/accountant/billing", label: "Billing Queue", icon: Receipt },
    { to: "/accountant/closure", label: "Order Closure", icon: Wallet },
    { to: "/accountant/reports", label: "Financial Reports", icon: FileBarChart2 },
    { to: "/accountant/financial-year", label: "Financial Year", icon: CalendarClock },
    { to: "/accountant/notifications", label: "Notifications", icon: Bell },
  ],
  ADMIN: [
    { to: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/admin/users", label: "Users", icon: Users },
    { to: "/admin/orders", label: "Orders", icon: Boxes },
    { to: "/admin/audit", label: "Audit Logs", icon: ShieldCheck },
    { to: "/admin/reports", label: "Reports", icon: FileBarChart2 },
    { to: "/admin/financial-year", label: "Financial Year", icon: CalendarClock },
    { to: "/admin/settings", label: "Settings", icon: Settings },
  ],
};

const roleLabels: Record<UserRole, string> = {
  EMPLOYEE: "Employee Portal",
  PRODUCTION: "Production Portal",
  ACCOUNTS: "Accountant Portal",
  ADMIN: "Administrator Portal",
};

export function Sidebar({ role }: { role: UserRole }) {
  const location = useLocation();
  const items = NAV[role];
  const home = items[0]!.to;

  return (
    <aside className="hidden w-72 shrink-0 flex-col border-r bg-sidebar lg:flex">
      <Link to={home} className="block border-b p-5 transition-colors hover:bg-sidebar-accent">
        <BrandLockup logoSize={44} />
      </Link>
      <div className="px-5 pt-5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
        {roleLabels[role]}
      </div>
      <nav className="flex-1 space-y-1 p-3">
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
                className={cn(
                  "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
                  active
                    ? "bg-primary/10 text-primary shadow-sm"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="sidebar-active"
                    className="absolute inset-y-1.5 left-0 w-1 rounded-r-full bg-primary"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                )}
                <Icon className="h-[18px] w-[18px]" />
                {item.label}
              </Link>
            </motion.div>
          );
        })}
      </nav>
      <div className="m-3 rounded-2xl border bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-4">
        <div className="text-xs font-semibold text-primary-deep">Enterprise ERP</div>
        <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          Production-grade Order Management, purpose-built for Sai Balaji Digitals.
        </div>
      </div>
    </aside>
  );
}
