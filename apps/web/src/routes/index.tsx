import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { BrandLoader } from "@/components/brand/BrandLoader";
import { useAuth, roleHome } from "@/lib/auth-store";

export const Route = createFileRoute("/")({
  component: RedirectHome,
});

function RedirectHome() {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!isLoading) navigate({ to: user ? roleHome[user.role] : "/login", replace: true });
  }, [user, isLoading, navigate]);
  return <BrandLoader />;
}
