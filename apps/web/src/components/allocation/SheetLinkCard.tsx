import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth-store";
import { apiErrorMessage } from "@/api/allocation";
import { isGoogleSheetUrl, updateAllocationSheet } from "@/api/allocationSheet";
import { allocationSheetQuery } from "./SheetView";

/** Settings: which Google Sheet Work Allocation's Sheet View shows. Only the Admin can change it. */
export function SheetLinkCard() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canEdit = user?.role === "ADMIN";
  const [url, setUrl] = useState("");
  const { data, isLoading } = useQuery(allocationSheetQuery);
  const saved = data?.url;

  useEffect(() => {
    if (saved != null) setUrl(saved);
  }, [saved]);

  const value = url.trim();
  const valid = isGoogleSheetUrl(value);

  const save = useMutation({
    mutationFn: () => updateAllocationSheet(value),
    onSuccess: (next) => {
      queryClient.setQueryData(allocationSheetQuery.queryKey, next);
      toast.success("Sheet View now shows this sheet");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not save the link")),
  });

  return (
    <div className="surface-panel p-6">
      <h3 className="mb-1 text-sm font-semibold">Google Sheet (Sheet View)</h3>
      <p className="mb-4 text-xs text-muted-foreground">
        The team's sheet that Work Allocation shows as Sheet View, for everyone in the app, field
        staff included. Who can see or edit it is still set in Google Sheets, under Share.
      </p>
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && value !== saved) save.mutate();
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="allocation_sheet_url">Sheet link</Label>
          {isLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <Input
              id="allocation_sheet_url"
              type="url"
              inputMode="url"
              spellCheck={false}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={!canEdit}
              placeholder="https://docs.google.com/spreadsheets/d/…"
              className="font-mono text-xs"
              aria-invalid={value !== "" && !valid}
            />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
            <Button
              type="submit"
              className="rounded-xl"
              disabled={!valid || value === saved || save.isPending}
            >
              Save
            </Button>
          )}
          {saved && (
            <Button asChild variant="ghost" className="rounded-xl">
              <a href={saved} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" aria-hidden /> Open sheet
              </a>
            </Button>
          )}
        </div>
      </form>
      {value !== "" && !valid && (
        <div className="mt-2 text-xs text-destructive">
          Use a Google Sheets link. It starts with https://docs.google.com/spreadsheets/d/
        </div>
      )}
      {!canEdit && (
        <div className="mt-2 text-xs text-muted-foreground">Only the Admin can change this.</div>
      )}
    </div>
  );
}
