import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** The show / hide button inside a password box. Also used on the login page's own field. */
export function PasswordToggle({
  shown,
  onToggle,
  className,
}: {
  shown: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={shown ? "Hide password" : "Show password"}
      aria-pressed={shown}
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        className,
      )}
    >
      {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  );
}

/** A password box with an eye button to show what was typed. */
export const PasswordInput = React.forwardRef<HTMLInputElement, Omit<React.ComponentProps<"input">, "type">>(
  ({ className, ...props }, ref) => {
    const [shown, setShown] = React.useState(false);
    return (
      <div className="relative">
        <Input ref={ref} type={shown ? "text" : "password"} className={cn("pr-10", className)} {...props} />
        <PasswordToggle
          shown={shown}
          onToggle={() => setShown((v) => !v)}
          className="absolute right-1 top-1/2 -translate-y-1/2"
        />
      </div>
    );
  },
);
PasswordInput.displayName = "PasswordInput";

export const MIN_PASSWORD_LENGTH = 8;

/** True once a new password is long enough and typed the same way twice. */
export const passwordsReady = (password: string, confirm: string) =>
  password.length >= MIN_PASSWORD_LENGTH && password === confirm;

/**
 * "New password" and "Confirm password", for every place an admin sets someone's password.
 * The message under them says what is wrong; the form's submit button should stay disabled
 * until `passwordsReady` is true.
 */
export function NewPasswordFields({
  idPrefix,
  password,
  confirm,
  onPasswordChange,
  onConfirmChange,
}: {
  idPrefix: string;
  password: string;
  confirm: string;
  onPasswordChange: (v: string) => void;
  onConfirmChange: (v: string) => void;
}) {
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const differ = confirm.length > 0 && password !== confirm;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-pw`}>New password</Label>
        <PasswordInput
          id={`${idPrefix}-pw`}
          autoComplete="new-password"
          value={password}
          onChange={(e) => onPasswordChange(e.target.value)}
          placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
          aria-invalid={tooShort || undefined}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-pw2`}>Confirm password</Label>
        <PasswordInput
          id={`${idPrefix}-pw2`}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => onConfirmChange(e.target.value)}
          placeholder="Type it again"
          aria-invalid={differ || undefined}
        />
      </div>
      {/* One line kept in place, so the dialog does not jump as the message comes and goes. */}
      <p
        className={cn("min-h-4 text-xs sm:col-span-2", tooShort || differ ? "text-destructive" : "text-muted-foreground")}
        aria-live="polite"
      >
        {tooShort
          ? `Must be at least ${MIN_PASSWORD_LENGTH} characters.`
          : differ
            ? "The two passwords don't match."
            : password && !confirm
              ? "Type the password again to confirm."
              : password && password === confirm
                ? "Passwords match."
                : ""}
      </p>
    </div>
  );
}
