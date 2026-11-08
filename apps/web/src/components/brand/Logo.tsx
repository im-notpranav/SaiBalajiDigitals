import { cn } from "@/lib/utils";

interface LogoProps {
  size?: number;
  className?: string;
}

/**
 * The logo artwork for both themes. `logo.png` sits on solid white with black lettering, so
 * dark mode swaps to a cut-out with light lettering. `mark` drops the "Digitals" word, which
 * cannot be read below about 64px and turns into a smudge.
 */
export function LogoImage({
  mark = false,
  alt = "Sai Balaji Digitals",
  className,
}: {
  mark?: boolean;
  alt?: string;
  className?: string;
}) {
  return (
    <>
      <img src="/logo.png" alt={alt} className={cn("object-cover dark:hidden", className)} />
      <img
        src={mark ? "/logo-dark-mark.webp" : "/logo-dark.webp"}
        alt={alt}
        className={cn("hidden object-contain dark:block", className)}
      />
    </>
  );
}

export function Logo({ size = 40, className }: LogoProps) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xl shadow-sm dark:rounded-none dark:shadow-none",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <LogoImage mark={size < 64} className="h-full w-full" />
    </div>
  );
}

interface BrandLockupProps {
  compact?: boolean;
  logoSize?: number;
  className?: string;
}

export function BrandLockup({ compact = false, logoSize = 40, className }: BrandLockupProps) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <Logo size={logoSize} />
      <div className="min-w-0 leading-tight">
        <div className="truncate text-[13px] font-bold tracking-wide text-primary-deep sm:text-sm dark:text-foreground">
          SAI BALAJI DIGITALS
        </div>
        {!compact && (
          <div className="truncate text-[11px] text-muted-foreground">
            Where <span className="font-medium text-primary">Excellence</span> meets{" "}
            <span className="font-medium text-brand-orange">precision</span>
          </div>
        )}
      </div>
    </div>
  );
}
