import { useEffect, useSyncExternalStore } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { CalendarRange, FileSpreadsheet } from "lucide-react";
import { type UserRole, useAuth } from "@/lib/auth-store";
import { cn } from "@/lib/utils";

/**
 * The switch at the top of the sidebar between the two ways of looking at work allocation:
 * the Live Grid (the app's own grid) and the Sheet View (the team's Google Sheet in the app).
 * Field staff get both too (for now), the sheet at the shared /sheet page. Roles outside work
 * allocation get no switch; Sheet View is in their menu instead.
 */

type View = "live" | "sheet";

const PATHS: Partial<Record<UserRole, { live: string; sheet?: string }>> = {
  ADMIN: { live: "/admin/grid", sheet: "/admin/sheet" },
  OPERATION_MANAGER: { live: "/admin/grid", sheet: "/admin/sheet" },
  CSM: { live: "/employee/grid", sheet: "/employee/sheet" },
  PASTER: { live: "/field/grid", sheet: "/sheet" },
  HELPER: { live: "/field/grid", sheet: "/sheet" },
  DRIVER: { live: "/field/grid", sheet: "/sheet" },
};

const VIEWS: { view: View; label: string; icon: LucideIcon }[] = [
  { view: "live", label: "Live Grid", icon: CalendarRange },
  { view: "sheet", label: "Sheet View", icon: FileSpreadsheet },
];

// Each person's last choice, per browser. Both sidebars (the rail and the phone drawer) read it
// through one store, and an event tells them when it changes.
const CHANGED = "sbd:allocation-view";
const storageKey = (userId: number) => `sbd:allocation-view:${userId}`;

function readView(userId: number): View {
  try {
    return localStorage.getItem(storageKey(userId)) === "sheet" ? "sheet" : "live";
  } catch {
    return "live";
  }
}

function saveView(userId: number, view: View) {
  try {
    if (readView(userId) === view) return;
    localStorage.setItem(storageKey(userId), view);
    window.dispatchEvent(new Event(CHANGED));
  } catch {
    /* Private mode or storage full: the switch still works, it just won't remember. */
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function AllocationSwitch({
  role,
  layoutGroup,
  onNavigate,
}: {
  role: UserRole;
  /** Keeps the sliding highlight of the rail and of the phone drawer apart. */
  layoutGroup: string;
  onNavigate?: () => void;
}) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const userId = user?.id ?? 0;
  const saved = useSyncExternalStore(
    subscribe,
    () => readView(userId),
    () => "live" as View,
  );
  const paths = PATHS[role];
  const on = (to?: string) => !!to && (pathname === to || pathname.startsWith(to + "/"));
  const here: View | null = on(paths?.live) ? "live" : on(paths?.sheet) ? "sheet" : null;

  // Opening either page, by this switch or any other link, is the person's latest choice.
  useEffect(() => {
    if (here && userId) saveView(userId, here);
  }, [here, userId]);

  if (!paths) return null;

  if (!paths.sheet) {
    return (
      <div className="shrink-0 px-3 pt-3">
        <Link
          to={paths.live}
          onClick={onNavigate}
          aria-current={here ? "page" : undefined}
          className={cn(
            "flex min-h-10 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-medium transition-colors",
            here
              ? "border-primary/40 bg-primary/10 text-primary"
              : "bg-muted/40 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          )}
        >
          <CalendarRange className="h-4 w-4 shrink-0" aria-hidden />
          Live Grid
        </Link>
      </div>
    );
  }

  // On one of the two pages that one is highlighted; anywhere else, the last one chosen.
  const selected = here ?? saved;
  const to = { live: paths.live, sheet: paths.sheet };
  return (
    <nav aria-label="Work allocation view" className="shrink-0 px-3 pt-3">
      <div className="grid grid-cols-2 gap-1 rounded-xl border bg-muted/40 p-1 text-sm">
        {VIEWS.map(({ view, label, icon: Icon }) => {
          const isSelected = selected === view;
          return (
            <Link
              key={view}
              to={to[view]}
              onClick={() => {
                if (userId) saveView(userId, view);
                onNavigate?.();
              }}
              aria-current={here === view ? "page" : undefined}
              className={cn(
                "relative z-0 flex min-h-9 min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 font-medium transition-colors",
                isSelected
                  ? here
                    ? "text-primary"
                    : "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {isSelected && (
                <motion.span
                  layoutId={`${layoutGroup}-allocation-view`}
                  className="absolute inset-0 -z-10 rounded-lg bg-background shadow-sm"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="truncate">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
