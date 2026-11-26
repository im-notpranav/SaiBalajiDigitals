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
import { NewPasswordFields, passwordsReady } from "@/components/ui/password-input";
import {
  DeletePermanentlyDialog,
  KEEP_PHOTO,
  PhotoField,
  QuickPhoto,
  USERNAME_PREFIX,
  UsernameField,
  applyPhotoDraft,
  usernameOk,
  type PhotoDraft,
} from "@/components/users/UserBits";
import { photoSrc } from "@/api/users";
import { useAuth } from "@/lib/auth-store";
import {
  FIELD_ROLE_LABELS,
  apiErrorMessage,
  createFieldStaff,
  deleteFieldStaff,
  fetchFieldStaff,
  removeFieldStaffPhoto,
  resetFieldStaffPassword,
  setFieldStaffStatus,
  updateFieldStaff,
  uploadFieldStaffPhoto,
  type FieldRole,
  type FieldStaff,
} from "@/api/allocation";

export const Route = createFileRoute("/_portal/admin/field-staff")({
  head: () => ({ meta: [{ title: "Field Staff — SB OMS" }] }),
  component: FieldStaffPage,
});

/** Paster, Helper, Driver: the order the count cards use. */
const ROLE_OPTIONS = Object.entries(FIELD_ROLE_LABELS) as [FieldRole, string][];
/** The same roles A–Z, for every role picker. */
const ROLE_PICKS = [...ROLE_OPTIONS].sort((a, b) => a[1].localeCompare(b[1]));

const emptyForm = {
  name: "",
  username: USERNAME_PREFIX,
  password: "",
  confirm: "",
  role: "PASTER" as FieldRole,
  phone: "",
  email: "",
  emp_code: "",
};

