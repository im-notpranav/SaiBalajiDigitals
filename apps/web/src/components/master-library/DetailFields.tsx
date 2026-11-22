import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchMachines } from "@/api/machines";
import type { MasterKind } from "@/api/masterLibrary";

/**
 * The details beside a name, as the company sheets carry them: a client's short name and
 * contact, a line item's default machine, a location's state. Shared by the admin's add/edit
 * dialog, the approve dialog and the CSM's request dialog.
 */

export interface Details {
  short_name: string;
  contact_person: string;
  contact_number: string;
  email: string;
  csm_name: string;
  /** Line items: the machine id as text, "" for none. */
  machine_id: string;
  state: string;
}

export const EMPTY_DETAILS: Details = { short_name: "", contact_person: "", contact_number: "", email: "", csm_name: "", machine_id: "", state: "" };

/** Details from a saved entry or a request's details, blanks where nothing is known. */
export function detailsOf(src: Record<string, unknown> | null | undefined): Details {
  const s = (k: string) => (typeof src?.[k] === "string" ? (src[k] as string) : "");
  const machine = src?.machine_id ?? src?.default_machine_id;
  return {
    short_name: s("short_name"),
    contact_person: s("contact_person"),
    contact_number: s("contact_number"),
    email: s("email"),
    csm_name: s("csm_name"),
    machine_id: typeof machine === "number" ? String(machine) : "",
    state: s("state"),
  };
}

/** The fields the API takes for this kind; blanks become null so a cleared field is cleared. */
export function detailsBody(kind: MasterKind, d: Details, machineKey: "machine_id" | "default_machine_id" = "machine_id"): Record<string, unknown> {
  const v = (x: string) => x.trim() || null;
  if (kind === "CLIENT")
    return { short_name: v(d.short_name), contact_person: v(d.contact_person), contact_number: v(d.contact_number), email: v(d.email), csm_name: v(d.csm_name) };
  if (kind === "MEDIA") return { [machineKey]: d.machine_id ? Number(d.machine_id) : null };
  return { state: v(d.state) };
}

export const emailBad = (d: Details) => !!d.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim());

const opt = <span className="font-normal text-muted-foreground">(optional)</span>;

export function DetailFields({
  kind,
  value,
  onChange,
  idPrefix,
}: {
  kind: MasterKind;
  value: Details;
  onChange: (d: Details) => void;
  idPrefix: string;
}) {
  const set = <K extends keyof Details>(k: K, v: Details[K]) => onChange({ ...value, [k]: v });
  const { data: machines } = useQuery({ queryKey: ["machines"], queryFn: fetchMachines, enabled: kind === "MEDIA", staleTime: 60_000 });

  if (kind === "CLIENT")
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor={`${idPrefix}-short`}>Short name {opt}</Label>
          <Input id={`${idPrefix}-short`} value={value.short_name} onChange={(e) => set("short_name", e.target.value)} maxLength={100} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${idPrefix}-csm`}>CSM name {opt}</Label>
          <Input id={`${idPrefix}-csm`} value={value.csm_name} onChange={(e) => set("csm_name", e.target.value)} maxLength={100} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${idPrefix}-person`}>Contact person {opt}</Label>
          <Input id={`${idPrefix}-person`} value={value.contact_person} onChange={(e) => set("contact_person", e.target.value)} maxLength={100} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${idPrefix}-phone`}>Contact number {opt}</Label>
          <Input id={`${idPrefix}-phone`} value={value.contact_number} onChange={(e) => set("contact_number", e.target.value)} maxLength={30} inputMode="tel" placeholder="e.g. 98480 12345" />
          {value.contact_number.trim() !== "" && value.contact_number.replace(/\D/g, "").length < 10 && (
            <p className="text-xs text-warning">A mobile number has 10 digits.</p>
          )}
        </div>
        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor={`${idPrefix}-email`}>Email {opt}</Label>
          <Input id={`${idPrefix}-email`} type="email" value={value.email} onChange={(e) => set("email", e.target.value)} maxLength={200} />
          {emailBad(value) ? (
            <p className="text-xs text-destructive">That is not an email address.</p>
          ) : (
            <p className="text-xs text-muted-foreground">A new client with an email gets a welcome mail.</p>
          )}
        </div>
      </div>
    );

  if (kind === "MEDIA")
    return (
      <div className="grid gap-2">
        <Label>Default machine {opt}</Label>
        <Select value={value.machine_id || "NONE"} onValueChange={(v) => set("machine_id", v === "NONE" ? "" : v)}>
          <SelectTrigger aria-label="Default machine"><SelectValue placeholder="Pick a machine" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="NONE">No machine</SelectItem>
            {(machines?.machines ?? []).filter((m) => m.is_active || String(m.id) === value.machine_id).map((m) => (
              <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">New order lines of this item queue on this machine.</p>
      </div>
    );

  return (
    <div className="grid gap-2">
      <Label htmlFor={`${idPrefix}-state`}>State {opt}</Label>
      <Input id={`${idPrefix}-state`} value={value.state} onChange={(e) => set("state", e.target.value)} maxLength={60} placeholder="e.g. Telangana" />
    </div>
  );
}
