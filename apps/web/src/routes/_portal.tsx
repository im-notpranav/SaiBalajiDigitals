import { createFileRoute, Outlet, useNavigate, useLocation } from "@tanstack/react-router";
import { useEffect } from "react";
import { FieldTabBar, PreloadNavPages, Sidebar, isFieldRole } from "@/components/layout/Sidebar";
import { cn } from "@/lib/utils";
import { TopHeader } from "@/components/layout/TopHeader";
import { useAuth, type UserRole, roleHome } from "@/lib/auth-store";

export const Route = createFileRoute("/_portal")({
  component: PortalLayout,
});

function PortalLayout() {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // On a reload the store starts empty; wait for /auth/me before deciding.
    if (isLoading) return;
    if (!user) {
      // The layout stays mounted while /login loads and sees that location too;
      // don't wrap the redirect inside another one.
      if (location.pathname === "/login") return;
      navigate({
        to: "/login",
        search: { redirect: location.href },
        replace: true,
      });
      return;
    }
    // enforce role prefix — a path section may be shared by more than one role
    // (the admin portal is also the Operation Manager's, read-only).
    const seg = location.pathname.split("/")[1];
    const pathRoleMap: Record<string, UserRole[]> = {
      employee: ["CSM"],
      production: ["PRODUCTION"],
      accountant: ["ACCOUNTS"],
      admin: ["ADMIN", "OPERATION_MANAGER"],
      "prod-manager": ["PRODUCTION_MANAGER"],
      "cost-control": ["COST_CONTROL_MANAGER"],
      field: ["PASTER", "HELPER", "DRIVER"],
    };
    const allowedRoles = seg ? pathRoleMap[seg] : undefined;

    if (allowedRoles && !allowedRoles.includes(user.role)) {
      navigate({ to: roleHome[user.role], replace: true });
    }
  }, [user, isLoading, location.pathname, location.href, navigate]);

  if (!user) return null;
  const field = isFieldRole(user.role);

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar role={user.role} />
      <PreloadNavPages role={user.role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopHeader />
        <main className="flex-1 overflow-y-auto">
          {/* No page transition: people switch pages all day, and it only delayed each one. */}
          <div
            className={cn(
              "mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8",
              // Room for the bottom tab bar (4rem plus the home-indicator inset).
              field && "pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-6 lg:pb-8",
            )}
          >
            <Outlet />
          </div>
        </main>
      </div>
      {field && <FieldTabBar />}
    </div>
  );
}
