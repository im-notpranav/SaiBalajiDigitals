import { cn } from "@/lib/utils";

/**
 * The logo built from its parts (public/logo-parts). `play` runs the assembly once: arcs swing
 * in, the cube's halves slide together and click, the word settles. After that, and always
 * when `play` is off, the arcs sway gently. Styles live in public/brand-logo.css so the
 * index.html splash shares them.
 */
export function AssemblingLogo({
  size,
  play = true,
  word = true,
  className,
}: {
  /** In px. Leave out to size it with `className` (responsive Tailwind sizes). */
  size?: number;
  play?: boolean;
  /** "Digitals" under the cube; too small to read below about 64px. */
  word?: boolean;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn("sb-logo sb-idle", play && "sb-play", className)}
      style={size ? { width: size, height: size } : undefined}
    >
      <i className="sb-float">
        <i className="sb-sway-a">
          <i className="sb-part sb-arc-blue" />
        </i>
        <i className="sb-sway-b">
          <i className="sb-part sb-arc-orange" />
        </i>
        <i className="sb-cube">
          <i className="sb-part sb-cube-left" />
          <i className="sb-part sb-cube-right" />
        </i>
        <i className="sb-part sb-shadow" />
        {word && <i className="sb-part sb-word" />}
      </i>
    </div>
  );
}

/**
 * Whole-page wait (the sign-in check). Looks exactly like the index.html splash, so if one
 * hands over to the other nothing moves.
 */
export function BrandLoader({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="sb-splash">
      <AssemblingLogo size={128} />
      <span className="sb-bar" aria-hidden />
      <span className="sr-only">{label}</span>
    </div>
  );
}

/** In-page wait: no assembly (a quick load would cut it off half-built), just the swaying mark. */
export function InlineBrandLoader({ label = "Loading", className }: { label?: string; className?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-col items-center justify-center gap-3 p-10 text-sm text-muted-foreground animate-[sb-fade_0.3s_0.15s_both]",
        className,
      )}
    >
      <AssemblingLogo size={56} play={false} word={false} />
      <span>{label}</span>
    </div>
  );
}
