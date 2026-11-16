import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { shrinkImage } from "@/lib/image";
import { cn } from "@/lib/utils";
import { friendlyError } from "@/lib/friendly-error";

/**
 * Pieces shared by the two pages where an admin manages people: Users (office accounts) and
 * Field Staff. Pictures are the admin's to set; people no longer upload their own.
 */

/** "Ravi Teja" → "RT". */
export const initials = (name?: string | null) =>
  (name ?? "")
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

/** A new account's username box starts with this; the admin may delete it. */
export const USERNAME_PREFIX = "SBD";

/** Same rule as the API: 3–50 capitals, numbers or underscores, after trimming. */
export const usernameOk = (v: string) => /^[A-Z0-9_]{3,50}$/.test(v.trim().toUpperCase());

/**
 * The username box. Usernames are stored in capitals, so what is typed shows in capitals
 * straight away; the hint turns red as soon as something that can't be saved is typed.
 */
export function UsernameField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const bad = value.trim().length > 0 && /[^A-Z0-9_]/.test(value.trim().toUpperCase());
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>Username</Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        aria-invalid={bad || undefined}
        aria-describedby={`${id}-hint`}
      />
      <p id={`${id}-hint`} className={cn("text-xs", bad ? "text-destructive" : "text-muted-foreground")}>
        {bad ? "Use only letters, numbers and _ (no spaces)." : "Letters, numbers and _ only. At least 3."}
      </p>
    </div>
  );
}

/** A CSM code as the API takes it: 1–20 letters or digits. */
export const csmCodeOk = (v: string) => /^[A-Z0-9]{1,20}$/.test(v.trim().toUpperCase());

/** What the admin did to the picture in a form. Nothing is sent until the form is saved. */
export type PhotoDraft =
  | { kind: "keep" }
  | { kind: "set"; picture: Blob; preview: string }
  | { kind: "remove" };

export const KEEP_PHOTO: PhotoDraft = { kind: "keep" };

/**
 * Sends a picture change once the person exists. Returns the error message when the picture
 * could not be saved, so the caller can say the rest went through.
 */
export async function applyPhotoDraft(
  draft: PhotoDraft,
  upload: (picture: Blob) => Promise<unknown>,
  remove: () => Promise<unknown>,
): Promise<string | null> {
  try {
    if (draft.kind === "set") await upload(draft.picture);
    else if (draft.kind === "remove") await remove();
    return null;
  } catch (err: any) {
    return friendlyError(err) || "Could not save the picture.";
  }
}

/**
 * The shrunk picture is a few KB, so its preview is a data URL: nothing to revoke when the
 * dialog closes or the admin picks again.
 */
const asDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/**
 * The picture on a New / Edit form: the current one (or initials), with Upload / Change and
 * Remove. The picture is shrunk in the browser as soon as it is chosen, so a bad file is
 * caught here rather than on save, and the preview is what will be sent.
 */
