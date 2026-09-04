import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Mail, Loader2, Send, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { emailExport, getRecentRecipients, type EmailExportPayload } from "@/api/orders";
import { useDebounce } from "@/hooks/use-debounce";
import { cn } from "@/lib/utils";

interface EmailExportDialogProps {
  /** Current filter context to include in the export */
  section?: string;
  status?: string;
  q?: string;
  /** Button variant */
  variant?: "default" | "outline" | "secondary" | "ghost";
}

export function EmailExportDialog({
  section,
  status,
  q,
  variant = "outline",
}: EmailExportDialogProps) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debouncedTo = useDebounce(to, 250);

  const { data: suggestions = [] } = useQuery({
    queryKey: ["email-recipients", debouncedTo],
    queryFn: () => getRecentRecipients(debouncedTo),
    enabled: open && debouncedTo.length >= 2,
  });

  const mutation = useMutation({
    mutationFn: (payload: EmailExportPayload) => emailExport(payload),
    onSuccess: (data) => {
      toast.success("Export sent!", {
        description: `Emailed ${data.orders_count} orders (${data.items_count} items) to ${to}`,
      });
      setOpen(false);
      resetForm();
    },
    onError: (err: any) => {
      toast.error("Failed to send", {
        description: err?.response?.data?.message || err.message,
      });
    },
  });

  const resetForm = () => {
    setTo("");
    setSubject("");
    setMessage("");
  };

  // Reset form when dialog opens
  useEffect(() => {
    if (open) resetForm();
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!to.includes("@")) {
      toast.error("Enter a valid email address.");
      return;
    }
    mutation.mutate({
      to,
      subject: subject || undefined,
      message: message || undefined,
      section,
      status,
      q,
    });
  };

  const selectSuggestion = (email: string) => {
    setTo(email);
    setShowSuggestions(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} className="rounded-xl shadow-soft">
          <Mail className="mr-2 h-4 w-4" /> Email Export
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            Email Orders Export
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email-to">Recipient Email *</Label>
            <div className="relative">
              <Input
                id="email-to"
                type="email"
                placeholder="recipient@example.com"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  setShowSuggestions(true);
                }}
                onFocus={() => setShowSuggestions(true)}
                required
                autoComplete="off"
              />
              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-40 overflow-y-auto rounded-lg border bg-popover shadow-lg">
                  {suggestions.map((email) => (
                    <button
                      key={email}
                      type="button"
                      onClick={() => selectSuggestion(email)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors"
                    >
                      <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                      {email}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Start typing to see recently-used addresses
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email-subject">Subject</Label>
            <Input
              id="email-subject"
              placeholder={`Orders Export — ${new Date().toLocaleDateString("en-IN")}`}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email-message">Message (optional)</Label>
            <Textarea
              id="email-message"
              placeholder="Add a note to include in the email body..."
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="resize-none"
            />
          </div>

          {/* Filter context badge */}
          <div className="flex flex-wrap gap-1.5">
            {section && (
              <Badge variant="secondary" className="text-xs">
                {section === "active" ? "Active orders" : section === "completed" ? "Completed orders" : section}
              </Badge>
            )}
            {q && (
              <Badge variant="outline" className="text-xs">
                Search: {q}
              </Badge>
            )}
            {!section && !q && (
              <Badge variant="secondary" className="text-xs">
                All orders
              </Badge>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={mutation.isPending || !to.includes("@")}
            >
              {mutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Send Export
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
