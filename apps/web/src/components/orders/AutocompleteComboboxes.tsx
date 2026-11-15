import { useEffect, useRef, useState } from "react";
import { keepPreviousData, useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, ExternalLink, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-store";
import { useDebounce } from "@/hooks/use-debounce";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiErrorMessage } from "@/api/allocation";
import {
  MASTER_KIND_LABELS,
  REQUEST_SENT,
  requestMasterName,
  searchNames,
  type MasterKind,
  type PickOption,
} from "@/api/nameRequests";

/**
 * Pick-lists for client, media and store location. Only the admin adds these names (Master
 * Library), so a CSM can pick a name but never type a new one; a missing name is asked for
 * from the end of the list. The list is searched on the server and runs A to Z.
 */

interface PickProps {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  id?: string;
  disabled?: boolean;
}

const pickKey = (kind: MasterKind, search: string) => ["master-pick", kind, search.trim().toLowerCase()] as const;

function MasterCombobox({ kind, value, onChange, className, id, disabled, placeholder }: PickProps & { kind: MasterKind; placeholder: string }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [asking, setAsking] = useState<string | null>(null);
  /** Set as the request dialog opens, so the closing list does not pull the focus back. */
  const askingRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounced = useDebounce(search, 250);

  const { data: options = [], isFetching } = useQuery({
    queryKey: pickKey(kind, debounced),
    queryFn: () => searchNames[kind](debounced),
    // Fetched when the list opens, not for every line of a long order at once.
    enabled: open,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  // The last results narrowed by what is typed now, so the list follows each key press
  // while the server catches up.
  const needle = search.trim().toLowerCase();
  const shown = needle ? options.filter((o) => o.name.toLowerCase().includes(needle)) : options;
  const waiting = isFetching && shown.length === 0;

  /** Warms the list on focus or touch, so it is there when it opens. */
  const prefetch = () =>
    void qc.prefetchQuery({ queryKey: pickKey(kind, ""), queryFn: () => searchNames[kind](""), staleTime: 60_000 });

  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) setSearch("");
  };

  const pick = (name: string) => {
    onChange(name);
    changeOpen(false);
  };

  const askForIt = () => {
    if (isAdmin) {
      // A new tab, so an order half filled in is not lost.
      window.open("/admin/master-library", "_blank", "noopener");
      changeOpen(false);
      return;
    }
    askingRef.current = true;
    setAsking(search.trim());
    changeOpen(false);
  };

  return (
    <>
      <Popover open={open} onOpenChange={changeOpen}>
        <PopoverTrigger asChild>
          <Button
            ref={triggerRef}
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-haspopup="listbox"
            disabled={disabled}
            onFocus={prefetch}
            onPointerDown={prefetch}
            onKeyDown={(e) => {
              // Typing on the closed box opens it with that letter, so the keyboard never stops.
              if (open || e.ctrlKey || e.metaKey || e.altKey) return;
              if (e.key.length === 1 && e.key !== " ") {
                e.preventDefault();
                setSearch(e.key);
                setOpen(true);
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                setOpen(true);
              }
            }}
            className={cn("w-full justify-between px-3 font-normal", className)}
          >
            <span className={cn("block flex-1 truncate text-left", !value && "text-muted-foreground")}>{value || placeholder}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[var(--radix-popover-trigger-width)] min-w-[240px] p-0"
          align="start"
          onOpenAutoFocus={(e) => {
            // Focus the search with the caret after any letter already typed.
            e.preventDefault();
            const input = inputRef.current;
            if (input) {
              input.focus();
              input.setSelectionRange(input.value.length, input.value.length);
            }
          }}
          onCloseAutoFocus={(e) => {
            // The request dialog takes the focus instead.
            if (askingRef.current) e.preventDefault();
          }}
        >
          <Command shouldFilter={false}>
            <CommandInput ref={inputRef} placeholder={`Search ${MASTER_KIND_LABELS[kind].toLowerCase()}`} value={search} onValueChange={setSearch} />
            <CommandList>
              {/* Not cmdk's Empty: the request row below is always there, so that would never show. */}
              {waiting ? (
                <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Searching…
                </div>
              ) : shown.length === 0 ? (
                <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                  {needle ? `No ${MASTER_KIND_LABELS[kind].toLowerCase()} matches "${search.trim()}".` : "The list is empty."}
                </div>
              ) : null}
              {shown.length > 0 && (
                <CommandGroup>
                  {shown.map((o: PickOption) => (
                    <CommandItem key={o.name} value={o.name} onSelect={() => pick(o.name)}>
                      <Check className={cn("mr-2 h-4 w-4 shrink-0", value === o.name ? "opacity-100" : "opacity-0")} />
                      <span className="flex-1 truncate">{o.name}</span>
                      {o.hint && <span className="ml-2 shrink-0 text-xs text-muted-foreground">{o.hint}</span>}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              <CommandSeparator />
              <CommandGroup forceMount>
                <CommandItem value="__ask-admin__" forceMount onSelect={askForIt} className="text-primary">
                  {isAdmin ? <ExternalLink className="mr-2 h-4 w-4 shrink-0" /> : <Plus className="mr-2 h-4 w-4 shrink-0" />}
                  {isAdmin ? "Not in list? Add it in Master Library" : "Not in list? Request it"}
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <RequestNameDialog
        kind={kind}
        open={asking !== null}
        initialName={asking ?? ""}
        onOpenChange={(o) => {
          if (!o) {
            askingRef.current = false;
            setAsking(null);
            requestAnimationFrame(() => triggerRef.current?.focus());
          }
        }}
        onUseExisting={onChange}
      />
    </>
  );
}

export function ClientCombobox(props: PickProps) {
  return <MasterCombobox kind="CLIENT" placeholder="Pick the client" {...props} />;
}

export function MediaCombobox(props: PickProps) {
  return <MasterCombobox kind="MEDIA" placeholder="Pick the media" {...props} />;
}

export function LocationCombobox(props: PickProps) {
  return <MasterCombobox kind="LOCATION" placeholder="Pick the location" {...props} />;
}

/**
 * Asks the admin to add a missing name, with an optional note. If the name is already in the
 * list (the server says how it is spelt there), offers to use that one instead.
 */
export function RequestNameDialog({
  kind,
  open,
  initialName,
  onOpenChange,
  onUseExisting,
  onSent,
}: {
  kind: MasterKind;
  open: boolean;
  initialName: string;
  onOpenChange: (open: boolean) => void;
  /** Without it, an existing name is only mentioned. */
  onUseExisting?: (name: string) => void;
  onSent?: (name: string) => void;
}) {
  const [name, setName] = useState(initialName);
  const [note, setNote] = useState("");
  const [refusal, setRefusal] = useState<{ message: string; existing?: string } | null>(null);
  const label = MASTER_KIND_LABELS[kind];

  useEffect(() => {
    if (open) {
      setName(initialName);
      setNote("");
      setRefusal(null);
    }
  }, [open, initialName]);

  const send = useMutation({
    mutationFn: () => requestMasterName({ kind, name: name.trim(), note: note.trim() || undefined }),
    onSuccess: (res) => {
      if (res.status === "sent") {
        toast.success(REQUEST_SENT);
        onSent?.(name.trim());
        onOpenChange(false);
      } else {
        setRefusal({ message: res.message, existing: res.existing });
      }
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not send the request. Please try again.")),
  });

  const canSend = name.trim().length > 0 && !send.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Request a {label.toLowerCase()}</DialogTitle>
          <DialogDescription>The admin adds it to Master Library. You'll be told when it's added.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSend) send.mutate();
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor={`ask-${kind}-name`}>{label} name</Label>
            <Input
              id={`ask-${kind}-name`}
              value={name}
              maxLength={100}
              autoComplete="off"
              autoFocus
              onChange={(e) => {
                setName(e.target.value);
                setRefusal(null);
              }}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`ask-${kind}-note`}>Note for the admin</Label>
            <Textarea
              id={`ask-${kind}-note`}
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional, e.g. the full name or the area"
              className="min-h-[64px]"
            />
          </div>
          {refusal && (
            <div className="flex flex-col gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <span>{refusal.message}</span>
              {refusal.existing && onUseExisting && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => {
                    onUseExisting(refusal.existing!);
                    onOpenChange(false);
                  }}
                >
                  Use "{refusal.existing}"
                </Button>
              )}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSend}>
              {send.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send request
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
