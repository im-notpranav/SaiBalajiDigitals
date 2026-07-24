import { createFileRoute, redirect } from "@tanstack/react-router";
import { useAuth, roleHome } from "@/lib/auth-store";

export const Route = createFileRoute("/")({
  component: RedirectHome,
});

function RedirectHome() {
  const { user } = useAuth();
  if (typeof window !== "undefined") {
    if (user) {
      window.location.replace(roleHome[user.role]);
    } else {
      window.location.replace("/login");
    }
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _ = redirect;
