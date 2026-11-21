import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { UserPlus, Search, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState, LoadingState } from "@/components/layout/PageStates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { NewPasswordFields, passwordsReady } from "@/components/ui/password-input";
import {
  DeletePermanentlyDialog,
  KEEP_PHOTO,
  PhotoField,
  QuickPhoto,
  USERNAME_PREFIX,
  UsernameField,
  applyPhotoDraft,
  csmCodeOk,
  usernameOk,
  type PhotoDraft,
} from "@/components/users/UserBits";
import { UserSheetButtons } from "@/components/users/UserSheetButtons";
import { apiErrorMessage } from "@/api/allocation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchUsers,
  createUser,
  deleteUser,
  toggleUserStatus,
  updateUser,
  resetUserPassword,
  photoSrc,
  uploadUserPhoto,
  removeUserPhoto,
  type UserRow,
} from "@/api/users";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-store";
import { ROLES, roleLabel } from "@/lib/constants";
import { friendlyError } from "@/lib/friendly-error";

export const Route = createFileRoute("/_portal/admin/users")({
  head: () => ({ meta: [{ title: "User Management — SB OMS" }] }),
  component: UsersPage,
});

const blankUser = {
  name: "",
  username: USERNAME_PREFIX,
  phone: "",
  email: "",
  password: "",
  confirm: "",
  role: "HELPER" as any,
  csm_code: "",
};

/** The edit form: the row, plus the CSM code box and the code it started with. */
type EditDraft = UserRow & { csm_code: string; original_csm_code: string };

