import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { apiErrorMessage } from "@/api/allocation";
import { useAuth } from "@/lib/auth-store";
import { roleLabel } from "@/lib/constants";
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
  const [whatsapp, setWhatsapp] = useState(!user?.whatsapp_opt_out);
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
      toast.error("Failed to update profile", { description: apiErrorMessage(err, err.message) });
    }
  });

  const buildPayload = () => {
    const payload: any = {};
    if (name && name !== user?.name) payload.name = name;
    // Blank means "no email": sent as null, since the API only accepts a real address.
    if (email !== (user?.email || "")) payload.email = email.trim() || null;
    if (phone !== (user?.phone || "")) payload.phone = phone.trim();
    if (whatsapp === !!user?.whatsapp_opt_out) payload.whatsapp_opt_out = !whatsapp;
    if (photoUrl !== (user?.photo_url || "")) payload.photo_url = photoUrl;
    if (newPassword) {
      payload.current_password = currentPassword;
      payload.new_password = newPassword;
    }
    return payload;
  };
  // Save stays disabled until something has actually changed, rather than doing nothing.
  const dirty = Object.keys(buildPayload()).length > 0;

  const handleSave = () => {
    const payload = buildPayload();
    if (newPassword && !currentPassword) {
      toast.error("Current password is required to set a new password.");
      return;
    }
    if (Object.keys(payload).length > 0) {
      mutation.mutate(payload);
    }
  };

  return (
    <>
      <PageHeader title="My Profile" crumbs={[{ label: "Profile" }]} />
      <div className="grid gap-6 lg:grid-cols-3">
        {/* A row on a phone so the form starts on the first screen; a card from `lg` up. */}
        <div className="surface-panel flex items-center gap-4 p-5 lg:flex-col lg:p-8 lg:text-center">
          <Avatar className="h-16 w-16 shrink-0 lg:h-24 lg:w-24">
            {user?.photo_url && <AvatarImage src={user.photo_url} alt={user.name} className="object-cover" />}
            <AvatarFallback className="bg-gradient-to-br from-primary to-primary-deep text-xl font-bold text-primary-foreground lg:text-2xl">
              {user?.name?.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="truncate text-lg font-semibold">{user?.name}</div>
            <div className="truncate text-sm text-muted-foreground">@{user?.username}</div>
            <div className="mt-2 flex flex-wrap gap-2 lg:justify-center">
              <div className="inline-flex rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                {roleLabel(user?.role)}
              </div>
              {user?.is_super_admin && (
                <div className="inline-flex rounded-full bg-rose-500/10 px-3 py-1 text-xs font-semibold uppercase text-rose-500">
                  Super Admin
                </div>
              )}
            </div>
          </div>
        </div>
        <form
          className="surface-panel space-y-4 p-5 sm:p-6 lg:col-span-2"
          onSubmit={(e) => {
            e.preventDefault();
            handleSave();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="profile-username">Username</Label>
              <Input id="profile-username" value={user?.username} disabled className="bg-muted" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-name">Full Name</Label>
              <Input id="profile-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-email">Email</Label>
              <Input id="profile-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-phone">Mobile Number</Label>
              <Input id="profile-phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit mobile number" />
            </div>
            <div className="sm:col-span-2 flex items-center justify-between gap-3 rounded-xl border px-3 py-3">
              <div>
                <Label htmlFor="profile-whatsapp" className="text-sm font-medium">WhatsApp messages</Label>
                <div id="profile-whatsapp-hint" className="text-xs text-muted-foreground">
                  Job, payment and order updates on WhatsApp at this number. In-app notifications arrive either way.
                </div>
              </div>
              <Switch
                id="profile-whatsapp"
                checked={whatsapp}
                onCheckedChange={setWhatsapp}
                aria-label="WhatsApp messages"
                aria-describedby="profile-whatsapp-hint"
              />
            </div>
            <div className="sm:col-span-2 space-y-2">
              <Label htmlFor="profile-photo">Photo URL</Label>
              <Input id="profile-photo" type="url" value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} placeholder="https://example.com/photo.jpg" />
            </div>

            <div className="sm:col-span-2 mt-2 border-t pt-4">
              <h2 className="text-sm font-semibold">Change Password</h2>
              <p className="mt-1 text-xs text-muted-foreground">Leave these fields blank if you do not wish to change your password. You must provide your current password to set a new one.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="profile-current-password">Current Password</Label>
              <Input
                id="profile-current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-new-password">New Password</Label>
              <Input
                id="profile-new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
              />
            </div>
          </div>

          <div className="mt-6 flex justify-end border-t pt-4">
            <Button type="submit" className="w-full sm:w-auto" disabled={!dirty || mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mutation.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}
