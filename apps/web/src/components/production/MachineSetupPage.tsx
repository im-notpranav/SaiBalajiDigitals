import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cog, Plus } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState, LoadingState } from "@/components/layout/PageStates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { createMachine, fetchMachineSetup, setMediaMachine, setOperatorMachine, updateMachine } from "@/api/machines";
import { friendlyError } from "@/lib/friendly-error";

const NONE = "none";

/**
 * Machines: the six machines, which machine each line item is made on, and which machine each
 * operator works. The super admin keeps the machines and line items; the Production Manager
 * (and the super admin) give operators their machine.
 */
export function MachineSetupPage({ canEditMasters, canEditOperators }: { canEditMasters: boolean; canEditOperators: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["machine-setup"], queryFn: fetchMachineSetup });
  const [newName, setNewName] = useState("");
  const [q, setQ] = useState("");
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["machine-setup"] });
    qc.invalidateQueries({ queryKey: ["machine-board"] });
  };
  const onErr = (e: unknown) => toast.error("Not saved", { description: friendlyError(e) });
  const add = useMutation({
    mutationFn: () => createMachine(newName.trim()),
    onSuccess: () => {
      setNewName("");
      refresh();
      toast.success("Machine added");
    },
    onError: onErr,
  });
  const toggle = useMutation({ mutationFn: (v: { id: number; is_active: boolean }) => updateMachine(v.id, { is_active: v.is_active }), onSuccess: refresh, onError: onErr });
  const mediaMachine = useMutation({
    mutationFn: (v: { id: number; machine_id: number | null }) => setMediaMachine(v.id, v.machine_id),
    onSuccess: () => {
      refresh();
      toast.success("Default machine saved", { description: "New lines of this item go to that machine." });
    },
    onError: onErr,
  });
  const operatorMachine = useMutation({
    mutationFn: (v: { id: number; machine_id: number | null }) => setOperatorMachine(v.id, v.machine_id),
    onSuccess: () => {
      refresh();
      toast.success("Operator's machine saved");
    },
    onError: onErr,
  });

  const media = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (data?.media ?? []).filter((m) => m.is_active && (!t || m.name.toLowerCase().includes(t)));
  }, [data, q]);

  if (isLoading) return <LoadingState />;
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;
  const active = data.machines.filter((m) => m.is_active);
  const pick = (value: number | null, onChange: (id: number | null) => void, label: string, disabled: boolean) => (
    <Select value={value ? String(value) : NONE} onValueChange={(v) => onChange(v === NONE ? null : Number(v))} disabled={disabled}>
      <SelectTrigger aria-label={label} className="h-8 w-44 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>No machine</SelectItem>
        {active.map((m) => (
          <SelectItem key={m.id} value={String(m.id)}>
            {m.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  const unset = data.media.filter((m) => m.is_active && !m.default_machine_id).length;

  return (
    <>
      <PageHeader
        title="Machines"
        description="Each line item has a default machine; its new lines wait there for that machine's operators."
        crumbs={[{ label: "Production" }, { label: "Machines" }]}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="surface-panel space-y-3 p-4 sm:p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Cog className="h-4 w-4 text-primary" aria-hidden /> Machines
          </h2>
          <ul className="divide-y rounded-lg border">
            {data.machines.map((m) => {
              const ops = data.operators.filter((o) => o.machine_id === m.id && o.is_active).length;
              const items = data.media.filter((x) => x.default_machine_id === m.id).length;
              return (
                <li key={m.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                  <div>
                    <div className="font-medium">{m.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {ops} operator{ops === 1 ? "" : "s"} · {items} line item{items === 1 ? "" : "s"}
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    {m.is_active ? "In use" : "Off"}
                    <Switch checked={m.is_active} disabled={!canEditMasters} onCheckedChange={(v) => toggle.mutate({ id: m.id, is_active: v })} aria-label={`${m.name} in use`} />
                  </label>
                </li>
              );
            })}
          </ul>
          {canEditMasters && (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (newName.trim()) add.mutate();
              }}
            >
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New machine name" aria-label="New machine name" className="h-9" />
              <Button type="submit" size="sm" className="h-9" disabled={!newName.trim() || add.isPending}>
                <Plus className="mr-1 h-4 w-4" /> Add
              </Button>
            </form>
          )}

          <h2 className="pt-3 text-sm font-semibold">Operators</h2>
          {data.operators.length === 0 ? (
            <p className="text-sm text-muted-foreground">No operators yet.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {data.operators.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-3 p-2.5 text-sm">
                  <div className={o.is_active ? "" : "text-muted-foreground line-through"}>
                    {o.name} <span className="text-xs text-muted-foreground">@{o.username}</span>
                  </div>
                  {pick(o.machine_id, (id) => operatorMachine.mutate({ id: o.id, machine_id: id }), `Machine for ${o.name}`, !canEditOperators)}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="surface-panel space-y-3 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">
              Line items <span className="font-normal text-muted-foreground">· {unset} without a machine</span>
            </h2>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a line item" aria-label="Find a line item" className="h-8 w-48" />
          </div>
          <ul className="max-h-[70vh] divide-y overflow-y-auto rounded-lg border">
            {media.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 p-2.5 text-sm">
                <span className="min-w-0 truncate" title={m.name}>
                  {m.name}
                </span>
                {pick(m.default_machine_id, (id) => mediaMachine.mutate({ id: m.id, machine_id: id }), `Default machine for ${m.name}`, !canEditMasters)}
              </li>
            ))}
          </ul>
          {!canEditMasters && <p className="text-xs text-muted-foreground">Only the super admin changes machines and line items.</p>}
        </section>
      </div>
    </>
  );
}
