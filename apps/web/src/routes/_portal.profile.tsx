import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-store";
import { updateMe } from "@/api/users";
import { useMutation, useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/_portal/profile")({
  head: () => ({ meta: [{ title: "My Profile — SB OMS" }] }),
  component: ProfilePage,
});

function ProfilePage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [photoUrl, setPhotoUrl] = useState(user?.photo_url || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const mutation = useMutation({
    mutationFn: updateMe,
    onSuccess: () => {
      toast.success("Profile updated successfully");
      setCurrentPassword("");
      setNewPassword("");
      queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
    },
    onError: (err: any) => {
      toast.error("Failed to update profile", { description: err.message });
    }
  });

  const handleSave = () => {
    const payload: any = {};
    if (name && name !== user?.name) payload.name = name;
    if (email !== user?.email) payload.email = email;
    if (phone !== user?.phone) payload.phone = phone;
    if (photoUrl !== user?.photo_url) payload.photo_url = photoUrl;
    if (newPassword) {
      if (!currentPassword) {
        toast.error("Current password is required to set a new password.");
        return;
      }
      payload.current_password = currentPassword;
      payload.new_password = newPassword;
    }
    
    if (Object.keys(payload).length > 0) {
      mutation.mutate(payload);
    }
  };

  return (
    <>
      <PageHeader title="My Profile" crumbs={[{ label: "Profile" }]} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="surface-panel flex flex-col items-center p-8 text-center">
          <Avatar className="h-24 w-24">
            {user?.photo_url && <AvatarImage src={user.photo_url} alt={user.name} className="object-cover" />}
            <AvatarFallback className="bg-gradient-to-br from-primary to-primary-deep text-2xl font-bold text-primary-foreground">
              {user?.name?.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="mt-4 text-lg font-semibold">{user?.name}</div>
          <div className="text-sm text-muted-foreground">@{user?.username}</div>
          <div className="mt-2 flex gap-2 justify-center">
            <div className="inline-flex rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold capitalize text-primary">
              {user?.role}
            </div>
            {user?.is_super_admin && (
              <div className="inline-flex rounded-full bg-rose-500/10 px-3 py-1 text-xs font-semibold uppercase text-rose-500">
                Super Admin
              </div>
            )}
          </div>
        </div>
        <div className="surface-panel space-y-4 p-6 lg:col-span-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Username</Label>
              <Input value={user?.username} disabled className="bg-muted" />
            </div>
            <div className="space-y-2">
              <Label>Full Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" />
            </div>
            <div className="space-y-2">
              <Label>Phone Number</Label>
              <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone number" />
            </div>
            <div className="sm:col-span-2 space-y-2">
              <Label>Photo URL</Label>
              <Input type="url" value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} placeholder="https://example.com/photo.jpg" />
            </div>
            
            <div className="sm:col-span-2 mt-4 pt-4 border-t">
              <h3 className="text-sm font-semibold mb-4">Change Password</h3>
              <p className="text-xs text-muted-foreground mb-4">Leave these fields blank if you do not wish to change your password. You must provide your current password to set a new one.</p>
            </div>
            
            <div>
              <Label>Current Password</Label>
              <Input 
                type="password" 
                value={currentPassword} 
                onChange={e => setCurrentPassword(e.target.value)} 
                className="mt-1.5" 
              />
            </div>
            <div>
              <Label>New Password</Label>
              <Input 
                type="password" 
                value={newPassword} 
                onChange={e => setNewPassword(e.target.value)} 
                className="mt-1.5" 
              />
            </div>
          </div>
          
          <div className="flex justify-end pt-4 border-t mt-6">
            <Button onClick={handleSave} disabled={mutation.isPending}>
              {mutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
