import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Inbox, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ErrorState, errorText } from "@/components/layout/PageStates";
import { formatWhen } from "@/api/payments";
import {
  KIND_LABELS,
  approveNameRequest,
  fetchNameRequests,
  masterKeys,
  rejectNameRequest,
  type Locality,
  type MasterKind,
  type NameRequest,
  type RequestStatus,
} from "@/api/masterLibrary";
import { entriesQuery } from "./MasterListTab";
import { clashOf, cleanName, lowerKey } from "./names";
import { DetailFields, EMPTY_DETAILS, detailsBody, detailsOf, emailBad, type Details } from "./DetailFields";
import { FilterPill } from "./shared";

export const requestsQuery = {
  queryKey: masterKeys.requests,
  queryFn: () => fetchNameRequests(),
  staleTime: 15_000,
};

const STATUS_LABELS: Record<RequestStatus, string> = { PENDING: "Waiting", APPROVED: "Added", REJECTED: "Not added" };

/** Names CSMs and managers asked for. Add (the spelling can be corrected first) or say why not. */
export function RequestsTab() {
  const [status, setStatus] = useState<RequestStatus | "ALL">("PENDING");
  const [approving, setApproving] = useState<NameRequest | null>(null);
  const [rejecting, setRejecting] = useState<NameRequest | null>(null);
  const { data, isPending, error, refetch } = useQuery(requestsQuery);

  const all = useMemo(() => data?.requests ?? [], [data]);
  const count = (s: RequestStatus) => all.filter((r) => r.status === s).length;
  // Waiting ones oldest first, so nobody waits longest; decided ones newest first.
  const shown = useMemo(() => {
    const list = status === "ALL" ? all : all.filter((r) => r.status === status);
    return status === "PENDING" ? [...list].reverse() : list;
  }, [all, status]);

  if (isPending) {
    return (
      <div className="grid gap-2" aria-label="Loading requests" role="status">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
      </div>
    );
  }
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;

  return (
    <>
      <div className="surface-panel mb-3 flex flex-wrap items-center gap-1.5 p-3">
        {(["PENDING", "APPROVED", "REJECTED"] as const).map((s) => (
          <FilterPill key={s} active={status === s} onClick={() => setStatus(s)} count={count(s)}>
            {STATUS_LABELS[s]}
          </FilterPill>
        ))}
        <FilterPill active={status === "ALL"} onClick={() => setStatus("ALL")} count={all.length}>All</FilterPill>
      </div>

      {shown.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={status === "PENDING" ? "No requests waiting" : "Nothing here"}
          description={status === "PENDING" ? "When a CSM cannot find a name in a list, their request shows up here." : undefined}
        />
      ) : (
        <div className="grid gap-2">
          {shown.map((r) => (
            <div key={r.id} className="surface-panel flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:p-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{KIND_LABELS[r.kind]}</Badge>
                  <span className="font-semibold">{r.name}</span>
                  {r.status === "APPROVED" && (
                    <Badge className="bg-success/15 text-success hover:bg-success/20">
                      {r.final_name && r.final_name !== r.name ? `Added as "${r.final_name}"` : "Added"}
                    </Badge>
                  )}
                  {r.status === "REJECTED" && <Badge variant="secondary">Not added</Badge>}
                </div>
                {r.note && <p className="mt-1 text-sm text-muted-foreground">"{r.note}"</p>}
                {detailLine(r.details) && <p className="mt-1 text-xs text-muted-foreground">{detailLine(r.details)}</p>}
                {r.status === "REJECTED" && r.reject_reason && <p className="mt-1 text-sm">Reason: {r.reject_reason}</p>}
                <p className="mt-1 text-xs text-muted-foreground">
                  {r.requester?.name ?? "Someone"} · {formatWhen(r.created_at)}
                  {r.decided_at && ` · ${STATUS_LABELS[r.status].toLowerCase()} by ${r.decider?.name ?? "the admin"} ${formatWhen(r.decided_at)}`}
                </p>
              </div>
              {r.status === "PENDING" && (
                <div className="flex shrink-0 gap-2">
                  <Button variant="outline" size="sm" className="flex-1 rounded-xl sm:flex-none" onClick={() => setRejecting(r)}>
                    <X className="mr-1.5 h-4 w-4" /> Reject
                  </Button>
                  <Button size="sm" className="flex-1 rounded-xl sm:flex-none" onClick={() => setApproving(r)}>
                    <Check className="mr-1.5 h-4 w-4" /> Add
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <ApproveDialog request={approving} onClose={() => setApproving(null)} />
      <RejectDialog request={rejecting} onClose={() => setRejecting(null)} />
    </>
  );
}

/** Puts a decided request in the cached list, so the row moves at once. */
function useReplaceRequest() {
  const qc = useQueryClient();
  return (r: NameRequest) =>
    qc.setQueryData<{ requests: NameRequest[]; pending: number }>(masterKeys.requests, (old) =>
      old
        ? {
            requests: old.requests.map((x) => (x.id === r.id ? r : x)),
            pending: old.requests.filter((x) => x.id !== r.id && x.status === "PENDING").length,
          }
        : old,
    );
}

const DETAIL_LABELS: Record<string, string> = {
  short_name: "Short name",
  contact_person: "Contact",
  contact_number: "Number",
  email: "Email",
  csm_name: "CSM",
  district: "District",
  state: "State",
  locality: "Area",
};

/** What the asker filled in beside the name, in one line. */
function detailLine(d: Record<string, unknown> | null | undefined) {
  if (!d) return "";
  return Object.entries(d)
    .filter(([k, v]) => DETAIL_LABELS[k] && v != null && v !== "")
    .map(([k, v]) => `${DETAIL_LABELS[k]}: ${k === "locality" ? (v === "LOCAL" ? "Hyderabad" : "Non-local") : String(v)}`)
    .join(" · ");
}

function ApproveDialog({ request, onClose }: { request: NameRequest | null; onClose: () => void }) {
  const qc = useQueryClient();
  const replace = useReplaceRequest();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [locality, setLocality] = useState<Locality | "LATER">("LATER");
  const [district, setDistrict] = useState("");
  const [details, setDetails] = useState<Details>(EMPTY_DETAILS);
  const [openedFor, setOpenedFor] = useState<NameRequest | null>(null);
  if (request && openedFor !== request) {
    setOpenedFor(request);
    setName(request.name);
    setCode("");
    const asked = request.details ?? {};
    setLocality(asked.locality === "LOCAL" || asked.locality === "NON_LOCAL" ? asked.locality : "LATER");
    setDistrict(typeof asked.district === "string" ? asked.district : "");
    setDetails(detailsOf(asked));
  } else if (!request && openedFor) {
    setOpenedFor(null);
  }

  const shown = request ?? openedFor;
  const kind: MasterKind = shown?.kind ?? "CLIENT";
  // The list is usually cached already; it tells the admin when the name is in it.
  const { data: list } = useQuery({ ...entriesQuery(kind), enabled: !!request });
  const clean = cleanName(name);
  const existing = clean ? clashOf(list?.entries ?? [], clean) : undefined;

  const approve = useMutation({
    mutationFn: () =>
      approveNameRequest(shown!.id, {
        name: clean,
        ...detailsBody(kind, details),
        ...(kind === "CLIENT" ? { code: code.trim() || null } : {}),
        ...(kind === "LOCATION"
          ? { locality: locality === "LATER" ? undefined : locality, district: district.trim() || null }
          : {}),
      }),
    onSuccess: (res) => {
      replace(res.request);
      qc.invalidateQueries({ queryKey: masterKeys.entries(res.request.kind) });
      toast.success(res.existed ? `"${res.entry.name}" was already in the list` : `"${res.entry.name}" added`, {
        description: "The person who asked has been told.",
      });
      onClose();
    },
    onError: (err) => toast.error(errorText(err, "Could not add it")),
  });

  const codeBad = !/^[A-Za-z0-9_-]{0,30}$/.test(code.trim());

  return (
    <Dialog open={!!request} onOpenChange={(o) => !o && !approve.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add {KIND_LABELS[kind].toLowerCase()}</DialogTitle>
          <DialogDescription>
            {shown?.requester?.name ?? "Someone"} asked for "{shown?.name}". Correct the spelling if needed.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (clean && !codeBad) approve.mutate();
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="rq-name">Name to add</Label>
            <Input id="rq-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={kind === "LOCATION" ? 100 : 200} />
            {existing && (
              <p className="flex items-start gap-1.5 text-xs text-warning">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {lowerKey(existing.name) === lowerKey(clean) ? `"${existing.name}" is` : `"${existing.name}" looks the same and is`} already in the list
                {existing.is_active ? ". Adding marks the request done, nothing new is added." : " but archived. Adding brings it back."}
              </p>
            )}
          </div>
          {kind === "CLIENT" && !existing && (
            <div className="grid gap-2">
              <Label htmlFor="rq-code">Code <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Input id="rq-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={30} className="font-mono uppercase" placeholder="Blank gives the next SBD code" />
              {codeBad && <p className="text-xs text-destructive">Letters, numbers, - and _ only.</p>}
            </div>
          )}
          {kind === "LOCATION" && !existing && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Hyderabad / Non-local</Label>
                <Select value={locality} onValueChange={(v) => setLocality(v as Locality | "LATER")}>
                  <SelectTrigger aria-label="Hyderabad or Non-local"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LOCAL">Hyderabad</SelectItem>
                    <SelectItem value="NON_LOCAL">Non-local</SelectItem>
                    <SelectItem value="LATER">Not sure yet (review later)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="rq-district">District <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Input id="rq-district" value={district} onChange={(e) => setDistrict(e.target.value)} maxLength={100} />
              </div>
            </div>
          )}
          {!existing && <DetailFields kind={kind} value={details} onChange={setDetails} idPrefix="rq" />}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={approve.isPending}>Cancel</Button>
            <Button type="submit" disabled={!clean || codeBad || emailBad(details) || approve.isPending}>
              {approve.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RejectDialog({ request, onClose }: { request: NameRequest | null; onClose: () => void }) {
  const replace = useReplaceRequest();
  const [reason, setReason] = useState("");
  const [openedFor, setOpenedFor] = useState<NameRequest | null>(null);
  if (request && openedFor !== request) {
    setOpenedFor(request);
    setReason("");
  } else if (!request && openedFor) {
    setOpenedFor(null);
  }
  const shown = request ?? openedFor;

  const reject = useMutation({
    mutationFn: () => rejectNameRequest(shown!.id, reason.trim()),
    onSuccess: (res) => {
      replace(res.request);
      toast.success("Request rejected", { description: "The person who asked has been told why." });
      onClose();
    },
    onError: (err) => toast.error(errorText(err, "Could not reject it")),
  });

  return (
    <Dialog open={!!request} onOpenChange={(o) => !o && !reject.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject "{shown?.name}"</DialogTitle>
          <DialogDescription>Say why, so {shown?.requester?.name ?? "the person"} knows what to use instead.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim()) reject.mutate();
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="rq-reason">Reason</Label>
            <Textarea
              id="rq-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder='e.g. Use "Big C" — it is the same client.'
              maxLength={300}
              rows={3}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={reject.isPending}>Cancel</Button>
            <Button type="submit" variant="destructive" disabled={!reason.trim() || reject.isPending}>
              {reject.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Reject
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
