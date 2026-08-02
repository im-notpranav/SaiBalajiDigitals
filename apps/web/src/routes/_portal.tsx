import { createFileRoute, Outlet, useNavigate, useLocation } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopHeader } from "@/components/layout/TopHeader";
import { useAuth, type UserRole, roleHome } from "@/lib/auth-store";

export const Route = createFileRoute("/_portal")({
  component: PortalLayout,
});

function PortalLayout() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!user) {
      navigate({ to: "/login", replace: true });
      return;
    }
    // enforce role prefix
    const seg = location.pathname.split("/")[1];
    const pathRoleMap: Record<string, UserRole> = {
      employee: "EMPLOYEE",
      production: "PRODUCTION",
      accountant: "ACCOUNTS",
      admin: "ADMIN",
      operator: "OPERATOR",
    };
    const currentPathRole = seg ? pathRoleMap[seg] : undefined;
    
    if (currentPathRole && currentPathRole !== user.role) {
      navigate({ to: roleHome[user.role], replace: true });
    }
  }, [user, location.pathname, navigate]);

  if (!user) return null;

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar role={user.role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopHeader />
        <main className="flex-1 overflow-y-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8"
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