function UsersPage() {
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [newUser, setNewUser] = useState(blankUser);
  const [newPhoto, setNewPhoto] = useState<PhotoDraft>(KEEP_PHOTO);
  const [editUser, setEditUser] = useState<EditDraft | null>(null);
  const [editPhoto, setEditPhoto] = useState<PhotoDraft>(KEEP_PHOTO);
  const [isPwDialogOpen, setIsPwDialogOpen] = useState(false);
  const [pwUser, setPwUser] = useState<any>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);

  const { user: currentUser } = useAuth();

  const queryClient = useQueryClient();
  const { data: usersData, isLoading, error, refetch } = useQuery({ queryKey: ["users"], queryFn: fetchUsers });

  /** A picture change on your own account shows in the top bar too. */
  const refreshUsers = (changedId?: number) => {
    queryClient.invalidateQueries({ queryKey: ["users"] });
    // Field staff made or changed here must show in the job form's people pickers at once.
    queryClient.invalidateQueries({ queryKey: ["field-staff"] });
    if (changedId && changedId === currentUser?.id) queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
  };

  const openCreate = (open: boolean) => {
    setIsDialogOpen(open);
    if (!open) setNewPhoto(KEEP_PHOTO);
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const isCsm = newUser.role === "CSM";
      const { user } = await createUser({
        name: newUser.name.trim(),
        username: newUser.username.trim().toUpperCase(),
        password: newUser.password,
        role: newUser.role,
        phone: newUser.phone.trim(),
        email: newUser.email.trim(),
        csm_code: isCsm ? newUser.csm_code.trim().toUpperCase() : null,
      });
      // The account exists first; the picture follows, so a failed upload never loses the account.
      const photoError = await applyPhotoDraft(newPhoto, (p) => uploadUserPhoto(user.id, p), () => removeUserPhoto(user.id));
      return { photoError };
    },
    onSuccess: ({ photoError }) => {
      if (photoError) toast.warning(`User created, but the picture didn't save: ${photoError}`);
      else toast.success("User created");
      openCreate(false);
      setNewUser(blankUser);
      refreshUsers();
    },
    onError: (err: any) => toast.error(apiErrorMessage(err, "Failed to create user")),
  });

  const updateMutation = useMutation({
    mutationFn: async (data: EditDraft) => {
      const code = data.csm_code.trim().toUpperCase();
      const codeChanged = data.role === "CSM" && !!code && code !== data.original_csm_code;
      // The box emptied on a CSM who had a code: remove that code.
      const codeRemoved = data.role === "CSM" && !code && !!data.original_csm_code;
      await updateUser(data.id, {
        name: data.name,
        username: data.username.trim().toUpperCase(),
        role: data.role,
        phone: (data.phone ?? "").trim(),
        email: (data.email ?? "").trim(),
        whatsapp_opt_out: !!data.whatsapp_opt_out,
        emp_code: data.emp_code?.trim() || null,
        ...(codeChanged ? { csm_code: code, replace_csm_code: data.original_csm_code || null } : {}),
        ...(codeRemoved ? { csm_code: null, replace_csm_code: data.original_csm_code } : {}),
      });
      return applyPhotoDraft(editPhoto, (p) => uploadUserPhoto(data.id, p), () => removeUserPhoto(data.id));
    },
    onSuccess: (photoError, data) => {
      if (photoError) toast.warning(`Saved, but the picture didn't save: ${photoError}`);
      else toast.success("User updated successfully");
      setIsEditDialogOpen(false);
      setEditUser(null);
      setEditPhoto(KEEP_PHOTO);
      refreshUsers(data.id);
    },
    onError: (err: any) => toast.error(apiErrorMessage(err, "Failed to update user")),
  });

  const resetPwMutation = useMutation({
    mutationFn: () => resetUserPassword(pwUser.id, newPassword),
    onSuccess: () => {
      toast.success(`Password reset for ${pwUser?.username}`);
      setIsPwDialogOpen(false);
      setPwUser(null);
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (err: any) => toast.error(friendlyError(err, "Failed to reset password")),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) => toggleUserStatus(id, is_active),
    onSuccess: () => {
      toast.success("User status updated");
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["field-staff"] });
    },
    onError: (err: any) => {
      toast.error(friendlyError(err, "Failed to update user status"));
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (u: UserRow) => deleteUser(u.id),
    onSuccess: (res, u) => {
      toast.success(res.message);
      setDeleteTarget(null);
      // Off the list at once; the refetch confirms it.
      queryClient.setQueryData<{ users: UserRow[] }>(["users"], (old) => old && { users: old.users.filter((x) => x.id !== u.id) });
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["field-staff"] });
    },
    // Open work and the last-admin rule come back as a message saying what to do first.
    onError: (err: any) => toast.error(apiErrorMessage(err, "Could not delete this user")),
  });

  const users = usersData?.users || [];
  const missingDetails = (u: any) => u.is_active && (!u.phone || !u.email);
  const missingCount = users.filter(missingDetails).length;
  const needle = q.trim().toLowerCase();
  // Search by name, username, role, mobile, email or CSM code; narrow by role; always A to Z by name.
  const filtered = users
    .filter(
      (u: UserRow) =>
        (roleFilter === "ALL" || u.role === roleFilter) &&
        (!onlyMissing || missingDetails(u)) &&
        (!needle ||
          `${u.name} ${u.username} ${roleLabel(u.role)} ${u.phone ?? ""} ${u.email ?? ""} ${(u.csmCodes ?? []).map((c) => c.code).join(" ")}`
            .toLowerCase()
            .includes(needle)),
    )
    .sort(
      (a: UserRow, b: UserRow) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }) ||
        a.username.localeCompare(b.username, undefined, { sensitivity: "base", numeric: true }),
    );
  const filtering = !!needle || roleFilter !== "ALL" || onlyMissing;

  const newIsCsm = newUser.role === "CSM";
  const canCreate =
    !!newUser.name.trim() &&
    usernameOk(newUser.username) &&
    !!newUser.phone.trim() &&
    !!newUser.email.trim() &&
    passwordsReady(newUser.password, newUser.confirm) &&
    (!newIsCsm || csmCodeOk(newUser.csm_code));

  const editCodes = editUser?.csmCodes ?? [];
  const editCodeOk = !editUser || editUser.role !== "CSM" || !editUser.csm_code.trim() || csmCodeOk(editUser.csm_code);

  return (
    <>
      <PageHeader
        title="User Management"
        description="Deactivate to pause an account. Deleting keeps their history."
        crumbs={[{ label: "Automated System" }, { label: "Users" }]}
        actions={
          currentUser?.is_super_admin ? (
            <div className="flex flex-wrap items-center gap-2">
            <UserSheetButtons />
            <Dialog open={isDialogOpen} onOpenChange={openCreate}>
              <DialogTrigger asChild>
                <Button className="rounded-xl">
                  <UserPlus className="mr-2 h-4 w-4" /> New user
                </Button>
              </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New User</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <PhotoField name={newUser.name} draft={newPhoto} onChange={setNewPhoto} disabled={createMutation.isPending} />
                <div className="grid gap-2">
                  <Label htmlFor="nu-name">Name</Label>
                  <Input id="nu-name" value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} />
                </div>
                <UsernameField id="nu-username" value={newUser.username} onChange={(v) => setNewUser({ ...newUser, username: v })} />
                <div className="grid gap-2">
                  <Label>Role</Label>
                  <Select value={newUser.role} onValueChange={(val) => setNewUser({ ...newUser, role: val })}>
                    <SelectTrigger aria-label="Role"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => (
                        <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {newIsCsm && (
                  <div className="grid gap-2">
                    <Label htmlFor="nu-csm-code">CSM code</Label>
                    <Input
                      id="nu-csm-code"
                      value={newUser.csm_code}
                      onChange={(e) => setNewUser({ ...newUser, csm_code: e.target.value.toUpperCase() })}
                      placeholder="e.g. 300"
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      maxLength={20}
                    />
                    <p className="text-xs text-muted-foreground">Not the employee code. Letters and numbers only.</p>
                  </div>
                )}
                <div className="grid gap-2">
                  <Label htmlFor="nu-phone">Mobile number</Label>
                  <Input id="nu-phone" type="tel" inputMode="tel" value={newUser.phone} onChange={(e) => setNewUser({ ...newUser, phone: e.target.value })} placeholder="10-digit mobile, e.g. 98765 43210" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="nu-email">Email</Label>
                  <Input id="nu-email" type="email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} />
                </div>
                <NewPasswordFields
                  idPrefix="nu"
                  password={newUser.password}
                  confirm={newUser.confirm}
                  onPasswordChange={(v) => setNewUser({ ...newUser, password: v })}
                  onConfirmChange={(v) => setNewUser({ ...newUser, confirm: v })}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => openCreate(false)}>Cancel</Button>
                <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !canCreate}>
                  {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Create
                </Button>
              </DialogFooter>
              </DialogContent>
            </Dialog>
            </div>
          ) : null
        }
      />

      <Dialog
        open={isEditDialogOpen}
        onOpenChange={(open) => {
          setIsEditDialogOpen(open);
          if (!open) setEditPhoto(KEEP_PHOTO);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
          </DialogHeader>
          {editUser && (
            <div className="grid gap-4 py-4">
              <PhotoField
                name={editUser.name}
                currentSrc={photoSrc(editUser.photo_url)}
                draft={editPhoto}
                onChange={setEditPhoto}
                disabled={updateMutation.isPending}
              />
              <div className="grid gap-2">
                <Label htmlFor="eu-name">Name</Label>
                <Input id="eu-name" value={editUser.name} onChange={(e) => setEditUser({ ...editUser, name: e.target.value })} />
              </div>
              <UsernameField id="eu-username" value={editUser.username} onChange={(v) => setEditUser({ ...editUser, username: v })} />
              <div className="grid gap-2">
                <Label htmlFor="eu-emp-code">Employee code <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Input
                  id="eu-emp-code"
                  value={editUser.emp_code ?? ""}
                  onChange={(e) => setEditUser({ ...editUser, emp_code: e.target.value })}
                  placeholder="e.g. 300"
                  autoComplete="off"
                  maxLength={20}
                />
              </div>
              <div className="grid gap-2">
                <Label>Role</Label>
                <Select
                  value={editUser.role}
                  onValueChange={(val) => setEditUser({ ...editUser, role: val as EditDraft["role"] })}
                  // Your own role is locked, so you can't move yourself out of the admin portal.
                  disabled={editUser.id === currentUser?.id}
                >
                  <SelectTrigger aria-label="Role"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {editUser.role === "CSM" && (
                <div className="grid gap-2">
                  <Label htmlFor="eu-csm-code">CSM code</Label>
                  <Input
                    id="eu-csm-code"
                    value={editUser.csm_code}
                    onChange={(e) => setEditUser({ ...editUser, csm_code: e.target.value.toUpperCase() })}
                    placeholder={editCodes.length ? undefined : "Optional, e.g. 300"}
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    maxLength={20}
                    aria-invalid={!editCodeOk || undefined}
                  />
                  <p className={editCodeOk ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
                    {!editCodeOk
                      ? "Letters and numbers only."
                      : editCodes.length > 1
                        ? `Also holds ${editCodes.slice(1).map((c) => c.code).join(", ")}. Change this one, or empty the box to remove it.`
                        : editCodes.length === 1
                          ? editUser.csm_code.trim()
                            ? "Change it, or empty the box to remove it."
                            : `Saving removes code ${editUser.original_csm_code}.`
                          : "No CSM code yet."}
                  </p>
                </div>
              )}
              <div className="grid gap-2">
                <Label htmlFor="eu-phone">Mobile number</Label>
                <Input
                  id="eu-phone"
                  type="tel"
                  inputMode="tel"
                  value={editUser.phone ?? ""}
                  onChange={(e) => setEditUser({ ...editUser, phone: e.target.value })}
                  placeholder="10-digit mobile, e.g. 98765 43210"
                />
                <p className="text-xs text-muted-foreground">Used for WhatsApp notifications.</p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="eu-email">Email</Label>
                <Input id="eu-email" type="email" value={editUser.email ?? ""} onChange={(e) => setEditUser({ ...editUser, email: e.target.value })} />
              </div>
              <div className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2">
                <div>
                  <div className="text-sm font-medium">WhatsApp messages</div>
                  <div className="text-xs text-muted-foreground">In-app notifications arrive either way.</div>
                </div>
                <Switch
                  checked={!editUser.whatsapp_opt_out}
                  onCheckedChange={(on) => setEditUser({ ...editUser, whatsapp_opt_out: !on })}
                  aria-label="WhatsApp messages"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsEditDialogOpen(false); setEditPhoto(KEEP_PHOTO); }}>Cancel</Button>
            <Button
              onClick={() => editUser && updateMutation.mutate(editUser)}
              disabled={updateMutation.isPending || !editUser?.name || !editUser || !usernameOk(editUser.username) || !editUser?.phone?.trim() || !editUser?.email?.trim() || !editCodeOk}
            >
              {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isPwDialogOpen} onOpenChange={setIsPwDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset password{pwUser ? ` — ${pwUser.name}` : ""}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <p className="text-sm text-muted-foreground">
              Sets a new password for <strong>@{pwUser?.username}</strong> immediately. They are not asked for
              their old password, so share the new one with them directly.
            </p>
            <NewPasswordFields
              idPrefix="reset"
              password={newPassword}
              confirm={confirmPassword}
              onPasswordChange={setNewPassword}
              onConfirmChange={setConfirmPassword}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPwDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => resetPwMutation.mutate()} disabled={resetPwMutation.isPending || !passwordsReady(newPassword, confirmPassword)}>
              {resetPwMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
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

      <div className="surface-panel mb-4 flex flex-wrap items-center gap-3 p-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" placeholder="Search name, username, mobile, email" className="pl-9" />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger aria-label="Filter by role" className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All roles</SelectItem>
            {ROLES.map((r) => (
              <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(missingCount > 0 || onlyMissing) && (
          <Button variant={onlyMissing ? "secondary" : "outline"} size="sm" onClick={() => setOnlyMissing((v) => !v)}>
            {missingCount} missing mobile or email
          </Button>
        )}
      </div>

      <div className="surface-panel overflow-hidden">
        {isLoading ? (
          <LoadingState bare label="Loading users…" />
        ) : error && !usersData ? (
          <ErrorState bare title="Couldn't load users" error={error} onRetry={() => refetch()} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      {/* The super admin changes anyone's picture, his own included, with one click. */}
                      <QuickPhoto
                        name={u.name}
                        src={photoSrc(u.photo_url)}
                        editable={!!currentUser?.is_super_admin}
                        onSave={async (picture) => {
                          await uploadUserPhoto(u.id, picture);
                          refreshUsers(u.id);
                        }}
                      />
                      <div>
                        <div className="font-semibold">{u.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {u.username}
                          {u.csmCodes?.length ? ` · CSM ${u.csmCodes.map((c) => c.code).join(", ")}` : ""}
                          {" · "}
                          {u.phone ? u.phone : <span className="text-warning">no phone</span>}
                          {" · "}
                          {u.email ? u.email : <span className="text-warning">no email</span>}
                          {u.whatsapp_opt_out && " · WhatsApp off"}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{roleLabel(u.role)}</Badge>
                      {u.is_super_admin && (
                        <Badge className="bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 capitalize border-rose-500/20">
                          Super Admin
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {u.is_active ? (
                      <Badge className="bg-success/15 text-success hover:bg-success/20">Active</Badge>
                    ) : (
                      <Badge variant="secondary">Inactive</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {u.created_at ? new Date(u.created_at).toLocaleDateString() : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {currentUser?.is_super_admin && (
                      <Button variant="ghost" size="sm" onClick={() => {
                        const first = u.csmCodes?.[0]?.code ?? "";
                        setEditUser({ ...u, csm_code: first, original_csm_code: first });
                        setEditPhoto(KEEP_PHOTO);
                        setIsEditDialogOpen(true);
                      }}>Edit</Button>
                    )}
                    {currentUser?.is_super_admin && (
                      <Button variant="ghost" size="sm" onClick={() => {
                        setPwUser(u);
                        setNewPassword("");
                        setConfirmPassword("");
                        setIsPwDialogOpen(true);
                      }}>Password</Button>
                    )}
                    {/* Switching accounts off is the super admin's, like creating them (D-01). */}
                    {currentUser?.is_super_admin && !u.is_super_admin && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className={u.is_active ? "text-destructive" : "text-success"}
                        onClick={() => toggleMutation.mutate({ id: u.id, is_active: !u.is_active })}
                        disabled={toggleMutation.isPending}
                      >
                        {u.is_active ? "Deactivate" : "Reactivate"}
                      </Button>
                    )}
                    {/* So is deleting for good (D-01); never yourself or the super admin. */}
                    {currentUser?.is_super_admin && !u.is_super_admin && u.id !== currentUser.id && (
                      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleteTarget(u)}>
                        Delete
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                    {filtering ? "No users match these filters." : "No users yet."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </div>
    </>
  );
}
