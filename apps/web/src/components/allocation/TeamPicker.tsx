import { useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { FIELD_ROLE_LABELS, type FieldRole } from "@/api/allocation";

/** Mirrors TEAM_LIMITS in the API (utils/work-allocation.ts). */
export const TEAM_LIMITS: Record<FieldRole, number> = { PASTER: 2, HELPER: 2, DRIVER: 1 };

type Person = { id: number; name: string; role: FieldRole; emp_code: string | null };

/** What is still missing from a team, for the save button's hint; null when it is complete. */
export function teamShortfall(count: (r: FieldRole) => number, helpersRequired: boolean) {
  if (count("PASTER") === 0) return "Pick a Paster.";
  if (helpersRequired && count("HELPER") === 0) return "Pick a Helper, or choose Not required.";
  if (count("DRIVER") === 0) return "Pick a Driver.";
  return null;
}

/**
 * The team as dropdowns: one or two Pasters, Helpers only if the job needs them, one Driver.
 * Someone already on another job can still be picked, and the option says which job. Someone
 * on leave cannot.
 */
export function TeamPicker({
  staff,
  selected,
  helpersRequired,
  busy,
  onLeave,
  onChange,
  onHelpersRequired,
}: {
  staff: Person[];
  selected: number[];
  helpersRequired: boolean;
  busy: Map<number, string[]>;
  onLeave: Map<number, string>;
  onChange: (ids: number[]) => void;
  onHelpersRequired: (on: boolean) => void;
}) {
  const ofRole = (role: FieldRole) =>
    selected.filter((id) => staff.find((s) => s.id === id)?.role === role);

  /** Slot `i` of a role now holds `id`; null empties it and the next slot moves up. */
  const setSlot = (role: FieldRole, i: number, id: number | null) => {
    const ids = ofRole(role);
    const next = [...ids];
    if (id === null) next.splice(i, 1);
    else next[i] = id;
    onChange([...selected.filter((s) => !ids.includes(s)), ...next]);
  };

  const slots = (role: FieldRole) => {
    const ids = ofRole(role);
    const label = FIELD_ROLE_LABELS[role];
    return Array.from({ length: TEAM_LIMITS[role] }, (_, i) => (
      <div key={i} className="grid gap-2">
        <Label>
          {TEAM_LIMITS[role] > 1 ? `${label} ${i + 1}` : label}
          {i > 0 && <span className="font-normal text-muted-foreground"> (optional)</span>}
        </Label>
        <PersonSelect
          label={label}
          // The second dropdown stays shut until the first is filled.
          disabled={i > ids.length}
          value={ids[i] ?? null}
          people={staff.filter(
            (s) => s.role === role && (s.id === ids[i] || !selected.includes(s.id)),
          )}
          busy={busy}
          onLeave={onLeave}
          onChange={(id) => setSlot(role, i, id)}
        />
      </div>
    ));
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2">{slots("PASTER")}</div>
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label>Helpers</Label>
          <div
            role="radiogroup"
            aria-label="Helpers"
            className="inline-flex rounded-xl border bg-muted/40 p-1 text-sm"
          >
            {(
              [
                [true, "Required"],
                [false, "Not required"],
              ] as const
            ).map(([on, label]) => (
              <button
                key={label}
                type="button"
                role="radio"
                aria-checked={helpersRequired === on}
                onClick={() => onHelpersRequired(on)}
                className={cn(
                  "min-h-8 rounded-lg px-3 font-medium transition-colors",
                  helpersRequired === on
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {helpersRequired && <div className="grid gap-3 sm:grid-cols-2">{slots("HELPER")}</div>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">{slots("DRIVER")}</div>
    </div>
  );
}

function PersonSelect({
  label,
  value,
  people,
  busy,
  onLeave,
  disabled,
  onChange,
}: {
  label: string;
  value: number | null;
  people: Person[];
  busy: Map<number, string[]>;
  onLeave: Map<number, string>;
  disabled?: boolean;
  onChange: (id: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = people.find((p) => p.id === value);
  // Free people first, then busy, then on leave, so the obvious picks are on top.
  const rank = (id: number) => (onLeave.has(id) ? 2 : busy.has(id) ? 1 : 0);
  const sorted = [...people].sort(
    (a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name),
  );

  return (
    <div className="flex items-start gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-label={`Pick a ${label}`}
            disabled={disabled}
            className="h-auto min-h-10 min-w-0 flex-1 justify-between rounded-xl py-2 text-left font-normal"
          >
            {current ? (
              <span className="min-w-0">
                <span className="block truncate">{current.name}</span>
                <PersonStatus id={current.id} busy={busy} onLeave={onLeave} />
              </span>
            ) : (
              <span className="text-muted-foreground">Pick a {label}</span>
            )}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-64 p-0" align="start">
          <Command>
            <CommandInput placeholder="Search by name or code" />
            <CommandList>
              <CommandEmpty>Nobody matches.</CommandEmpty>
              <CommandGroup>
                {sorted.map((p) => (
                  <CommandItem
                    key={p.id}
                    value={`${p.name} ${p.emp_code ?? ""} ${p.id}`}
                    disabled={onLeave.has(p.id)}
                    onSelect={() => {
                      onChange(p.id);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn("mr-2 h-4 w-4", value === p.id ? "opacity-100" : "opacity-0")}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">
                        {p.name}
                        {p.emp_code && (
                          <span className="text-xs text-muted-foreground"> · {p.emp_code}</span>
                        )}
                      </span>
                      <PersonStatus id={p.id} busy={busy} onLeave={onLeave} />
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {current && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-10 shrink-0"
          aria-label={`Remove ${current.name}`}
          onClick={() => onChange(null)}
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

function PersonStatus({
  id,
  busy,
  onLeave,
}: {
  id: number;
  busy: Map<number, string[]>;
  onLeave: Map<number, string>;
}) {
  const leave = onLeave.get(id);
  if (leave) return <span className="block text-xs text-destructive">On leave · {leave}</span>;
  const jobs = busy.get(id);
  if (jobs) {
    return (
      <span className="block whitespace-normal text-xs text-amber-600">
        Assigned to {jobs.join(", ")}
      </span>
    );
  }
  return <span className="block text-xs text-success">Free</span>;
}
