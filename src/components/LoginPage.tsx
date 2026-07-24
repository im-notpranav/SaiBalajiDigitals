import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "@tanstack/react-router";
import {
  User,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  Loader2,
  Check,
  AlertCircle,
} from "lucide-react";
import { useAuth, roleHome } from "@/lib/auth-store";

type FieldState = "idle" | "error" | "success";

const easeOutExpo = [0.16, 1, 0.3, 1] as const;

export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [usernameState, setUsernameState] = useState<FieldState>("idle");
  const [passwordState, setPasswordState] = useState<FieldState>("idle");
  const [usernameShake, setUsernameShake] = useState(0);
  const [passwordShake, setPasswordShake] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    let ok = true;
    if (username.trim().length < 3) {
      setUsernameState("error");
      setUsernameShake((n) => n + 1);
      ok = false;
    } else {
      setUsernameState("success");
    }
    if (password.length < 4) {
      setPasswordState("error");
      setPasswordShake((n) => n + 1);
      ok = false;
    } else {
      setPasswordState("success");
    }
    if (!ok) return;

    try {
      setSubmitting(true);
      const user = await login(username, password);
      setSuccess(true);
      setTimeout(() => navigate({ to: roleHome[user.role] }), 500);
    } catch (err) {
      setSubmitting(false);
      setFormError(err instanceof Error ? err.message : "Sign in failed");
      setUsernameState("error");
      setPasswordState("error");
      setPasswordShake((n) => n + 1);
    }
  };

  return (
    <main className="relative min-h-screen w-full overflow-hidden bg-white text-slate-900 antialiased">
      {/* Background */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(1000px 700px at 15% 20%, rgba(10,123,232,0.08), transparent 60%), radial-gradient(900px 600px at 85% 10%, rgba(245,163,0,0.07), transparent 60%), radial-gradient(1200px 800px at 50% 120%, rgba(0,87,194,0.08), transparent 60%)",
          }}
        />
        <motion.svg
          className="absolute -left-40 -bottom-40 h-[700px] w-[700px]"
          viewBox="0 0 600 600"
          animate={{ y: [0, -12, 0], x: [0, 6, 0] }}
          transition={{ duration: 25, repeat: Infinity, ease: "easeInOut" }}
        >
          <defs>
            <linearGradient id="blueWave" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#0057C2" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#0A7BE8" stopOpacity="0.15" />
            </linearGradient>
          </defs>
          <path
            fill="url(#blueWave)"
            d="M0,600 C120,520 220,520 320,470 C440,410 520,300 600,260 L600,600 Z"
          />
        </motion.svg>
        <motion.svg
          className="absolute -top-40 -right-40 h-[600px] w-[600px]"
          viewBox="0 0 600 600"
          animate={{ y: [0, 10, 0], rotate: [0, 1.5, 0] }}
          transition={{ duration: 25, repeat: Infinity, ease: "easeInOut" }}
        >
          <defs>
            <linearGradient id="orangeArc" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#F5A300" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#FDBA2D" stopOpacity="0.05" />
            </linearGradient>
          </defs>
          <path
            fill="url(#orangeArc)"
            d="M300,0 C420,60 500,160 540,300 C560,380 520,460 460,500 C480,380 440,240 360,160 C320,120 260,80 300,0 Z"
          />
        </motion.svg>
      </div>

      <div className="relative z-10 flex min-h-screen flex-col">
        {/* Header */}
        <motion.header
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: easeOutExpo, delay: 0.1 }}
          className="flex shrink-0 items-center px-4 py-4 sm:px-8 lg:px-12"
        >
          <div className="flex min-w-0 items-center gap-3">
            <img
              src={"/logo.png"}
              alt="Sai Balaji Digitals"
              className="h-10 w-10 shrink-0 rounded-full object-cover sm:h-12 sm:w-12"
            />
            <div className="min-w-0">
              <h2 className="truncate text-sm font-extrabold tracking-tight text-[#0057C2] sm:text-base lg:text-lg">
                SAI BALAJI DIGITALS PVT LTD
              </h2>
              <p className="hidden text-xs text-slate-500 sm:block">
                Where <span className="font-semibold text-[#0A7BE8]">Excellence</span>{" "}
                meets <span className="font-semibold text-[#F5A300]">precision</span>
              </p>
            </div>
          </div>
        </motion.header>

        <section className="mx-auto grid w-full max-w-[1400px] flex-1 grid-cols-1 items-center gap-8 px-4 pb-8 sm:px-8 lg:grid-cols-2 lg:px-12">
          {/* Hero */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.3, ease: easeOutExpo }}
            className="flex flex-col items-center justify-center text-center"
          >
            <motion.img
              src={"/logo.png"}
              alt="Sai Balaji Digitals logo"
              className="h-32 w-32 rounded-full object-cover drop-shadow-[0_20px_50px_rgba(10,123,232,0.2)] sm:h-40 sm:w-40 lg:h-52 lg:w-52"
              animate={{ y: [-6, 6, -6] }}
              transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.7, ease: easeOutExpo }}
              className="mt-6 text-3xl font-bold tracking-tight text-[#0F172A] sm:text-4xl"
            >
              Welcome Back
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.85, ease: easeOutExpo }}
              className="mt-2 max-w-sm text-sm text-slate-500 sm:text-base"
            >
              Sign in to your Order Management workspace
            </motion.p>
            <motion.div
              initial={{ opacity: 0, scaleX: 0 }}
              animate={{ opacity: 1, scaleX: 1 }}
              transition={{ duration: 0.6, delay: 1.0, ease: easeOutExpo }}
              className="mt-5 flex items-center gap-1.5"
            >
              <span className="h-1 w-10 rounded-full bg-[#0A7BE8]" />
              <span className="h-1 w-10 rounded-full bg-[#F5A300]" />
            </motion.div>

          </motion.div>

          {/* Login card */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.4, ease: easeOutExpo }}
            className="flex w-full items-center justify-center"
          >
            <div
              className="mx-auto w-full max-w-[460px] rounded-2xl bg-white/80 p-7 backdrop-blur-xl sm:p-9"
              style={{ boxShadow: "0 25px 60px rgba(15,23,42,0.08)" }}
            >
              <div className="text-center">
                <h2 className="text-xl font-bold tracking-tight text-[#0F172A] sm:text-2xl">
                  Sign in to your account
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Enter your credentials to continue
                </p>
              </div>

              <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
                <FormField
                  label="Username"
                  delay={0.9}
                  shakeKey={usernameShake}
                  state={usernameState}
                  error={usernameState === "error" && !formError ? "Please enter your username" : ""}
                >
                  <InputWithIcon
                    icon={<User className="h-4 w-4" />}
                    type="text"
                    placeholder="Enter your username"
                    value={username}
                    autoComplete="username"
                    aria-label="Username"
                    state={usernameState}
                    onChange={(e) => {
                      setUsername(e.target.value);
                      if (usernameState !== "idle") setUsernameState("idle");
                      if (formError) setFormError(null);
                    }}
                  />
                </FormField>

                <FormField
                  label="Password"
                  delay={1.0}
                  shakeKey={passwordShake}
                  state={passwordState}
                  error={passwordState === "error" && !formError ? "Enter your password" : ""}
                  rightSlot={
                    <div className="mt-1.5 flex justify-end">
                      <button
                        type="button"
                        className="text-xs font-medium text-[#0A7BE8] transition-colors hover:text-[#0057C2] hover:underline"
                      >
                        Forgot Password?
                      </button>
                    </div>
                  }
                >
                  <InputWithIcon
                    icon={<Lock className="h-4 w-4" />}
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    value={password}
                    autoComplete="current-password"
                    aria-label="Password"
                    state={passwordState}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (passwordState !== "idle") setPasswordState("idle");
                      if (formError) setFormError(null);
                    }}
                    rightIcon={
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    }
                  />
                </FormField>

                <AnimatePresence>
                  {formError && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-600"
                    >
                      <AlertCircle className="h-4 w-4" /> {formError}
                    </motion.div>
                  )}
                </AnimatePresence>

                <motion.button
                  type="submit"
                  disabled={submitting || success}
                  whileHover={submitting || success ? {} : { scale: 1.01, y: -1 }}
                  whileTap={submitting || success ? {} : { scale: 0.985 }}
                  className="group relative mt-2 flex h-11 w-full items-center justify-center gap-2 overflow-hidden rounded-xl text-sm font-semibold text-white shadow-[0_10px_30px_rgba(10,123,232,0.35)] transition-shadow duration-300 hover:shadow-[0_18px_40px_rgba(10,123,232,0.45)] disabled:opacity-90"
                  style={{
                    backgroundImage:
                      "linear-gradient(120deg, #0A7BE8 0%, #0057C2 50%, #003d99 100%)",
                  }}
                >
                  {success ? (
                    <>
                      <Check className="h-4 w-4" /> Signed in
                    </>
                  ) : submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Signing in...
                    </>
                  ) : (
                    <>
                      Sign in
                      <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
                    </>
                  )}
                </motion.button>
              </form>
            </div>
          </motion.div>
        </section>
      </div>
    </main>
  );
}

