import { useState } from "react";
import { Check, ChevronLeft, ChevronRight, Minus, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FIELD_ROLE_LABELS, type FieldRole } from "@/api/allocation";

/** Mirrors TEAM_LIMITS in the API (utils/work-allocation.ts). */
export const TEAM_LIMITS: Record<FieldRole, number> = { PASTER: 2, HELPER: 2, DRIVER: 1 };
export const TEAM_ROLES: FieldRole[] = ["PASTER", "HELPER", "DRIVER"];
/** What a new job asks for until the manager says otherwise. */
export const DEFAULT_NEEDED: Record<FieldRole, number> = { PASTER: 2, HELPER: 1, DRIVER: 1 };

type Step = FieldRole | "REVIEW";
type Person = { id: number; name: string; role: FieldRole; emp_code: string | null };

const plural = (role: FieldRole, n: number) =>
  `${FIELD_ROLE_LABELS[role].toLowerCase()}${n === 1 ? "" : "s"}`;

/** True when every role has exactly the number of people it needs, and someone is on it. */
export function teamComplete(needed: Record<FieldRole, number>, count: (r: FieldRole) => number) {
  return TEAM_ROLES.every((r) => count(r) === needed[r]) && TEAM_ROLES.some((r) => needed[r] > 0);
}

/** "Pick 1 more helper", for the save button's hint; null when the team is complete. */
export function teamShortfall(
  needed: Record<FieldRole, number>,
  count: (r: FieldRole) => number,
): string | null {
  if (!TEAM_ROLES.some((r) => needed[r] > 0)) return "A job needs at least one person.";
  const role = TEAM_ROLES.find((r) => count(r) !== needed[r]);
  if (!role) return null;
  const gap = needed[role] - count(role);
  return gap > 0
    ? `Pick ${gap} more ${plural(role, gap)}, or lower the number needed.`
    : `Untick ${-gap} ${plural(role, -gap)}.`;
}

/**
 * Picks the team one role at a time: Pasters, then Helpers, then Drivers. Each step says
 * how many are needed (0 skips the role); filling a step moves on to the next role that
 * needs someone, and any step can be reopened without losing the picks made elsewhere.
 */
