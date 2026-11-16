import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth, postLoginPath } from "@/lib/auth-store";
import LoginPageComponent from "@/components/LoginPage";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — Sai Balaji Digitals OMS" },
      { name: "description", content: "Sign in to the Sai Balaji Digitals Order Management System." },
    ],
  }),
  // The page a signed-out user was sent away from; they go back there after sign-in.
  // `expired` is set when the app sent them here because their session ran out.
  validateSearch: (search: Record<string, unknown>): { redirect?: string; expired?: boolean } => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
    expired: search.expired === 1 || search.expired === "1" || search.expired === true ? true : undefined,
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { redirect, expired } = Route.useSearch();
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (user && !isLoading) {
      navigate({ to: postLoginPath(user, redirect), replace: true });
    }
  }, [user, isLoading, redirect, navigate]);

  return <LoginPageComponent expired={expired} />;
}
