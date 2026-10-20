import { createFileRoute } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchUsers } from "@/api/users";
import {
  CSM_CODE_KIND_LABELS,
  LOCALITY_LABELS,
  apiErrorMessage,
  createArea,
  createCsmCode,
  createVehicle,
  fetchAreas,
  fetchCsmCodes,
  fetchFieldStaff,
  fetchVehicles,
  updateArea,
  updateCsmCode,
  updateVehicle,
  type Area,
  type AreaLocality,
  type CsmCode,
  type CsmCodeKind,
  type Vehicle,
} from "@/api/allocation";

export const Route = createFileRoute("/_portal/admin/masters")({
  head: () => ({ meta: [{ title: "Allocation Masters — SB OMS" }] }),
  component: MastersPage,
});

const NONE = "__none__";

function MastersPage() {
  return (
    <>
      <PageHeader
        title="Allocation Masters"
        description="The lists the work-allocation portal picks from. Deactivate entries instead of deleting them so past jobs keep their history."
        crumbs={[{ label: "Work Allocation" }, { label: "Masters" }]}
      />
      <Tabs defaultValue="csm-codes">
        <TabsList className="mb-4">
          <TabsTrigger value="csm-codes">CSM codes</TabsTrigger>
          <TabsTrigger value="areas">Areas</TabsTrigger>
          <TabsTrigger value="vehicles">Vehicles</TabsTrigger>
        </TabsList>
        <TabsContent value="csm-codes"><CsmCodesTab /></TabsContent>
        <TabsContent value="areas"><AreasTab /></TabsContent>
        <TabsContent value="vehicles"><VehiclesTab /></TabsContent>
      </Tabs>
    </>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function Toolbar({ q, setQ, placeholder, onAdd, addLabel, children }: {
  q: string;
  setQ: (v: string) => void;
  placeholder: string;
  onAdd: () => void;
  addLabel: string;
  children?: ReactNode;
}) {
  return (
    <div className="surface-panel mb-4 flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
      <div className="relative flex-1 sm:max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="pl-9" />
      </div>
      {children}
      <Button className="rounded-xl sm:ml-auto" onClick={onAdd}>
        <Plus className="mr-2 h-4 w-4" /> {addLabel}
      </Button>
    </div>
  );
}

function ActiveBadge({ active }: { active: boolean }) {
  return active ? (
    <Badge className="bg-success/15 text-success hover:bg-success/20">Active</Badge>
  ) : (
    <Badge variant="secondary">Inactive</Badge>
  );
}

function EditDialog({ open, title, onClose, onSave, saving, canSave, children }: {
  open: boolean;
  title: string;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  canSave: boolean;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="grid gap-4 py-2">{children}</div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={onSave} disabled={saving || !canSave}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ActiveSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between rounded-xl border p-3">
      <div>
        <div className="text-sm font-medium">Active</div>
        <div className="text-xs text-muted-foreground">Inactive entries are hidden from pickers but kept for history.</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

const EmptyRow = ({ cols, text }: { cols: number; text: string }) => (
  <TableRow><TableCell colSpan={cols} className="p-8 text-center text-muted-foreground">{text}</TableCell></TableRow>
);

// ---------------------------------------------------------------------------
// CSM codes
// ---------------------------------------------------------------------------

type CodeForm = { id?: number; code: string; kind: CsmCodeKind; label: string; user_id: number | null; is_active: boolean };

function CsmCodesTab() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [form, setForm] = useState<CodeForm | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ["masters", "csm-codes"], queryFn: fetchCsmCodes });
  const { data: usersData } = useQuery({ queryKey: ["users"], queryFn: fetchUsers });
  const csms = (usersData?.users ?? []).filter((u) => u.role === "CSM" && u.is_active !== false);

  const save = useMutation({
    mutationFn: (f: CodeForm) => {
      const body = { code: f.code, kind: f.kind, label: f.label || null, user_id: f.kind === "CSM" ? f.user_id : null, is_active: f.is_active };
      return f.id ? updateCsmCode(f.id, body) : createCsmCode(body);
    },
    onSuccess: () => {
      toast.success("Saved");
      setForm(null);
      qc.invalidateQueries({ queryKey: ["masters", "csm-codes"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not save the code")),
  });

  const codes = (data?.codes ?? []).filter((c) =>
    `${c.code} ${c.label ?? ""} ${c.user?.name ?? ""}`.toLowerCase().includes(q.toLowerCase()),
  );
  const unconfirmed = (data?.codes ?? []).filter((c) => c.kind === "UNKNOWN" && c.is_active).length;

  return (
    <>
      {unconfirmed > 0 && (
        <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          {unconfirmed} code{unconfirmed === 1 ? " is" : "s are"} not confirmed yet. Mark each one as a CSM (and link the CSM), a team or a branch.
        </div>
      )}
      <Toolbar q={q} setQ={setQ} placeholder="Search codes" addLabel="Add code"
        onAdd={() => setForm({ code: "", kind: "CSM", label: "", user_id: null, is_active: true })} />
      <div className="surface-panel overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead>Code</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Belongs to</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? <EmptyRow cols={5} text="Loading…" /> : codes.length === 0 ? <EmptyRow cols={5} text="No codes yet." /> : codes.map((c) => (
              <TableRow key={c.id} className={c.is_active ? "" : "opacity-60"}>
                <TableCell className="font-mono font-semibold">{c.code}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={c.kind === "UNKNOWN" ? "border-amber-500/40 text-amber-600" : ""}>
                    {CSM_CODE_KIND_LABELS[c.kind]}
                  </Badge>
                </TableCell>
                <TableCell>{c.user?.name ?? c.label ?? <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell><ActiveBadge active={c.is_active} /></TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => setForm({ id: c.id, code: c.code, kind: c.kind, label: c.label ?? "", user_id: c.user_id, is_active: c.is_active })}>
                    Edit
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <EditDialog open={!!form} title={form?.id ? `Edit code ${form.code}` : "Add CSM code"} onClose={() => setForm(null)}
        onSave={() => form && save.mutate(form)} saving={save.isPending}
        canSave={!!form?.code && (form.kind !== "CSM" || form.user_id != null)}>
        {form && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="cc-code">Code</Label>
                <Input id="cc-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="600" />
              </div>
              <div className="grid gap-2">
                <Label>Type</Label>
                <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v as CsmCodeKind })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(CSM_CODE_KIND_LABELS) as CsmCodeKind[]).map((k) => (
                      <SelectItem key={k} value={k}>{CSM_CODE_KIND_LABELS[k]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {form.kind === "CSM" ? (
              <div className="grid gap-2">
                <Label>CSM</Label>
                <Select value={form.user_id != null ? String(form.user_id) : NONE} onValueChange={(v) => setForm({ ...form, user_id: v === NONE ? null : Number(v) })}>
                  <SelectTrigger><SelectValue placeholder="Pick the CSM" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Pick the CSM</SelectItem>
                    {csms.map((u) => (
                      <SelectItem key={u.id} value={String(u.id)}>{u.name} (@{u.username})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="grid gap-2">
                <Label htmlFor="cc-label">What it means</Label>
                <Input id="cc-label" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Vizag branch" />
              </div>
            )}
            {form.id && <ActiveSwitch checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} />}
          </>
        )}
      </EditDialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Areas
// ---------------------------------------------------------------------------

type AreaForm = { id?: number; name: string; locality: AreaLocality; district: string; needs_confirmation: boolean; is_active: boolean };

function AreasTab() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [locality, setLocality] = useState<"ALL" | AreaLocality>("ALL");
  const [form, setForm] = useState<AreaForm | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ["masters", "areas"], queryFn: fetchAreas });

  const save = useMutation({
    mutationFn: (f: AreaForm) => {
      const body = { name: f.name, locality: f.locality, district: f.district || null, needs_confirmation: f.needs_confirmation, is_active: f.is_active };
      return f.id ? updateArea(f.id, body) : createArea(body);
    },
    onSuccess: () => {
      toast.success("Saved");
      setForm(null);
      qc.invalidateQueries({ queryKey: ["masters", "areas"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not save the area")),
  });

  const all = data?.areas ?? [];
  const areas = all.filter(
    (a) => (locality === "ALL" || a.locality === locality) && `${a.name} ${a.district ?? ""}`.toLowerCase().includes(q.toLowerCase()),
  );
  const toConfirm = all.filter((a) => a.needs_confirmation && a.is_active).length;

  return (
    <>
      {toConfirm > 0 && (
        <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          {toConfirm} area{toConfirm === 1 ? "" : "s"} still need{toConfirm === 1 ? "s" : ""} Local / Non-local confirmed. Open each one, check it, and turn off “Needs confirmation”.
        </div>
      )}
      <Toolbar q={q} setQ={setQ} placeholder="Search areas" addLabel="Add area"
        onAdd={() => setForm({ name: "", locality: "LOCAL", district: "", needs_confirmation: false, is_active: true })}>
        <Select value={locality} onValueChange={(v) => setLocality(v as typeof locality)}>
          <SelectTrigger className="sm:w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Local + Non-local</SelectItem>
            <SelectItem value="LOCAL">Local only</SelectItem>
            <SelectItem value="NON_LOCAL">Non-local only</SelectItem>
          </SelectContent>
        </Select>
      </Toolbar>
      <div className="surface-panel overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead>Area</TableHead>
              <TableHead>Locality</TableHead>
              <TableHead>District / notes</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? <EmptyRow cols={5} text="Loading…" /> : areas.length === 0 ? <EmptyRow cols={5} text="No areas match." /> : areas.map((a) => (
              <TableRow key={a.id} className={a.is_active ? "" : "opacity-60"}>
                <TableCell className="font-semibold">
                  {a.name}
                  {a.needs_confirmation && <Badge variant="outline" className="ml-2 border-amber-500/40 text-amber-600">Confirm</Badge>}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={a.locality === "NON_LOCAL" ? "border-orange-500/40 font-semibold text-orange-600" : ""}>
                    {LOCALITY_LABELS[a.locality]}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">{a.district ?? "—"}</TableCell>
                <TableCell><ActiveBadge active={a.is_active} /></TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => setForm({ id: a.id, name: a.name, locality: a.locality, district: a.district ?? "", needs_confirmation: a.needs_confirmation, is_active: a.is_active })}>
                    Edit
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <EditDialog open={!!form} title={form?.id ? `Edit ${form.name}` : "Add area"} onClose={() => setForm(null)}
        onSave={() => form && save.mutate(form)} saving={save.isPending} canSave={!!form?.name.trim()}>
        {form && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="ar-name">Area name</Label>
                <Input id="ar-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>Locality</Label>
                <Select value={form.locality} onValueChange={(v) => setForm({ ...form, locality: v as AreaLocality })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LOCAL">Local (Hyderabad city)</SelectItem>
                    <SelectItem value="NON_LOCAL">Non-local</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ar-district">District / notes</Label>
              <Input id="ar-district" value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })} placeholder="Optional" />
            </div>
            <div className="flex items-center justify-between rounded-xl border p-3">
              <div className="text-sm font-medium">Needs confirmation</div>
              <Switch checked={form.needs_confirmation} onCheckedChange={(v) => setForm({ ...form, needs_confirmation: v })} />
            </div>
            {form.id && <ActiveSwitch checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} />}
          </>
        )}
      </EditDialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

type VehicleForm = { id?: number; reg_no: string; type: string; usual_driver_id: number | null; notes: string; is_active: boolean };

function VehiclesTab() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [form, setForm] = useState<VehicleForm | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ["masters", "vehicles"], queryFn: fetchVehicles });
  const { data: staffData } = useQuery({ queryKey: ["field-staff"], queryFn: fetchFieldStaff });
  const drivers = (staffData?.staff ?? []).filter((s) => s.role === "DRIVER" && s.is_active);

  const save = useMutation({
    mutationFn: (f: VehicleForm) => {
      const body: Partial<Vehicle> = { reg_no: f.reg_no, type: f.type, usual_driver_id: f.usual_driver_id, notes: f.notes || null, is_active: f.is_active };
      return f.id ? updateVehicle(f.id, body) : createVehicle(body);
    },
    onSuccess: () => {
      toast.success("Saved");
      setForm(null);
      qc.invalidateQueries({ queryKey: ["masters", "vehicles"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not save the vehicle")),
  });

  const vehicles = (data?.vehicles ?? []).filter((v) =>
    `${v.reg_no} ${v.type} ${v.usualDriver?.name ?? ""}`.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <>
      <Toolbar q={q} setQ={setQ} placeholder="Search vehicles" addLabel="Add vehicle"
        onAdd={() => setForm({ reg_no: "", type: "Auto / Tempo", usual_driver_id: null, notes: "", is_active: true })} />
      <div className="surface-panel overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead>Registration</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Usual driver</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? <EmptyRow cols={5} text="Loading…" /> : vehicles.length === 0 ? <EmptyRow cols={5} text="No vehicles yet. Add each vehicle once, with its real number plate." /> : vehicles.map((v) => (
              <TableRow key={v.id} className={v.is_active ? "" : "opacity-60"}>
                <TableCell className="font-mono font-semibold">{v.reg_no}</TableCell>
                <TableCell>{v.type}</TableCell>
                <TableCell>{v.usualDriver?.name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell><ActiveBadge active={v.is_active} /></TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => setForm({ id: v.id, reg_no: v.reg_no, type: v.type, usual_driver_id: v.usual_driver_id, notes: v.notes ?? "", is_active: v.is_active })}>
                    Edit
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <EditDialog open={!!form} title={form?.id ? `Edit ${form.reg_no}` : "Add vehicle"} onClose={() => setForm(null)}
        onSave={() => form && save.mutate(form)} saving={save.isPending} canSave={!!form?.reg_no.trim() && !!form?.type.trim()}>
        {form && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="vh-reg">Registration no.</Label>
                <Input id="vh-reg" value={form.reg_no} onChange={(e) => setForm({ ...form, reg_no: e.target.value.toUpperCase() })} placeholder="TS 09 AB 1234" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="vh-type">Type</Label>
                <Input id="vh-type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Usual driver</Label>
              <Select value={form.usual_driver_id != null ? String(form.usual_driver_id) : NONE} onValueChange={(v) => setForm({ ...form, usual_driver_id: v === NONE ? null : Number(v) })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No usual driver</SelectItem>
                  {drivers.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="vh-notes">Notes</Label>
              <Input id="vh-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional" />
            </div>
            {form.id && <ActiveSwitch checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} />}
          </>
        )}
      </EditDialog>
    </>
  );
}
