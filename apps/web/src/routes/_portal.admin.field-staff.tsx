import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HardHat, Loader2, Search, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "@/components/layout/PageStates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  FIELD_ROLE_LABELS,
  apiErrorMessage,
  createFieldStaff,
  fetchFieldStaff,
  resetFieldStaffPassword,
  setFieldStaffStatus,
  updateFieldStaff,
  type FieldRole,
  type FieldStaff,
} from "@/api/allocation";

export const Route = createFileRoute("/_portal/admin/field-staff")({
  head: () => ({ meta: [{ title: "Field Staff — SB OMS" }] }),
  component: FieldStaffPage,
});

const ROLE_OPTIONS = Object.entries(FIELD_ROLE_LABELS) as [FieldRole, string][];

/** "Mohd Moin" → "mohd_moin": a starting suggestion the manager can change. */
const suggestUsername = (name: string) =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);

const emptyForm = { name: "", username: "", password: "", role: "PASTER" as FieldRole, phone: "", email: "", emp_code: "" };

function FieldStaffPage() {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<"ALL" | FieldRole>("ALL");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [editing, setEditing] = useState<FieldStaff | null>(null);
  const [pwTarget, setPwTarget] = useState<FieldStaff | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["field-staff"], queryFn: fetchFieldStaff });
  const staff = data?.staff ?? [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["field-staff"] });

  const createMutation = useMutation({
    mutationFn: () =>
      createFieldStaff({
        name: form.name,
        username: form.username,
        password: form.password,
        role: form.role,
        phone: form.phone,
        email: form.email,
        emp_code: form.emp_code || null,
      }),
    onSuccess: (u) => {
      toast.success(`${u.name} added. Share the username and password with them.`);
      setCreateOpen(false);
      setForm(emptyForm);
      setUsernameTouched(false);
      refresh();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not add the staff member")),
  });

  const updateMutation = useMutation({
    mutationFn: (u: FieldStaff) =>
      updateFieldStaff(u.id, { name: u.name, role: u.role, phone: u.phone ?? "", email: u.email ?? "", emp_code: u.emp_code || null }),
    onSuccess: () => {
      toast.success("Saved");
      setEditing(null);
      refresh();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not save changes")),
  });

  const statusMutation = useMutation({
    mutationFn: (u: FieldStaff) => setFieldStaffStatus(u.id, !u.is_active),
    onSuccess: (u) => {
      toast.success(u.is_active ? `${u.name} reactivated` : `${u.name} deactivated`);
      refresh();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not change status")),
  });

  const passwordMutation = useMutation({
    mutationFn: () => resetFieldStaffPassword(pwTarget!.id, newPassword),
    onSuccess: (res) => {
      toast.success(res.message);
      setPwTarget(null);
      setNewPassword("");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not reset the password")),
  });

  const counts = ROLE_OPTIONS.map(([role, label]) => ({
    role,
    label,
    n: staff.filter((s) => s.role === role && s.is_active).length,
  }));

  const filtered = staff.filter(
    (s) =>
      (roleFilter === "ALL" || s.role === roleFilter) &&
      `${s.name} ${s.username} ${s.emp_code ?? ""} ${s.phone ?? ""}`.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <>
      <PageHeader
        title="Field Staff"
        description="Pasters, Helpers and Drivers. Deactivate people who leave."
        crumbs={[{ label: "Work Allocation" }, { label: "Field Staff" }]}
        actions={
          <Button className="rounded-xl" onClick={() => setCreateOpen(true)}>
            <UserPlus className="mr-2 h-4 w-4" /> Add staff
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-3 gap-3">
        {counts.map((c) => (
          <div key={c.role} className="surface-panel p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{c.label}s</div>
            <div className="mt-1 text-2xl font-bold tabular-nums">{c.n}</div>
            <div className="text-xs text-muted-foreground">active</div>
          </div>
        ))}
      </div>

      <div className="surface-panel mb-4 flex flex-col gap-3 p-3 sm:flex-row">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search field staff" placeholder="Search name, code or phone" className="pl-9" />
        </div>
        <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as typeof roleFilter)}>
          <SelectTrigger className="sm:w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All roles</SelectItem>
            {ROLE_OPTIONS.map(([v, l]) => (
              <SelectItem key={v} value={v}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="surface-panel overflow-hidden">
        {isLoading ? (
          <LoadingState bare label="Loading staff…" />
        ) : error && !data ? (
          <ErrorState bare title="Couldn't load field staff" error={error} onRetry={() => refetch()} />
        ) : filtered.length === 0 ? (
          <EmptyState
            bare
            icon={HardHat}
            title={staff.length === 0 ? "No field staff yet" : "No one matches these filters"}
            description={staff.length === 0 ? "Add your first Paster, Helper or Driver." : undefined}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Emp code</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((s) => (
                <TableRow key={s.id} className={s.is_active ? "" : "opacity-60"}>
                  <TableCell>
                    <div className="font-semibold">{s.name}</div>
                    <div className="text-xs text-muted-foreground">@{s.username}</div>
                  </TableCell>
                  <TableCell><Badge variant="outline">{FIELD_ROLE_LABELS[s.role]}</Badge></TableCell>
                  <TableCell className="tabular-nums">{s.emp_code ?? "—"}</TableCell>
                  <TableCell className="tabular-nums">
                    <div>{s.phone ?? <span className="text-muted-foreground">Missing</span>}</div>
                    <div className="text-xs text-muted-foreground">{s.email ?? "No email"}</div>
                  </TableCell>
                  <TableCell>
                    {s.is_active ? (
                      <Badge className="bg-success/15 text-success hover:bg-success/20">Active</Badge>
                    ) : (
                      <Badge variant="secondary">Inactive</Badge>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    <Button variant="ghost" size="sm" onClick={() => setEditing({ ...s })}>Edit</Button>
                    <Button variant="ghost" size="sm" onClick={() => { setPwTarget(s); setNewPassword(""); }}>Password</Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={s.is_active ? "text-destructive" : "text-success"}
                      disabled={statusMutation.isPending}
                      onClick={() => statusMutation.mutate(s)}
                    >
                      {s.is_active ? "Deactivate" : "Reactivate"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Add */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add field staff</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="fs-name">Name (as used daily)</Label>
              <Input
                id="fs-name"
                value={form.name}
                onChange={(e) =>
                  setForm({ ...form, name: e.target.value, username: usernameTouched ? form.username : suggestUsername(e.target.value) })
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Role</Label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as FieldRole })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map(([v, l]) => (
                      <SelectItem key={v} value={v}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="fs-code">Emp code</Label>
                <Input id="fs-code" value={form.emp_code} onChange={(e) => setForm({ ...form, emp_code: e.target.value })} placeholder="Optional" />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="fs-phone">WhatsApp number</Label>
              <Input id="fs-phone" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="98765 43210" />
              <p className="text-xs text-muted-foreground">Used for job and payment notifications on WhatsApp.</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="fs-email">Email</Label>
              <Input id="fs-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="fs-user">Username</Label>
                <Input
                  id="fs-user"
                  value={form.username}
                  onChange={(e) => { setUsernameTouched(true); setForm({ ...form, username: e.target.value.toLowerCase() }); }}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="fs-pw">Password</Label>
                <Input id="fs-pw" type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="At least 8 characters" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !form.name || !form.phone.trim() || !form.email.trim() || form.username.length < 3 || form.password.length < 8}
            >
              {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit {editing?.name}</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label htmlFor="fe-name">Name</Label>
                <Input id="fe-name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label>Role</Label>
                  <Select value={editing.role} onValueChange={(v) => setEditing({ ...editing, role: v as FieldRole })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ROLE_OPTIONS.map(([v, l]) => (
                        <SelectItem key={v} value={v}>{l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="fe-code">Emp code</Label>
                  <Input id="fe-code" value={editing.emp_code ?? ""} onChange={(e) => setEditing({ ...editing, emp_code: e.target.value })} />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="fe-phone">WhatsApp number</Label>
                <Input id="fe-phone" inputMode="tel" value={editing.phone ?? ""} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="fe-email">Email</Label>
                <Input id="fe-email" type="email" value={editing.email ?? ""} onChange={(e) => setEditing({ ...editing, email: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={() => editing && updateMutation.mutate(editing)} disabled={updateMutation.isPending || !editing?.name || !editing?.phone?.trim() || !editing?.email?.trim()}>
              {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Password */}
      <Dialog open={!!pwTarget} onOpenChange={(o) => !o && setPwTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reset password — {pwTarget?.name}</DialogTitle></DialogHeader>
          <div className="grid gap-3 py-2">
            <p className="text-sm text-muted-foreground">
              Sets a new password for <strong>@{pwTarget?.username}</strong> immediately. Share it with them directly.
            </p>
            <Input type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="At least 8 characters" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPwTarget(null)}>Cancel</Button>
            <Button onClick={() => passwordMutation.mutate()} disabled={passwordMutation.isPending || newPassword.length < 8}>
              {passwordMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Reset password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