function FieldStaffPage() {
  const queryClient = useQueryClient();
  // Every change to an account is the super admin's (2026-11-15). Admins and the Operation
  // Manager see the list read-only; the API refuses their writes too.
  const isSuper = !!useAuth().user?.is_super_admin;
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<"ALL" | FieldRole>("ALL");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [newPhoto, setNewPhoto] = useState<PhotoDraft>(KEEP_PHOTO);
  const [editing, setEditing] = useState<FieldStaff | null>(null);
  const [editPhoto, setEditPhoto] = useState<PhotoDraft>(KEEP_PHOTO);
  const [pwTarget, setPwTarget] = useState<FieldStaff | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<FieldStaff | null>(null);

  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["field-staff"], queryFn: fetchFieldStaff });
  const staff = data?.staff ?? [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["field-staff"] });

  const openCreate = (open: boolean) => {
    setCreateOpen(open);
    if (!open) setNewPhoto(KEEP_PHOTO);
  };
  const closeEdit = () => {
    setEditing(null);
    setEditPhoto(KEEP_PHOTO);
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const u = await createFieldStaff({
        name: form.name.trim(),
        username: form.username.trim().toUpperCase(),
        password: form.password,
        role: form.role,
        phone: form.phone,
        email: form.email,
        emp_code: form.emp_code || null,
      });
      // The person exists first; the picture follows, so a failed upload never loses them.
      const photoError = await applyPhotoDraft(newPhoto, (p) => uploadFieldStaffPhoto(u.id, p), () => removeFieldStaffPhoto(u.id));
      return { u, photoError };
    },
    onSuccess: ({ u, photoError }) => {
      if (photoError) toast.warning(`${u.name} added, but the picture didn't save: ${photoError}`);
      else toast.success(`${u.name} added. Share the username and password with them.`);
      openCreate(false);
      setForm(emptyForm);
      refresh();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not add the staff member")),
  });

  const updateMutation = useMutation({
    mutationFn: async (u: FieldStaff) => {
      await updateFieldStaff(u.id, {
        name: u.name,
        username: u.username.trim().toUpperCase(),
        role: u.role,
        phone: u.phone ?? "",
        email: u.email ?? "",
        emp_code: u.emp_code || null,
      });
      return applyPhotoDraft(editPhoto, (p) => uploadFieldStaffPhoto(u.id, p), () => removeFieldStaffPhoto(u.id));
    },
    onSuccess: (photoError) => {
      if (photoError) toast.warning(`Saved, but the picture didn't save: ${photoError}`);
      else toast.success("Saved");
      closeEdit();
      refresh();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not save changes")),
  });

  const statusMutation = useMutation({
    mutationFn: (u: FieldStaff) => setFieldStaffStatus(u.id, !u.is_active),
    onSuccess: (u) => {
      if (u.warning) toast.warning(`${u.name} deactivated`, { description: u.warning, duration: 10000 });
      else toast.success(u.is_active ? `${u.name} reactivated` : `${u.name} deactivated`);
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
      setConfirmPassword("");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not reset the password")),
  });

  const deleteMutation = useMutation({
    mutationFn: (u: FieldStaff) => deleteFieldStaff(u.id),
    onSuccess: (res, u) => {
      toast.success(res.message);
      setDeleteTarget(null);
      // Off the list at once; the refetch confirms it.
      queryClient.setQueryData<{ staff: FieldStaff[] }>(["field-staff"], (old) => old && { staff: old.staff.filter((s) => s.id !== u.id) });
      refresh();
    },
    // Open jobs, payment requests or leave come back as a message saying what to do first.
    onError: (err) => toast.error(apiErrorMessage(err, "Could not delete this person")),
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

  const canCreate =
    !!form.name.trim() &&
    !!form.phone.trim() &&
    !!form.email.trim() &&
    usernameOk(form.username) &&
    passwordsReady(form.password, form.confirm);

  return (
    <>
      <PageHeader
        title="Field Staff"
        description={
          isSuper
            ? "Pasters, Helpers and Drivers. Deactivate people who leave."
            : "Pasters, Helpers and Drivers. View only: the super admin adds and changes accounts."
        }
        crumbs={[{ label: "Work Allocation" }, { label: "Field Staff" }]}
        actions={
          isSuper ? (
            <Button className="rounded-xl" onClick={() => openCreate(true)}>
              <UserPlus className="mr-2 h-4 w-4" /> Add staff
            </Button>
          ) : undefined
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
            {ROLE_PICKS.map(([v, l]) => (
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
            description={staff.length === 0 && isSuper ? "Add your first Paster, Helper or Driver." : undefined}
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
                {isSuper && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((s) => (
                <TableRow key={s.id} className={s.is_active ? "" : "opacity-60"}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <QuickPhoto
                        name={s.name}
                        src={photoSrc(s.photo_url)}
                        editable={isSuper}
                        className="h-8 w-8"
                        fallbackClassName="text-[11px]"
                        onSave={async (picture) => {
                          await uploadFieldStaffPhoto(s.id, picture);
                          refresh();
                        }}
                      />
                      <div>
                        <div className="font-semibold">{s.name}</div>
                        <div className="text-xs text-muted-foreground">@{s.username}</div>
                      </div>
                    </div>
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
                  {isSuper && <TableCell className="whitespace-nowrap text-right">
                    <Button variant="ghost" size="sm" onClick={() => { setEditing({ ...s }); setEditPhoto(KEEP_PHOTO); }}>Edit</Button>
                    <Button variant="ghost" size="sm" onClick={() => { setPwTarget(s); setNewPassword(""); setConfirmPassword(""); }}>Password</Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={s.is_active ? "text-destructive" : "text-success"}
                      disabled={statusMutation.isPending}
                      onClick={() => statusMutation.mutate(s)}
                    >
                      {s.is_active ? "Deactivate" : "Reactivate"}
                    </Button>
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleteTarget(s)}>
                      Delete
                    </Button>
                  </TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Add */}
      <Dialog open={createOpen} onOpenChange={openCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add field staff</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <PhotoField name={form.name} draft={newPhoto} onChange={setNewPhoto} disabled={createMutation.isPending} />
            <div className="grid gap-2">
              <Label htmlFor="fs-name">Name (as used daily)</Label>
              <Input id="fs-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Role</Label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as FieldRole })}>
                  <SelectTrigger aria-label="Role"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLE_PICKS.map(([v, l]) => (
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
            <UsernameField id="fs-user" value={form.username} onChange={(v) => setForm({ ...form, username: v })} />
            <NewPasswordFields
              idPrefix="fs"
              password={form.password}
              confirm={form.confirm}
              onPasswordChange={(v) => setForm({ ...form, password: v })}
              onConfirmChange={(v) => setForm({ ...form, confirm: v })}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => openCreate(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !canCreate}>
              {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && closeEdit()}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit {editing?.name}</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid gap-4 py-2">
              <PhotoField
                name={editing.name}
                currentSrc={photoSrc(editing.photo_url)}
                draft={editPhoto}
                onChange={setEditPhoto}
                disabled={updateMutation.isPending}
              />
              <div className="grid gap-2">
                <Label htmlFor="fe-name">Name</Label>
                <Input id="fe-name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <UsernameField id="fe-user" value={editing.username} onChange={(v) => setEditing({ ...editing, username: v })} />
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label>Role</Label>
                  <Select value={editing.role} onValueChange={(v) => setEditing({ ...editing, role: v as FieldRole })}>
                    <SelectTrigger aria-label="Role"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ROLE_PICKS.map(([v, l]) => (
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
            <Button variant="outline" onClick={closeEdit}>Cancel</Button>
            <Button onClick={() => editing && updateMutation.mutate(editing)} disabled={updateMutation.isPending || !editing?.name || !editing || !usernameOk(editing.username) || !editing?.phone?.trim() || !editing?.email?.trim()}>
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
            <NewPasswordFields
              idPrefix="fs-reset"
              password={newPassword}
              confirm={confirmPassword}
              onPasswordChange={setNewPassword}
              onConfirmChange={setConfirmPassword}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPwTarget(null)}>Cancel</Button>
            <Button onClick={() => passwordMutation.mutate()} disabled={passwordMutation.isPending || !passwordsReady(newPassword, confirmPassword)}>
              {passwordMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Reset password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeletePermanentlyDialog
        target={deleteTarget}
        pending={deleteMutation.isPending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
      />
    </>
  );
}
