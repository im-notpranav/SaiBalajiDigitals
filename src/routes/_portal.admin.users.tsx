import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { UserPlus, Search } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { APP_USERS } from "@/lib/mock-data";
import { toast } from "sonner";

export const Route = createFileRoute("/_portal/admin/users")({
  head: () => ({ meta: [{ title: "User Management — SB OMS" }] }),
  component: UsersPage,
});

function UsersPage() {
  const [q, setQ] = useState("");
  const filtered = APP_USERS.filter((u) =>
    `${u.name} ${u.email} ${u.role}`.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <>
      <PageHeader
        title="User Management"
        description="Deactivate rather than delete — historical audit attribution stays intact."
        crumbs={[{ label: "Administrator" }, { label: "Users" }]}
        actions={
          <Button className="rounded-xl" onClick={() => toast.success("Invite sent")}>
            <UserPlus className="mr-2 h-4 w-4" /> New user
          </Button>
        }
      />

      <div className="surface-panel mb-4 p-3">
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search users" className="pl-9" />
        </div>
      </div>

      <div className="surface-panel overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead>User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last active</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Avatar className="h-9 w-9">
                      <AvatarFallback className="bg-gradient-to-br from-primary to-primary-deep text-xs font-bold text-primary-foreground">
                        {u.name.split(" ").map((n) => n[0]).join("")}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="font-semibold">{u.name}</div>
                      <div className="text-xs text-muted-foreground">{u.email}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="capitalize">{u.role}</Badge>
                </TableCell>
                <TableCell>
                  {u.status === "active" ? (
                    <Badge className="bg-success/15 text-success hover:bg-success/20">Active</Badge>
                  ) : (
                    <Badge variant="secondary">Inactive</Badge>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{u.lastActive}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => toast.info(`Edit ${u.name}`)}>Edit</Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={u.status === "active" ? "text-destructive" : "text-success"}
                    onClick={() => toast.success(`${u.status === "active" ? "Deactivated" : "Reactivated"} ${u.name}`)}
                  >
                    {u.status === "active" ? "Deactivate" : "Reactivate"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
