import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-store";

export const Route = createFileRoute("/_portal/employee/profile")({
  head: () => ({ meta: [{ title: "My Profile — SB OMS" }] }),
  component: ProfilePage,
});

function ProfilePage() {
  const { user } = useAuth();
  return (
    <>
      <PageHeader title="My Profile" crumbs={[{ label: "Profile" }]} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="surface-panel flex flex-col items-center p-8 text-center">
          <Avatar className="h-24 w-24">
            <AvatarFallback className="bg-gradient-to-br from-primary to-primary-deep text-2xl font-bold text-primary-foreground">
              {user?.initials}
            </AvatarFallback>
          </Avatar>
          <div className="mt-4 text-lg font-semibold">{user?.name}</div>
          <div className="text-sm text-muted-foreground">{user?.email}</div>
          <div className="mt-2 inline-flex rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold capitalize text-primary">
            {user?.role}
          </div>
        </div>
        <div className="surface-panel space-y-4 p-6 lg:col-span-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Full name</Label>
              <Input defaultValue={user?.name} className="mt-1.5" />
            </div>
            <div>
              <Label>Email</Label>
              <Input defaultValue={user?.email} className="mt-1.5" disabled />
            </div>
            <div>
              <Label>Phone</Label>
              <Input placeholder="+91" className="mt-1.5" />
            </div>
            <div>
              <Label>Department</Label>
              <Input defaultValue="Sales & Order Intake" className="mt-1.5" />
            </div>
          </div>
          <div className="flex justify-end">
            <Button className="rounded-xl">Save changes</Button>
          </div>
        </div>
      </div>
    </>
  );
}