export function PhotoField({
  name,
  currentSrc,
  draft,
  onChange,
  disabled,
}: {
  name: string;
  /** The saved picture, if any. */
  currentSrc?: string;
  draft: PhotoDraft;
  onChange: (draft: PhotoDraft) => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);

  const shown = draft.kind === "set" ? draft.preview : draft.kind === "remove" ? undefined : currentSrc;

  const choose = async (file: File) => {
    setReading(true);
    try {
      const picture = await shrinkImage(file, { maxSide: 256, square: true });
      onChange({ kind: "set", picture, preview: await asDataUrl(picture) });
    } catch {
      toast.error("Could not read that picture. Use a JPG or PNG.");
    } finally {
      setReading(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="flex items-center gap-4">
      <Avatar className="h-16 w-16 shrink-0">
        {shown && <AvatarImage src={shown} alt={name || "Picture"} className="object-cover" />}
        <AvatarFallback className="bg-gradient-to-br from-primary to-primary-deep text-lg font-bold text-primary-foreground">
          {initials(name) || <Camera className="h-5 w-5" aria-hidden />}
        </AvatarFallback>
      </Avatar>
      <div className="flex flex-wrap gap-2">
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          aria-label="Choose a picture"
          onChange={(e) => e.target.files?.[0] && choose(e.target.files[0])}
        />
        <Button type="button" variant="outline" size="sm" disabled={disabled || reading} onClick={() => input.current?.click()}>
          {reading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}
          {shown ? "Change picture" : "Upload picture"}
        </Button>
        {shown && (
          <Button type="button" variant="ghost" size="sm" disabled={disabled || reading} onClick={() => onChange({ kind: "remove" })}>
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * A person's picture in a list or on a profile. For the super admin it is also the quickest
 * way to change it: click (or tap) the picture, choose a file, and it saves at once, with no
 * form to open. Everyone else sees a plain picture. Removing a picture stays in Edit.
 */
export function QuickPhoto({
  name,
  src,
  editable,
  onSave,
  className = "h-9 w-9",
  fallbackClassName = "text-xs",
}: {
  name: string;
  src?: string;
  /** Only the super admin may change pictures. */
  editable: boolean;
  /** Uploads the shrunk picture; the caller refreshes its lists. */
  onSave: (picture: Blob) => Promise<unknown>;
  className?: string;
  fallbackClassName?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  // The picture just chosen shows straight away, before the list refetches.
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => setPreview(null), [src]);

  const avatar = (
    <Avatar className={cn("shrink-0", className)}>
      {(preview ?? src) && <AvatarImage src={preview ?? src} alt={name} className="object-cover" loading="lazy" />}
      <AvatarFallback className={cn("bg-gradient-to-br from-primary to-primary-deep font-bold text-primary-foreground", fallbackClassName)}>
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
  if (!editable) return avatar;

  const choose = async (file: File) => {
    setSaving(true);
    try {
      const picture = await shrinkImage(file, { maxSide: 256, square: true });
      setPreview(await asDataUrl(picture));
      await onSave(picture);
      toast.success(`Picture updated for ${name}`);
    } catch (err: any) {
      setPreview(null);
      toast.error(friendlyError(err, "Could not save that picture. Use a JPG or PNG."));
    } finally {
      setSaving(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => e.target.files?.[0] && choose(e.target.files[0])}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={saving}
        title="Change picture"
        aria-label={`Change picture for ${name}`}
        className="group relative shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {avatar}
        {/* Camera hint: on hover or keyboard focus for mouse users, always a small badge on touch. */}
        <span
          aria-hidden
          className={cn(
            "absolute inset-0 grid place-items-center rounded-full bg-black/45 text-white transition-opacity",
            saving ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
          )}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
        </span>
        <span
          aria-hidden
          className="absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full border-2 border-background bg-primary text-primary-foreground [@media(hover:hover)]:hidden"
        >
          <Camera className="h-2.5 w-2.5" />
        </span>
      </button>
    </>
  );
}

/**
 * "Delete permanently": the person can never sign in again and their contact details go,
 * but their history stays, shown as "Deleted user (name)". The admin types the username to
 * confirm, because this cannot be undone.
 */
export function DeletePermanentlyDialog({
  target,
  pending,
  onCancel,
  onConfirm,
}: {
  target: { name: string; username: string } | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState("");
  // Start blank for each person.
  useEffect(() => setTyped(""), [target?.username]);
  const matches = !!target && typed.trim().toUpperCase() === target.username.toUpperCase();

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && !pending && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {target?.name} permanently?</DialogTitle>
          <DialogDescription>This can't be undone.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-sm">
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
            <div className="font-medium text-destructive">Removed</div>
            <p className="mt-1 text-muted-foreground">
              Their login, mobile, email, picture, employee code and CSM codes. They can't sign in again, and the
              username becomes free for someone else.
            </p>
          </div>
          <div className="rounded-xl border p-3">
            <div className="font-medium">Kept</div>
            <p className="mt-1 text-muted-foreground">
              Orders, jobs, payment requests, leave, overtime and change logs. They show as{" "}
              <strong className="text-foreground">Deleted user ({target?.name})</strong>.
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="delete-confirm">
              Type <strong className="font-mono">{target?.username}</strong> to confirm
            </Label>
            <Input
              id="delete-confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value.toUpperCase())}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className={cn("font-mono", matches && "border-destructive")}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={!matches || pending}>
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
            Delete permanently
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
