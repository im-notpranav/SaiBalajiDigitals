import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  FIELD_ROLE_LABELS,
  fetchFieldStaff,
  type FieldRole,
  type FieldStaff,
} from "@/api/allocation";

const ROLES: FieldRole[] = ["PASTER", "HELPER", "DRIVER"];

/** Active field staff, plus anyone already chosen even if since deactivated. */
function useFieldStaff(keep: number[]) {
  const { data } = useQuery({ queryKey: ["field-staff"], queryFn: fetchFieldStaff });
  return (data?.staff ?? []).filter((s) => s.is_active || keep.includes(s.id));
}

/**
 * Searchable picker for Pasters, Helpers and Drivers, grouped by role. Single-select
 * (`value` / `onChange`) or multi-select (`values` / `onToggle`).
 */
export function StaffSelect({
  value,
  onChange,
  values,
  onToggle,
  placeholder = "Pick a person",
  allowAll,
  disabled,
  className,
}: {
  value?: number | null;
  onChange?: (id: number | null) => void;
  values?: number[];
  onToggle?: (id: number, on: boolean) => void;
  placeholder?: string;
  /** Adds an "Everyone" option (value null), for filters. */
  allowAll?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const multi = !!values;
  const chosen = multi ? values! : value ? [value] : [];
  const staff = useFieldStaff(chosen);
  const byId = new Map<number, FieldStaff>(staff.map((s) => [s.id, s]));
  const label = chosen.length
    ? chosen.map((id) => byId.get(id)?.name ?? "…").join(", ")
    : allowAll
      ? "Everyone"
      : placeholder;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          disabled={disabled}
          className={cn("w-full justify-between rounded-xl font-normal", className)}
        >
          <span className={cn("truncate", !chosen.length && !allowAll && "text-muted-foreground")}>
            {label}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search by name or employee code" />
          <CommandList>
            <CommandEmpty>Nobody matches.</CommandEmpty>
            {allowAll && (
              <CommandGroup>
                <CommandItem
                  value="__everyone__"
                  onSelect={() => {
                    onChange?.(null);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn("mr-2 h-4 w-4", !chosen.length ? "opacity-100" : "opacity-0")}
                  />
                  Everyone
                </CommandItem>
              </CommandGroup>
            )}
            {ROLES.map((role) => {
              const people = staff.filter((s) => s.role === role);
              if (!people.length) return null;
              return (
                <CommandGroup key={role} heading={`${FIELD_ROLE_LABELS[role]}s`}>
                  {people.map((s) => {
                    const on = chosen.includes(s.id);
                    return (
                      <CommandItem
                        key={s.id}
                        value={`${s.name} ${s.emp_code ?? ""} ${s.id}`}
                        onSelect={() => {
                          if (multi) onToggle?.(s.id, !on);
                          else {
                            onChange?.(s.id);
                            setOpen(false);
                          }
                        }}
                      >
                        <Check className={cn("mr-2 h-4 w-4", on ? "opacity-100" : "opacity-0")} />
                        <span className="flex-1 truncate">{s.name}</span>
                        {s.emp_code && (
                          <span className="text-xs text-muted-foreground">{s.emp_code}</span>
                        )}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