export function TeamStepper({
  staff,
  selected,
  needed,
  busy,
  onLeave,
  onToggle,
  onNeededChange,
}: {
  staff: Person[];
  selected: number[];
  needed: Record<FieldRole, number>;
  busy: Map<number, string[]>;
  onLeave: Map<number, string>;
  onToggle: (id: number, role: FieldRole, on: boolean) => void;
  onNeededChange: (role: FieldRole, n: number) => void;
}) {
  const chosen = staff.filter((s) => selected.includes(s.id));
  const count = (r: FieldRole) => chosen.filter((s) => s.role === r).length;
  const done = (r: FieldRole) => count(r) === needed[r];
  const [step, setStep] = useState<Step>(() => TEAM_ROLES.find((r) => !done(r)) ?? "REVIEW");
  const [q, setQ] = useState("");

  /** The next role after `role` that still needs someone (then any earlier one), else the review. */
  const after = (role: FieldRole, isDone: (r: FieldRole) => boolean = done): Step =>
    TEAM_ROLES.slice(TEAM_ROLES.indexOf(role) + 1).find((r) => !isDone(r)) ??
    TEAM_ROLES.find((r) => r !== role && !isDone(r)) ??
    "REVIEW";
  const go = (s: Step) => {
    setStep(s);
    setQ("");
  };

  const pick = (s: Person, on: boolean) => {
    onToggle(s.id, s.role, on);
    // Filling the step moves on; reopening a full step to look does not.
    if (on && count(s.role) + 1 === needed[s.role]) {
      go(after(s.role, (r) => (r === s.role ? true : done(r))));
    }
  };

  const role = step === "REVIEW" ? null : step;
  const match = (s: Person) =>
    `${s.name} ${s.emp_code ?? ""}`.toLowerCase().includes(q.trim().toLowerCase());
  // Free people first, then busy, then on leave, so the obvious picks are on top.
  const rank = (id: number) => (onLeave.has(id) ? 2 : busy.has(id) ? 1 : 0);
  const people = role
    ? staff
        .filter((s) => s.role === role && (selected.includes(s.id) || match(s)))
        .sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name))
    : [];

  return (
    <div className="rounded-xl border">
      {/* Steps: where you are, and what each role still needs. */}
      <ol className="grid grid-cols-4 border-b text-xs" aria-label="Team steps">
        {[...TEAM_ROLES, "REVIEW" as const].map((s, i) => {
          const isRole = s !== "REVIEW";
          const complete = isRole ? done(s) : teamComplete(needed, count);
          const skipped = isRole && needed[s] === 0;
          return (
            <li key={s} className={cn(i > 0 && "border-l")}>
              <button
                type="button"
                onClick={() => go(s)}
                aria-current={step === s ? "step" : undefined}
                className={cn(
                  "flex h-full w-full min-w-0 flex-col items-center gap-0.5 px-1 py-2 text-center transition-colors",
                  step === s ? "bg-primary/10 text-primary" : "hover:bg-muted/50",
                )}
              >
                <span className="flex max-w-full items-center gap-1 font-medium">
                  {complete && !skipped && <Check className="h-3.5 w-3.5 shrink-0" />}
                  <span className="truncate">{isRole ? `${FIELD_ROLE_LABELS[s]}s` : "Review"}</span>
                </span>
                <span
                  className={cn(
                    "tabular-nums",
                    step === s ? "text-primary/80" : "text-muted-foreground",
                  )}
                >
                  {isRole
                    ? skipped
                      ? "Not needed"
                      : `${count(s)} of ${needed[s]}`
                    : `${chosen.length} ${chosen.length === 1 ? "person" : "people"}`}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {role ? (
        <div className="grid gap-3 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 text-sm">
              <div className="font-medium">{FIELD_ROLE_LABELS[role]}s needed</div>
              <div className="text-xs text-muted-foreground">
                {needed[role] === 0
                  ? `This job needs no ${plural(role, 2)}.`
                  : done(role)
                    ? `All ${needed[role]} picked.`
                    : `Pick ${needed[role] - count(role)} more.`}
              </div>
            </div>
            <div
              className="flex items-center gap-1"
              role="group"
              aria-label={`${FIELD_ROLE_LABELS[role]}s needed`}
            >
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9"
                aria-label={`One fewer ${FIELD_ROLE_LABELS[role].toLowerCase()}`}
                disabled={needed[role] === 0}
                onClick={() => onNeededChange(role, needed[role] - 1)}
              >
                <Minus className="h-4 w-4" />
              </Button>
              <span
                className="w-8 text-center text-lg font-semibold tabular-nums"
                aria-live="polite"
              >
                {needed[role]}
              </span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9"
                aria-label={`One more ${FIELD_ROLE_LABELS[role].toLowerCase()}`}
                disabled={needed[role] >= TEAM_LIMITS[role]}
                onClick={() => onNeededChange(role, needed[role] + 1)}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {needed[role] > 0 && (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={`Search ${plural(role, 2)} by name or code`}
                  className="h-9 pl-9"
                />
              </div>
              <div className="grid max-h-64 gap-1 overflow-y-auto sm:grid-cols-2">
                {people.length === 0 && (
                  <div className="px-2 py-1 text-xs text-muted-foreground">Nobody matches.</div>
                )}
                {people.map((s) => {
                  const on = selected.includes(s.id);
                  const jobs = busy.get(s.id);
                  const leave = onLeave.get(s.id);
                  // A full step takes nobody new; someone on the team can always come off.
                  const locked = (!!leave || done(role)) && !on;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      aria-pressed={on}
                      disabled={locked}
                      onClick={() => pick(s, !on)}
                      className={cn(
                        "flex min-w-0 items-start gap-2 rounded-lg border px-2.5 py-2 text-left text-sm transition-colors",
                        on ? "border-primary/50 bg-primary/10" : "border-transparent",
                        locked ? "cursor-not-allowed opacity-50" : !on && "hover:bg-muted/50",
                      )}
                    >
                      <span
                        className={cn(
                          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                          on ? "border-primary bg-primary text-primary-foreground" : "border-input",
                        )}
                      >
                        {on && <Check className="h-3 w-3" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium" title={s.name}>
                          {s.name}
                        </span>
                        {leave ? (
                          <span className="block truncate text-xs text-destructive">
                            On leave · {leave}
                          </span>
                        ) : jobs ? (
                          <span
                            className="block truncate text-xs text-amber-600"
                            title={jobs.join(", ")}
                          >
                            Busy · {jobs.join(", ")}
                          </span>
                        ) : (
                          <span className="block text-xs text-success">Free</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={role === TEAM_ROLES[0]}
              onClick={() => go(TEAM_ROLES[TEAM_ROLES.indexOf(role) - 1])}
            >
              <ChevronLeft className="mr-1 h-4 w-4" /> Back
            </Button>
            {needed[role] > 0 && !done(role) ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  onNeededChange(role, count(role));
                  go(after(role, (r) => (r === role ? true : done(r))));
                }}
              >
                {count(role) === 0
                  ? `Skip ${plural(role, 2)}`
                  : `Go with ${count(role)} ${plural(role, count(role))}`}
              </Button>
            ) : (
              <Button type="button" size="sm" onClick={() => go(after(role))}>
                Next <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="grid gap-2 p-3 text-sm">
          {TEAM_ROLES.map((r) => {
            const names = chosen.filter((s) => s.role === r).map((s) => s.name);
            return (
              <div
                key={r}
                className="flex items-start justify-between gap-3 rounded-lg bg-muted/30 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="text-xs font-medium text-muted-foreground">
                    {FIELD_ROLE_LABELS[r]}s · {count(r)} of {needed[r]}
                  </div>
                  <div className="break-words">{names.length ? names.join(", ") : "None"}</div>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => go(r)}>
                  Change
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
