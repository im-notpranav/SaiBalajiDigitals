import { useDeferredValue, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Pencil, Plus, SearchX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableStateRow, errorText } from "@/components/layout/PageStates";
import { cn } from "@/lib/utils";
import {
  KIND_LABELS,
  fetchMasterEntries,
  masterKeys,
  updateMasterEntry,
  type MasterEntry,
  type MasterKind,
} from "@/api/masterLibrary";
import { EntryDialog } from "./EntryDialog";
import { usageText } from "./names";
import { ArchivedBadge, FilterPill, LocalityBadge, ReviewBadge, SearchBox, SkeletonRows } from "./shared";

export const entriesQuery = (kind: MasterKind) => ({
  queryKey: masterKeys.entries(kind),
  queryFn: () => fetchMasterEntries(kind),
  staleTime: 30_000,
});

const PAGE = 200;

const PLURAL: Record<MasterKind, string> = { CLIENT: "clients", MEDIA: "media names", LOCATION: "locations" };

/**
 * One list of the Master Library. The whole list is loaded once and filtered on screen, so
 * search and the Active / Archived switch answer at once.
 */
export function MasterListTab({ kind }: { kind: MasterKind }) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [show, setShow] = useState<"active" | "archived">("active");
  const [reviewOnly, setReviewOnly] = useState(false);
  const [editing, setEditing] = useState<MasterEntry | null>(null);
  const [adding, setAdding] = useState(false);
  const { data, isPending, error, refetch } = useQuery(entriesQuery(kind));
  const search = useDeferredValue(q.trim().toLowerCase());
  // Long lists draw in pages, so typing in the search box stays quick on a phone.
  const [limit, setLimit] = useState(PAGE);
  const [filterKey, setFilterKey] = useState("");
  const key = `${search}|${show}|${reviewOnly}`;
  if (key !== filterKey) {
    setFilterKey(key);
    setLimit(PAGE);
  }

  const all = useMemo(() => data?.entries ?? [], [data]);
  const counts = useMemo(
    () => ({
      active: all.filter((e) => e.is_active).length,
      archived: all.filter((e) => !e.is_active).length,
      review: all.filter((e) => e.is_active && e.needs_confirmation).length,
    }),
    [all],
  );
  const rows = useMemo(
    () =>
      all.filter(
        (e) =>
          (show === "active" ? e.is_active : !e.is_active) &&
          (!reviewOnly || e.needs_confirmation) &&
          (!search || `${e.name} ${e.code ?? ""} ${e.district ?? ""}`.toLowerCase().includes(search)),
      ),
    [all, show, reviewOnly, search],
  );

  // Archive and restore show at once; the list goes back if the server says no.
  const toggle = useMutation({
    mutationFn: (e: MasterEntry) => updateMasterEntry(kind, e.id, { is_active: !e.is_active }),
    onMutate: async (e) => {
      await qc.cancelQueries({ queryKey: masterKeys.entries(kind) });
      const before = qc.getQueryData<{ entries: MasterEntry[] }>(masterKeys.entries(kind));
      qc.setQueryData<{ entries: MasterEntry[] }>(masterKeys.entries(kind), (old) =>
        old ? { entries: old.entries.map((x) => (x.id === e.id ? { ...x, is_active: !e.is_active } : x)) } : old,
      );
      return { before };
    },
    onError: (err, _e, ctx) => {
      if (ctx?.before) qc.setQueryData(masterKeys.entries(kind), ctx.before);
      toast.error(errorText(err, "Could not change it"));
    },
    onSuccess: (_res, e) => {
      toast.success(e.is_active ? `Archived "${e.name}"` : `Restored "${e.name}"`, {
        description: e.is_active ? "It stays on old orders but leaves the pick-lists." : undefined,
        action: { label: "Undo", onClick: () => toggle.mutate({ ...e, is_active: !e.is_active }) },
      });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: masterKeys.all }),
  });

  const isLocation = kind === "LOCATION";
  const isClient = kind === "CLIENT";
  const cols = isClient ? 4 : isLocation ? 5 : 3;

  return (
    <>
      {isLocation && counts.review > 0 && !reviewOnly && (
        <div className="mb-3 flex flex-col gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span>
            {counts.review} location{counts.review === 1 ? "" : "s"} came from old orders and need{counts.review === 1 ? "s" : ""} Hyderabad or Non-local checked.
          </span>
          <Button size="sm" variant="outline" className="rounded-xl" onClick={() => { setShow("active"); setReviewOnly(true); }}>
            Show them
          </Button>
        </div>
      )}

      <div className="surface-panel mb-3 flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
        <SearchBox value={q} onChange={setQ} placeholder={`Search ${PLURAL[kind]}`} />
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterPill active={show === "active"} onClick={() => setShow("active")} count={data ? counts.active : undefined}>Active</FilterPill>
          <FilterPill active={show === "archived"} onClick={() => { setShow("archived"); setReviewOnly(false); }} count={data ? counts.archived : undefined}>
            Archived
          </FilterPill>
          {isLocation && (
            <FilterPill tone="warning" active={reviewOnly} onClick={() => { setReviewOnly((v) => !v); setShow("active"); }} count={data ? counts.review : undefined}>
              Needs review
            </FilterPill>
          )}
        </div>
        <Button className="rounded-xl sm:ml-auto" onClick={() => setAdding(true)} disabled={isPending}>
          <Plus className="mr-1.5 h-4 w-4" /> Add {KIND_LABELS[kind].toLowerCase()}
        </Button>
      </div>

      <div className="surface-panel overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead>Name</TableHead>
              {isClient && <TableHead className="hidden sm:table-cell">Code</TableHead>}
              {isLocation && <TableHead className="hidden sm:table-cell">Hyderabad / Non-local</TableHead>}
              {isLocation && <TableHead className="hidden md:table-cell">District</TableHead>}
              <TableHead className="hidden sm:table-cell">Used on</TableHead>
              <TableHead className="w-px text-right"><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending ? (
              <SkeletonRows cols={cols} />
            ) : error ? (
              <TableStateRow colSpan={cols} error={error} onRetry={() => refetch()} />
            ) : rows.length === 0 ? (
              <TableStateRow
                colSpan={cols}
                empty={
                  search
                    ? { icon: SearchX, title: "Nothing matches", description: `No ${show} ${PLURAL[kind]} match "${q.trim()}".` }
                    : { title: show === "archived" ? "Nothing archived" : reviewOnly ? "All reviewed" : `No ${PLURAL[kind]} yet`, description: show === "active" && !reviewOnly ? "Add one, or import a sheet." : undefined }
                }
              />
            ) : (
              rows.slice(0, limit).map((e) => (
                <TableRow key={e.id} className={cn(!e.is_active && "text-muted-foreground")}>
                  <TableCell className="py-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-foreground">{e.name}</span>
                      {isLocation && e.needs_confirmation && e.is_active && <ReviewBadge />}
                      {!e.is_active && <ArchivedBadge />}
                    </div>
                    {/* On a phone the other columns fold under the name. */}
                    <div className="mt-0.5 text-xs text-muted-foreground sm:hidden">
                      {[isClient ? e.code : null, isLocation && !e.needs_confirmation && e.locality ? (e.locality === "LOCAL" ? "Hyderabad" : "Non-local") : null, usageText(kind, e)]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </TableCell>
                  {isClient && (
                    <TableCell className="hidden font-mono text-xs sm:table-cell">{e.code || <span className="text-muted-foreground">—</span>}</TableCell>
                  )}
                  {isLocation && (
                    <TableCell className="hidden sm:table-cell"><LocalityBadge locality={e.locality} review={e.needs_confirmation} /></TableCell>
                  )}
                  {isLocation && <TableCell className="hidden md:table-cell">{e.district || <span className="text-muted-foreground">—</span>}</TableCell>}
                  <TableCell className={cn("hidden whitespace-nowrap tabular-nums sm:table-cell", !e.usage && "text-muted-foreground")}>{usageText(kind, e)}</TableCell>
                  <TableCell className="whitespace-nowrap py-1.5 text-right">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(e)} aria-label={`Edit ${e.name}`}>
                      <Pencil className="h-4 w-4 sm:mr-1.5" /> <span className="hidden sm:inline">Edit</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggle.mutate(e)}
                      aria-label={e.is_active ? `Archive ${e.name}` : `Restore ${e.name}`}
                    >
                      {e.is_active ? <Archive className="h-4 w-4 sm:mr-1.5" /> : <ArchiveRestore className="h-4 w-4 sm:mr-1.5" />}
                      <span className="hidden sm:inline">{e.is_active ? "Archive" : "Restore"}</span>
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {data && rows.length > 0 && (
        <div className="mt-2 flex items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
          <span>
            Showing {Math.min(limit, rows.length).toLocaleString("en-IN")} of {rows.length.toLocaleString("en-IN")}
          </span>
          {rows.length > limit && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setLimit((n) => n + PAGE * 5)}>
              Show more
            </Button>
          )}
        </div>
      )}

      <EntryDialog
        kind={kind}
        open={adding || !!editing}
        entry={editing}
        entries={all}
        onClose={() => { setAdding(false); setEditing(null); }}
      />
    </>
  );
}