function FormField({
  label,
  children,
  delay,
  state,
  error,
  shakeKey,
  rightSlot,
}: {
  label: string;
  children: React.ReactNode;
  delay: number;
  state: FieldState;
  error?: string;
  shakeKey: number;
  rightSlot?: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: easeOutExpo }}
    >
      <label className="mb-1.5 block text-xs font-semibold text-[#0F172A]">{label}</label>
      <motion.div
        key={shakeKey}
        animate={
          state === "error" && shakeKey > 0
            ? { x: [0, -8, 8, -6, 6, -3, 3, 0] }
            : { x: 0 }
        }
        transition={{ duration: 0.45 }}
      >
        {children}
      </motion.div>
      <AnimatePresence>
        {state === "error" && error && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="mt-1 text-[11px] font-medium text-red-500"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>
      {rightSlot}
    </motion.div>
  );
}

function InputWithIcon({
  icon,
  rightIcon,
  state = "idle",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  icon: React.ReactNode;
  rightIcon?: React.ReactNode;
  state?: FieldState;
}) {
  const borderClass =
    state === "error"
      ? "border-red-400 focus-within:border-red-500 focus-within:ring-red-100"
      : state === "success"
        ? "border-emerald-400 focus-within:border-emerald-500 focus-within:ring-emerald-100"
        : "border-slate-200 hover:border-slate-300 focus-within:border-[#0A7BE8] focus-within:ring-[#0A7BE8]/15";

  return (
    <div
      className={`group flex h-11 items-center gap-2.5 rounded-xl border bg-white px-3 transition-all duration-200 focus-within:ring-4 ${borderClass}`}
    >
      <span className="text-slate-400 transition-colors group-focus-within:text-[#0A7BE8]">
        {icon}
      </span>
      <input
        {...props}
        className="flex-1 bg-transparent text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none"
      />
      {state === "success" && (
        <motion.span
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white"
        >
          <Check className="h-3 w-3" />
        </motion.span>
      )}
      {rightIcon}
    </div>
  );
}
