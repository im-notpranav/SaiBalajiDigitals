import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, GitMerge, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, errorText } from "@/components/layout/PageStates";
import { cn } from "@/lib/utils";
import {
  KIND_LABELS,
  LOCALITY_LABELS,
  fetchDuplicates,
  markNotSame,
  masterKeys,
  mergeMasterEntries,
  type DuplicateGroup,
  type MasterEntry,
  type MasterKind,
} from "@/api/masterLibrary";
import { RECORD_WORD, usageText } from "./names";
import { ArchivedBadge, FilterPill, ReviewBadge } from "./shared";

/** The spelling to suggest keeping: the most used, then an active one, then the first by name. */
const suggestedKeep = (members: MasterEntry[]) =>
  [...members].sort((a, b) => b.usage - a.usage || Number(b.is_active) - Number(a.is_active))[0]!;

const memberDetail = (kind: MasterKind, m: MasterEntry) =>
  [
    kind === "CLIENT" && m.code ? m.code : null,
    kind === "LOCATION" && m.locality && !m.needs_confirmation ? LOCALITY_LABELS[m.locality] : null,
    usageText(kind, m),
  ]
    .filter(Boolean)
    .join(" · ");

/** Near-identical names ("Big C", "BigC", "BIG-C"), to merge into one spelling. */
export function DuplicatesTab() {
  const qc = useQueryClient();
  const [kind, setKind] = useState<MasterKind | "ALL">("ALL");
  const [merging, setMerging] = useState<DuplicateGroup | null>(null);
  const { data, isPending, error, refetch, isFetching } = useQuery({
    queryKey: masterKeys.duplicates,
    queryFn: fetchDuplicates,
    staleTime: 30_000,
  });

  const groups = useMemo(() => data?.groups ?? [], [data]);
  const count = (k: MasterKind) => groups.filter((g) => g.kind === k).length;
  const shown = kind === "ALL" ? groups : groups.filter((g) => g.kind === kind);

  const dropGroup = (signature: string) =>
    qc.setQueryData<{ groups: DuplicateGroup[] }>(masterKeys.duplicates, (old) =>
      old ? { groups: old.groups.filter((g) => g.signature !== signature) } : old,
    );

  // "Not the same" hides the group at once; it comes back if the server says no.
  const notSame = useMutation({
    mutationFn: (g: DuplicateGroup) => markNotSame({ kind: g.kind, ids: g.members.map((m) => m.id) }),
    onMutate: (g) => {
      const before = qc.getQueryData(masterKeys.duplicates);
      dropGroup(g.signature);
      return { before };
    },
    onError: (err, _g, ctx) => {
      if (ctx?.before) qc.setQueryData(masterKeys.duplicates, ctx.before);
      toast.error(errorText(err, "Could not save that"));
    },
    onSuccess: () => toast.success("Marked as different names"),
  });

  if (isPending) {
    return (
      <div className="grid gap-3" aria-label="Looking for duplicates" role="status">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
      </div>
    );
  }
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;

  return (
    <>
      <div className="surface-panel mb-3 flex flex-wrap items-center gap-1.5 p-3">
        <FilterPill active={kind === "ALL"} onClick={() => setKind("ALL")} count={groups.length}>All</FilterPill>
        {(["CLIENT", "MEDIA", "LOCATION"] as const).map((k) => (
          <FilterPill key={k} active={kind === k} onClick={() => setKind(k)} count={count(k)}>
            {k === "CLIENT" ? "Clients" : k === "MEDIA" ? "Media" : "Locations"}
          </FilterPill>
        ))}
        <span className={cn("ml-auto text-xs text-muted-foreground transition-opacity", isFetching ? "opacity-100" : "opacity-0")}>
          Checking…
        </span>
      </div>

      {shown.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="No duplicates found"
          description="Names that look alike (same letters, a space, a dash or one typing slip apart) show up here."
        />
      ) : (
        <div className="grid gap-3">
          {shown.map((g) => (
            <div key={`${g.kind}:${g.signature}`} className="surface-panel p-3 sm:p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <Badge variant="outline">{KIND_LABELS[g.kind]}</Badge>
                <span className="text-xs text-muted-foreground">{g.members.length} spellings</span>
              </div>
              <ul className="grid gap-1.5">
                {g.members.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                    <span className="font-medium">{m.name}</span>
                    {m.needs_confirmation && m.is_active && <ReviewBadge />}
                    {!m.is_active && <ArchivedBadge />}
                    <span className="text-xs text-muted-foreground">{memberDetail(g.kind, m)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => notSame.mutate(g)}>Not the same</Button>
                <Button size="sm" className="rounded-xl" onClick={() => setMerging(g)}>
                  <GitMerge className="mr-1.5 h-4 w-4" /> Merge into…
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <MergeDialog group={merging} onClose={() => setMerging(null)} onMerged={(g) => dropGroup(g.signature)} />
    </>
  );
}

function MergeDialog({
  group,
  onClose,
  onMerged,
}: {
  group: DuplicateGroup | null;
  onClose: () => void;
  onMerged: (g: DuplicateGroup) => void;
}) {
  const qc = useQueryClient();
  const [keepId, setKeepId] = useState<number | null>(null);
  const [openedFor, setOpenedFor] = useState<DuplicateGroup | null>(null);
  if (group && openedFor !== group) {
    setOpenedFor(group);
    setKeepId(suggestedKeep(group.members).id);
  } else if (!group && openedFor) {
    setOpenedFor(null);
  }

  const shownGroup = group ?? openedFor;
  const keep = shownGroup?.members.find((m) => m.id === keepId);
  const others = shownGroup?.members.filter((m) => m.id !== keepId) ?? [];
  const moving = others.reduce((s, m) => s + m.usage, 0);

  const merge = useMutation({
    mutationFn: () => mergeMasterEntries({ kind: shownGroup!.kind, keep_id: keepId!, merge_ids: others.map((m) => m.id) }),
    onSuccess: (res) => {
      const g = shownGroup!;
      toast.success(`Merged into "${res.kept.name}"`, {
        description: `${others.length} spelling${others.length === 1 ? "" : "s"} folded in.`,
      });
      onMerged(g);
      qc.invalidateQueries({ queryKey: masterKeys.entries(g.kind) });
      qc.invalidateQueries({ queryKey: masterKeys.duplicates });
      onClose();
    },
    onError: (err) => toast.error(errorText(err, "Could not merge")),
  });

  return (
    <Dialog open={!!group} onOpenChange={(o) => !o && !merge.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Merge into one spelling</DialogTitle>
          <DialogDescription>Pick the spelling to keep. The others are removed and every record moves to the kept one.</DialogDescription>
        </DialogHeader>
        {shownGroup && (
          <div role="radiogroup" aria-label="Spelling to keep" className="grid gap-2">
            {shownGroup.members.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={keepId === m.id}
                onClick={() => setKeepId(m.id)}
                className={cn(
                  "flex items-center gap-3 rounded-xl border p-3 text-left transition-colors",
                  keepId === m.id ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                )}
              >
                <span
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                    keepId === m.id ? "border-primary" : "border-muted-foreground/40",
                  )}
                >
                  {keepId === m.id && <span className="h-2 w-2 rounded-full bg-primary" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{m.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {memberDetail(shownGroup.kind, m)}
                    {!m.is_active && " · Archived"}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
        {shownGroup && keep && (
          <p className="rounded-xl bg-muted/60 p-3 text-sm">
            {moving > 0
              ? `${moving.toLocaleString("en-IN")} ${RECORD_WORD[shownGroup.kind]} move to "${keep.name}". `
              : `No records to move. `}
            {others.map((m) => `"${m.name}"`).join(", ")} will be removed. This cannot be undone.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={merge.isPending}>Cancel</Button>
          <Button onClick={() => merge.mutate()} disabled={!keep || merge.isPending}>
            {merge.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <span className="max-w-[16rem] truncate">{keep ? `Merge into "${keep.name}"` : "Merge"}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
