import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth, roleHome } from "@/lib/auth-store";
import LoginPageComponent from "@/components/LoginPage";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — Sai Balaji Digitals OMS" },
      { name: "description", content: "Sign in to the Sai Balaji Digitals Order Management System." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (user && !isLoading) {
      navigate({ to: roleHome[user.role], replace: true });
    }
  }, [user, isLoading, navigate]);

  return <LoginPageComponent />;
}
