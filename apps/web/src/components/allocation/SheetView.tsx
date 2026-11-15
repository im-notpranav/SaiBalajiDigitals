import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Maximize2, Minimize2, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { ErrorState } from "@/components/layout/PageStates";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchAllocationSheet } from "@/api/allocationSheet";
import { WasMark } from "@/components/brand/WasMark";

/** Shared with the Settings card, so saving a new link updates this page at once. */
export const allocationSheetQuery = {
  queryKey: ["allocation-sheet"],
  queryFn: fetchAllocationSheet,
  staleTime: 5 * 60_000,
} as const;

/** Past this, a frame that still has not loaded is most likely waiting on a Google sign-in. */
const SLOW_MS = 12_000;

/**
 * Work Allocation's Sheet View: the team's own Google Sheet, live, inside the app. Google decides
 * who may see or edit it, so it shows only to someone signed in to a Google account with access in
 * this browser. Phones (and browsers that block Google's sign-in inside a frame) open it in
 * Google Sheets instead, so that button is always on screen.
 *
 * The page takes the whole width and height under the app header (the portal layout drops its
 * usual width cap here), and Full screen lays the sheet over the whole app. The frame is the same
 * element in both, so switching never reloads the sheet.
 */
export function SheetView() {
  const { data, error, refetch } = useQuery(allocationSheetQuery);
  const src = data?.embed_url ?? null;
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);
  const [full, setFull] = useState(false);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    setLoaded(false);
    setSlow(false);
    if (!src) return;
    const timer = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(timer);
  }, [src, reloads]);

  // The portal layout locks the page to the screen here; this also stops the browser's bounce
  // and pull-to-refresh, so a scroll that reaches the sheet's end goes nowhere else.
  useEffect(() => {
    const root = document.documentElement;
    const before = root.style.overscrollBehavior;
    root.style.overscrollBehavior = "none";
    return () => {
      root.style.overscrollBehavior = before;
    };
  }, []);

  // Esc leaves full screen; the page behind does not scroll while the sheet covers it.
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [full]);

  const open = data ? (
    <Button asChild size="sm" className="rounded-xl">
      <a href={data.url} target="_blank" rel="noopener noreferrer">
        <ExternalLink className="h-4 w-4 sm:mr-1.5" aria-hidden />
        <span className="sr-only sm:not-sr-only">Open in Google Sheets</span>
      </a>
    </Button>
  ) : (
    // Same size while the link loads, so the header does not shift when it arrives.
    <Button size="sm" className="rounded-xl" disabled>
      <ExternalLink className="h-4 w-4 sm:mr-1.5" aria-hidden />
      <span className="sr-only sm:not-sr-only">Open in Google Sheets</span>
    </Button>
  );

  const tools = (
    <>
      <Button
        variant="outline"
        size="sm"
        className="rounded-xl"
        disabled={!src}
        onClick={() => setReloads((n) => n + 1)}
        title="Reload the sheet (after signing in to Google, say)"
      >
        <RotateCw className="h-4 w-4 sm:mr-1.5" aria-hidden />
        <span className="sr-only sm:not-sr-only">Reload</span>
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="rounded-xl"
        disabled={!src}
        onClick={() => setFull((f) => !f)}
        aria-pressed={full}
        title={full ? "Exit full screen (Esc)" : "Show the sheet over the whole app"}
      >
        {full ? (
          <Minimize2 className="h-4 w-4 sm:mr-1.5" aria-hidden />
        ) : (
          <Maximize2 className="h-4 w-4 sm:mr-1.5" aria-hidden />
        )}
        <span className="sr-only sm:not-sr-only">{full ? "Exit full screen" : "Full screen"}</span>
      </Button>
      {open}
    </>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex items-center gap-2 sm:mb-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold tracking-tight sm:text-xl"><WasMark kind="GS" className="font-bold" /></h1>
          <p className="hidden truncate text-xs text-muted-foreground sm:block">
            The team's Google Sheet, live. Sign in to Google in this browser to see and edit it.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">{tools}</div>
      </div>

      {/* Fills the rest of the page, so the sheet scrolls inside itself. */}
      <div
        className={cn(
          "relative flex min-h-[18rem] flex-1 flex-col overflow-hidden",
          full ? "fixed inset-0 z-[70] bg-background" : "surface-panel",
        )}
        role={full ? "dialog" : undefined}
        aria-modal={full || undefined}
        aria-label={full ? "GS-WAS, full screen" : undefined}
      >
        {full && (
          <div className="flex shrink-0 items-center gap-2 border-b bg-card/90 px-2 py-1.5 pt-[max(0.375rem,env(safe-area-inset-top))] backdrop-blur">
            <WasMark kind="GS" className="min-w-0 flex-1 truncate px-1 text-sm" />
            {tools}
          </div>
        )}
        <div className="relative min-h-0 flex-1">
          {error && !data ? (
            <ErrorState
              bare
              title="Couldn't load the sheet link"
              error={error}
              onRetry={() => refetch()}
              className="h-full justify-center"
            />
          ) : (
            <>
              {!loaded && <SheetSkeleton slow={slow} url={data?.url} />}
              {src && (
                <iframe
                  key={`${src}#${reloads}`}
                  src={src}
                  title="Work allocation Google Sheet"
                  allow="clipboard-read; clipboard-write; fullscreen"
                  allowFullScreen
                  onLoad={() => setLoaded(true)}
                  className={cn(
                    "absolute inset-0 h-full w-full border-0 bg-card transition-opacity duration-300",
                    loaded ? "opacity-100" : "opacity-0",
                  )}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Rows and columns in the shape of a sheet, until Google's page arrives. */
function SheetSkeleton({ slow, url }: { slow: boolean; url?: string }) {
  return (
    <div className="absolute inset-0 overflow-hidden" role="status" aria-live="polite">
      <span className="sr-only">Loading the sheet…</span>
      <div className="grid gap-2 p-3" aria-hidden>
        <div className="flex gap-2 pb-1">
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-6 w-16" />
        </div>
        {Array.from({ length: 16 }, (_, r) => (
          <div
            key={r}
            className="grid grid-cols-[2rem_repeat(3,minmax(0,1fr))] gap-2 sm:grid-cols-[2.5rem_repeat(6,minmax(0,1fr))]"
          >
            {Array.from({ length: 7 }, (_, c) => (
              <Skeleton
                key={c}
                className={cn("h-5", c > 3 && "hidden sm:block", r === 0 && "bg-primary/15")}
              />
            ))}
          </div>
        ))}
      </div>
      {slow && url && (
        <div className="absolute inset-x-3 top-1/3 mx-auto max-w-sm rounded-xl border bg-card p-4 text-center text-sm shadow-lg">
          <p className="font-medium">The sheet is taking a while.</p>
          <p className="mt-1 text-muted-foreground">
            It may need a Google sign-in, which works best in Google Sheets itself.
          </p>
          <Button asChild variant="outline" size="sm" className="mt-3 rounded-xl">
            <a href={url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-1.5 h-4 w-4" aria-hidden /> Open in Google Sheets
            </a>
          </Button>
        </div>
      )}
    </div>
  );
}
