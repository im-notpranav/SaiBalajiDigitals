import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { UserPlus, Search, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchUsers, createUser, toggleUserStatus, updateUser, resetUserPassword } from "@/api/users";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-store";
import { ROLES, roleLabel } from "@/lib/constants";

export const Route = createFileRoute("/_portal/admin/users")({
  head: () => ({ meta: [{ title: "User Management — SB OMS" }] }),
  component: UsersPage,
});

function UsersPage() {
  const [q, setQ] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [newUser, setNewUser] = useState({ name: "", username: "", password: "", role: "CSM" as any });
  const [editUser, setEditUser] = useState<any>(null);
  const [isPwDialogOpen, setIsPwDialogOpen] = useState(false);
  const [pwUser, setPwUser] = useState<any>(null);
  const [newPassword, setNewPassword] = useState("");
  
  const { user: currentUser } = useAuth();

  const queryClient = useQueryClient();
  const { data: usersData, isLoading } = useQuery({ queryKey: ["users"], queryFn: fetchUsers });

  const createMutation = useMutation({
    mutationFn: () => createUser(newUser),
    onSuccess: () => {
      toast.success("User created successfully");
      setIsDialogOpen(false);
      setNewUser({ name: "", username: "", password: "", role: "CSM" });
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err: any) => {
      const data = err?.response?.data;
      if (data?.errors && Array.isArray(data.errors)) {
        toast.error(`Validation Error: ${data.errors.map((e: any) => `${e.path.join(".")}: ${e.message}`).join(", ")}`);
      } else {
        toast.error(data?.message || "Failed to create user");
      }
    }
  });

  const updateMutation = useMutation({
    mutationFn: (data: any) => updateUser(data.id, { name: data.name, username: data.username, role: data.role }),
    onSuccess: () => {
      toast.success("User updated successfully");
      setIsEditDialogOpen(false);
      setEditUser(null);
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err: any) => {
      const data = err?.response?.data;
      toast.error(data?.message || "Failed to update user");
    }
  });

  const resetPwMutation = useMutation({
    mutationFn: () => resetUserPassword(pwUser.id, newPassword),
    onSuccess: () => {
      toast.success(`Password reset for ${pwUser?.username}`);
      setIsPwDialogOpen(false);
      setPwUser(null);
      setNewPassword("");
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || "Failed to reset password"),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) => toggleUserStatus(id, is_active),
    onSuccess: () => {
      toast.success("User status updated");
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err: any) => {
      const data = err?.response?.data;
      toast.error(data?.message || "Failed to update user status");
    }
  });

  const users = usersData?.users || [];
  const active = users.filter((u: any) => u.is_active).length;
  const filtered = users.filter((u: any) =>
    `${u.name} ${u.username} ${u.role}`.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <>
      <PageHeader
        title="User Management"
        description="Deactivate rather than delete — historical audit attribution stays intact."
        crumbs={[{ label: "Administrator" }, { label: "Users" }]}
        actions={
          currentUser?.is_super_admin ? (
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
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
                <div className="grid gap-2">
                  <Label>Name</Label>
                  <Input value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label>Username</Label>
                  <Input value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label>Password</Label>
                  <Input type="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label>Role</Label>
                  <Select value={newUser.role} onValueChange={(val) => setNewUser({ ...newUser, role: val })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => (
                        <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !newUser.name || !newUser.username || !newUser.password}>
                  {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Create
                </Button>
              </DialogFooter>
              </DialogContent>
            </Dialog>
          ) : null
        }
      />

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
          </DialogHeader>
          {editUser && (
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label>Name</Label>
                <Input value={editUser.name} onChange={(e) => setEditUser({ ...editUser, name: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>Username</Label>
                <Input value={editUser.username} onChange={(e) => setEditUser({ ...editUser, username: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>Role</Label>
                <Select value={editUser.role} onValueChange={(val) => setEditUser({ ...editUser, role: val })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => updateMutation.mutate(editUser)} disabled={updateMutation.isPending || !editUser?.name || !editUser?.username}>
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
            <div className="grid gap-2">
              <Label>New password</Label>
              <Input
                type="text"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
              />
              {newPassword.length > 0 && newPassword.length < 8 && (
                <p className="text-xs text-destructive">Must be at least 8 characters.</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPwDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => resetPwMutation.mutate()} disabled={resetPwMutation.isPending || newPassword.length < 8}>
              {resetPwMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Reset password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="surface-panel mb-4 p-3">
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search users" className="pl-9" />
        </div>
      </div>

      <div className="surface-panel overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">Loading users...</div>
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
              {filtered.map((u: any) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-9 w-9">
                        {u.photo_url && <AvatarImage src={u.photo_url} alt={u.name} className="object-cover" />}
                        <AvatarFallback className="bg-gradient-to-br from-primary to-primary-deep text-xs font-bold text-primary-foreground">
                          {u.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="font-semibold">{u.name}</div>
                        <div className="text-xs text-muted-foreground">{u.username}</div>
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
                    {new Date(u.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    {currentUser?.is_super_admin && (
                      <Button variant="ghost" size="sm" onClick={() => {
                        setEditUser(u);
                        setIsEditDialogOpen(true);
                      }}>Edit</Button>
                    )}
                    {currentUser?.is_super_admin && (
                      <Button variant="ghost" size="sm" onClick={() => {
                        setPwUser(u);
                        setNewPassword("");
                        setIsPwDialogOpen(true);
                      }}>Password</Button>
                    )}
                    {(!u.is_super_admin) && (
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
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </>
  );
}
