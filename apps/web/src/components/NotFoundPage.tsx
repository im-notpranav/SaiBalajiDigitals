import { motion, useReducedMotion } from "framer-motion";
import { Link, useLocation, useRouter } from "@tanstack/react-router";
import { ArrowLeft, LayoutDashboard, LogIn } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { useAuth, roleHome } from "@/lib/auth-store";

export function NotFoundPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { pathname } = useLocation();
  const reduceMotion = useReducedMotion();

  // Signed-in users go back to their own portal; "/" would only bounce them there anyway.
  const home = user ? roleHome[user.role] : "/login";

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-12">
      {/* The two arcs of the logo, oversized and faint, framing the page. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <motion.div
          className="absolute h-[680px] w-[680px] rounded-full border-[18px] border-primary/10 border-r-transparent"
          animate={reduceMotion ? undefined : { rotate: 360 }}
          transition={{ duration: 60, repeat: Infinity, ease: "linear" }}
        />
        <motion.div
          className="absolute h-[520px] w-[520px] rounded-full border-[14px] border-brand-orange/15 border-l-transparent"
          animate={reduceMotion ? undefined : { rotate: -360 }}
          transition={{ duration: 45, repeat: Infinity, ease: "linear" }}
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="glass-card relative w-full max-w-md rounded-3xl p-8 text-center sm:p-10"
      >
        <Logo size={56} className="mx-auto bg-white" />

        <h1 className="brand-gradient-text mt-6 text-7xl font-extrabold tabular-nums tracking-tight sm:text-8xl">
          404
        </h1>
        <h2 className="mt-3 text-xl font-semibold tracking-tight">This page isn't on the order book</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The link may be mistyped, or the page has moved. Nothing has been lost — your orders are right
          where you left them.
        </p>

        <code className="mx-auto mt-5 block max-w-full truncate rounded-lg border bg-muted/50 px-3 py-1.5 font-mono text-xs text-muted-foreground">
          {pathname}
        </code>

        <div className="mt-8 flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={() => router.history.back()}
            className="inline-flex items-center justify-center gap-2 rounded-xl border bg-background px-5 py-2.5 text-sm font-medium transition hover:bg-accent"
          >
            <ArrowLeft className="h-4 w-4" />
            Go back
          </button>
          <Link
            to={home}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-soft transition hover:opacity-90"
          >
            {user ? <LayoutDashboard className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
            {user ? "Back to dashboard" : "Go to login"}
          </Link>
        </div>
      </motion.div>
    </div>
  );
}
