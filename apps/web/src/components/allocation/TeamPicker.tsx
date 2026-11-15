import { useState, type ReactNode } from "react";
import { Check, ChevronsUpDown, Plus, X } from "lucide-react";
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

/** The rows of the team, in the order the old Task Log had them. */
export const TEAM_ROLES: FieldRole[] = ["PASTER", "HELPER", "DRIVER"];

type Person = { id: number; name: string; role: FieldRole; emp_code: string | null };

/**
 * What is still missing from the team, for the save button's hint; null when it can be saved.
 * Any mix of roles is fine, nobody included (Q17/Q18): only a role marked Required with nobody
 * picked yet holds the save back.
 */
export function teamShortfall(count: (r: FieldRole) => number, required: (r: FieldRole) => boolean) {
  const missing = TEAM_ROLES.find((r) => required(r) && count(r) === 0);
  return missing ? `Pick a ${FIELD_ROLE_LABELS[missing]}, or choose Not required.` : null;
}

/**
 * The team as three rows, Pasters, Helpers and Drivers, each Not required or Required. A
 * required role shows one dropdown; "+" adds another, as many as needed, and each extra one
 * can be removed. Nobody can be picked twice. Someone already on another job can still be
 * picked, and the option says which job; someone on leave cannot.
 */
export function TeamPicker({
  staff,
  selected,
  required,
  blanks,
  busy,
  onLeave,
  checking,
  onChange,
  onRequired,
  onBlanks,
  driverAside,
}: {
  staff: Person[];
  selected: number[];
  /** Roles the job needs; a role with people on it always counts as needed. */
  required: Record<FieldRole, boolean>;
  /** Empty dropdowns opened with "+" below a role's picked people. */
  blanks: Record<FieldRole, number>;
  busy: Map<number, string[]>;
  onLeave: Map<number, string>;
  /** Who is busy or on leave over the dates is still loading. */
  checking?: boolean;
  onChange: (ids: number[]) => void;
  onRequired: (role: FieldRole, on: boolean) => void;
  onBlanks: (role: FieldRole, n: number) => void;
  /** Beside the Drivers on a wide screen, under them on a phone: the job's location. */
  driverAside?: ReactNode;
}) {
  const ofRole = (role: FieldRole) =>
    selected.filter((id) => staff.find((s) => s.id === id)?.role === role);

  const block = (role: FieldRole, narrow = false) => {
    const ids = ofRole(role);
    const on = required[role] || ids.length > 0;
    const label = FIELD_ROLE_LABELS[role];
    // A required role always shows a dropdown, even before "+" is pressed.
    const implicit = on && ids.length === 0 && blanks[role] === 0;
    const blankCount = on ? (implicit ? 1 : blanks[role]) : 0;
    const left = staff.filter((s) => s.role === role && !selected.includes(s.id));

    const pick = (slot: number, id: number | null) => {
      const filled = slot < ids.length;
      if (filled) {
        // Replace or take out a picked person; anyone below moves up.
        const next = [...ids];
        if (id === null) next.splice(slot, 1);
        else next[slot] = id;
        onChange([...selected.filter((s) => !ids.includes(s)), ...next]);
      } else if (id !== null) {
        // Filling an empty dropdown adds the person at the end of the role's list.
        onChange([...selected, id]);
        if (!implicit) onBlanks(role, blanks[role] - 1);
      }
    };

    return (
      <div className="grid content-start gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label>{label}s</Label>
          <div
            role="radiogroup"
            aria-label={`${label}s`}
            className="inline-flex rounded-xl border bg-muted/40 p-1 text-sm"
          >
            {(
              [
                [false, "Not required"],
                [true, "Required"],
              ] as const
            ).map(([value, text]) => (
              <button
                key={text}
                type="button"
                role="radio"
                aria-checked={on === value}
                onClick={() => onRequired(role, value)}
                className={cn(
                  "min-h-8 rounded-lg px-3 font-medium transition-colors",
                  on === value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {text}
              </button>
            ))}
          </div>
        </div>
        {on && (
          <>
            <div className={cn("grid gap-2", !narrow && "sm:grid-cols-2 sm:gap-3")}>
              {Array.from({ length: ids.length + blankCount }, (_, slot) => {
                const id = ids[slot] ?? null;
                // The first dropdown stays; every other one, and any picked person, can go.
                const removable = id !== null || slot > 0;
                return (
                  <PersonSelect
                    key={id ?? `blank-${slot}`}
                    label={label}
                    value={id}
                    people={staff.filter(
                      (s) => s.role === role && (s.id === id || !selected.includes(s.id)),
                    )}
                    busy={busy}
                    onLeave={onLeave}
                    checking={checking}
                    onChange={(next) => pick(slot, next)}
                    onRemove={
                      removable
                        ? () => (id !== null ? pick(slot, null) : onBlanks(role, blanks[role] - 1))
                        : undefined
                    }
                  />
                );
              })}
            </div>
            {ids.length > 0 && blankCount === 0 && left.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="justify-self-start rounded-xl px-2 text-primary hover:text-primary"
                onClick={() => onBlanks(role, 1)}
              >
                <Plus className="mr-1 h-4 w-4" /> Add another {label.toLowerCase()}
              </Button>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="grid gap-5">
      {block("PASTER")}
      {block("HELPER")}
      {/* The Driver row carries the location beside it, stacked under it on a phone. */}
      <div className={cn("grid gap-5", driverAside && "sm:grid-cols-2 sm:gap-4")}>
        {block("DRIVER", !!driverAside)}
        {driverAside}
      </div>
    </div>
  );
}

function PersonSelect({
  label,
  value,
  people,
  busy,
  onLeave,
  checking,
  onChange,
  onRemove,
}: {
  label: string;
  value: number | null;
  people: Person[];
  busy: Map<number, string[]>;
  onLeave: Map<number, string>;
  checking?: boolean;
  onChange: (id: number | null) => void;
  /** Shows the × that takes this person, or this empty dropdown, off the job. */
  onRemove?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const current = people.find((p) => p.id === value);
  // Alphabetical, like every list of names; each option still says who is busy or on leave.
  const sorted = [...people].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="flex items-start gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-label={`Pick a ${label}`}
            className="h-auto min-h-10 min-w-0 flex-1 justify-between rounded-xl py-2 text-left font-normal"
          >
            {current ? (
              <span className="min-w-0">
                <span className="block truncate">{current.name}</span>
                <PersonStatus id={current.id} busy={busy} onLeave={onLeave} checking={checking} />
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
                      <PersonStatus id={p.id} busy={busy} onLeave={onLeave} checking={checking} />
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {onRemove && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-10 shrink-0"
          aria-label={current ? `Remove ${current.name}` : `Remove this ${label} box`}
          onClick={onRemove}
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
  checking,
}: {
  id: number;
  busy: Map<number, string[]>;
  onLeave: Map<number, string>;
  checking?: boolean;
}) {
  // Saying "Free" before the dates' bookings are in would be a guess.
  if (checking) return <span className="block text-xs text-muted-foreground">Checking…</span>;
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
