import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Download, FileText, Loader2, Paperclip, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiErrorMessage } from "@/api/allocation";
import {
  ATTACHMENT_KIND_LABELS,
  FILE_ACCEPT,
  fileUrl,
  formatBytes,
  formatWhen,
  removePaymentFile,
  uploadPaymentFile,
  type AttachmentKind,
  type PaymentAttachment,
  type PaymentRequest,
} from "@/api/payments";

/** Browsers can draw these inline; HEIC and PDF open in a new tab instead. */
const isPreviewable = (mime: string) => /^image\/(jpeg|png|webp)$/.test(mime);

const ADD_LABELS: Record<AttachmentKind, string> = {
  BILL: "Add bill",
  PHOTO: "Add photos",
  RECEIPT: "Add receipt",
};

/** Bills, photos and receipts on one request: view them, add more, remove your own. */
export function AttachmentsPanel({
  request,
  attachments,
}: {
  request: PaymentRequest;
  attachments: PaymentAttachment[];
}) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<AttachmentKind>("BILL");
  const [busy, setBusy] = useState<string | null>(null);
  const [viewing, setViewing] = useState<PaymentAttachment | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null);
  // Removing someone else's file asks why; the reason goes in the request's history.
  const [askWhy, setAskWhy] = useState<PaymentAttachment | null>(null);
  const [why, setWhy] = useState("");

  const refresh = () => qc.invalidateQueries({ queryKey: ["payment-requests"] });

  const pick = (k: AttachmentKind) => {
    setKind(k);
    // Let the state settle so `multiple` matches the kind before the picker opens.
    setTimeout(() => input.current?.click(), 0);
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    let added = 0;
    for (const file of Array.from(files)) {
      setBusy(file.name);
      try {
        await uploadPaymentFile(request.id, kind, file);
        added++;
      } catch (err) {
        toast.error(
          err instanceof Error && !("response" in err)
            ? err.message
            : apiErrorMessage(err, `Could not add ${file.name}`),
        );
      }
    }
    setBusy(null);
    if (input.current) input.current.value = "";
    if (added) toast.success(`${added} file${added === 1 ? "" : "s"} added`);
    refresh();
  };

  const remove = async (f: PaymentAttachment, note?: string) => {
    setConfirmRemove(null);
    if (f.remove_needs_note && !note) {
      setWhy("");
      setAskWhy(f);
      return;
    }
    setAskWhy(null);
    try {
      await removePaymentFile(request.id, f.id, note);
      toast.success(`${f.name} removed`);
      refresh();
    } catch (err) {
      toast.error(apiErrorMessage(err, "Could not remove the file"));
    }
  };

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          <Paperclip className="h-4 w-4" /> Bills and photos
          <span className="font-normal text-muted-foreground">({attachments.length})</span>
        </div>
      </div>

      {request.bill_missing && (
        <div className="flex items-start gap-1.5 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          This request was raised with bill details. Attach the bill before it can be approved
          for payment or closed.
        </div>
      )}

      {attachments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No files yet.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {attachments.map((f) => (
            <li key={f.id} className="overflow-hidden rounded-xl border bg-card">
              {isPreviewable(f.mime) ? (
                <button
                  type="button"
                  className="block aspect-[4/3] w-full bg-muted"
                  onClick={() => setViewing(f)}
                  aria-label={`View ${f.name}`}
                >
                  <img
                    src={fileUrl(f.url)}
                    alt={f.name}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </button>
              ) : (
                <a
                  href={fileUrl(f.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-1 bg-muted text-muted-foreground hover:text-foreground"
                >
                  <FileText className="h-7 w-7" />
                  <span className="text-xs">
                    {f.mime === "application/pdf" ? "Open PDF" : "Open photo"}
                  </span>
                </a>
              )}
              <div className="grid gap-0.5 p-2">
                <div className="flex items-center justify-between gap-1">
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                      f.kind === "BILL"
                        ? "bg-primary/10 text-primary"
                        : f.kind === "RECEIPT"
                          ? "bg-success/15 text-success"
                          : "bg-muted text-muted-foreground",
                    )}
                  >
                    {ATTACHMENT_KIND_LABELS[f.kind]}
                  </span>
                  <span className="flex items-center">
                    <a
                      href={fileUrl(f.url, true)}
                      className="rounded p-1 text-muted-foreground hover:text-foreground"
                      aria-label={`Download ${f.name}`}
                    >
                      <Download className="h-3.5 w-3.5" />
                    </a>
                    {f.can_remove &&
                      (confirmRemove === f.id ? (
                        <button
                          type="button"
                          className="rounded px-1 text-[11px] font-medium text-destructive"
                          onClick={() => remove(f)}
                        >
                          Remove?
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="rounded p-1 text-muted-foreground hover:text-destructive"
                          aria-label={`Remove ${f.name}`}
                          onClick={() => setConfirmRemove(f.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ))}
                  </span>
                </div>
                <div className="truncate text-xs" title={f.name}>
                  {f.name}
                </div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {formatBytes(f.size_bytes)} · {f.uploader?.name ?? "—"} ·{" "}
                  {formatWhen(f.uploaded_at)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {request.attach_kinds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {request.attach_kinds.map((k) => (
            <Button
              key={k}
              type="button"
              size="sm"
              variant={k === "BILL" && request.bill_missing ? "default" : "outline"}
              disabled={!!busy}
              onClick={() => pick(k)}
            >
              {ADD_LABELS[k]}
            </Button>
          ))}
          {busy ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Adding {busy}…
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Photos or PDF, up to 5 MB each.</span>
          )}
          <input
            ref={input}
            type="file"
            accept={FILE_ACCEPT}
            multiple={kind === "PHOTO"}
            className="hidden"
            onChange={(e) => onFiles(e.target.files)}
          />
        </div>
      )}

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="truncate">{viewing?.name}</DialogTitle>
            <DialogDescription>
              {viewing &&
                `${ATTACHMENT_KIND_LABELS[viewing.kind]} · ${formatBytes(viewing.size_bytes)}`}
            </DialogDescription>
          </DialogHeader>
          {viewing && (
            <img
              src={fileUrl(viewing.url)}
              alt={viewing.name}
              className="max-h-[70vh] w-full rounded-lg bg-muted object-contain"
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!askWhy} onOpenChange={(o) => !o && setAskWhy(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="truncate">Remove {askWhy?.name}?</DialogTitle>
            <DialogDescription>
              {askWhy?.uploader?.name ?? "Someone else"} added this file. Say why it is being
              removed; the reason is kept in the request's history.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="pf-why">Reason</Label>
            <Textarea
              id="pf-why"
              rows={2}
              maxLength={500}
              value={why}
              onChange={(e) => setWhy(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAskWhy(null)}>
              Back
            </Button>
            <Button
              variant="destructive"
              disabled={!why.trim()}
              onClick={() => askWhy && remove(askWhy, why.trim())}
            >
              Remove file
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
