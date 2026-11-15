import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileDown, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { errorText } from "@/components/layout/PageStates";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth-store";
import { downloadMasterExport, downloadMasterTemplate } from "@/api/masterLibrary";
import { MasterListTab, entriesQuery } from "@/components/master-library/MasterListTab";
import { RequestsTab, requestsQuery } from "@/components/master-library/RequestsTab";
import { DuplicatesTab } from "@/components/master-library/DuplicatesTab";
import { ImportDialog } from "@/components/master-library/ImportDialog";
import { CountBubble } from "@/components/master-library/shared";

const TABS = ["clients", "media", "locations", "requests", "duplicates"] as const;
type Tab = (typeof TABS)[number];

export const Route = createFileRoute("/_portal/admin/master-library")({
  head: () => ({ meta: [{ title: "Master Library — SB OMS" }] }),
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } => ({
    tab: TABS.includes(search.tab as Tab) ? (search.tab as Tab) : undefined,
  }),
  component: MasterLibraryPage,
});

const CRUMBS = [{ label: "Admin" }, { label: "Master Library" }];

/**
 * The admin's official names: clients (with codes), media and locations. Order forms pick from
 * these, so spellings stay the same everywhere. Admin only.
 */
function MasterLibraryPage() {
  const { user } = useAuth();
  if (user?.role !== "ADMIN") {
    return <PageHeader title="Master Library" description="Managed by the Admin." crumbs={CRUMBS} />;
  }
  return <Library />;
}

function Library() {
  const qc = useQueryClient();
  const navigate = Route.useNavigate();
  const tab: Tab = Route.useSearch().tab ?? "clients";
  const [importing, setImporting] = useState(false);

  // Every tab's list starts loading with the page, so switching tabs is instant.
  useEffect(() => {
    for (const kind of ["CLIENT", "MEDIA", "LOCATION"] as const) void qc.prefetchQuery(entriesQuery(kind));
    // On leaving, mark the other screens' copies of these lists stale: the job form's areas
    // (["masters"]) and the order forms' pickers (["master-pick"]) cache for minutes, and a
    // name just added, renamed or archived here should show there straight away.
    return () => {
      void qc.invalidateQueries({ queryKey: ["masters"] });
      void qc.invalidateQueries({ queryKey: ["master-pick"] });
    };
  }, [qc]);
  const { data: requests } = useQuery(requestsQuery);
  const { data: locations } = useQuery(entriesQuery("LOCATION"));
  const review = (locations?.entries ?? []).filter((e) => e.is_active && e.needs_confirmation).length;

  const download = useMutation({
    mutationFn: (which: "template" | "export") => (which === "template" ? downloadMasterTemplate() : downloadMasterExport()),
    onError: (err) => toast.error(errorText(err, "Could not download the file")),
  });
  const busy = (which: "template" | "export") => download.isPending && download.variables === which;

  return (
    <>
      <PageHeader
        title="Master Library"
        description="The official names for clients, media and locations. Order forms pick from these lists."
        crumbs={CRUMBS}
        actions={
          <>
            <Button variant="outline" className="rounded-xl" onClick={() => download.mutate("template")} disabled={busy("template")}>
              {busy("template") ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FileDown className="mr-1.5 h-4 w-4" />}
              Template
            </Button>
            <Button variant="outline" className="rounded-xl" onClick={() => download.mutate("export")} disabled={busy("export")}>
              {busy("export") ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
              Export all
            </Button>
            <Button className="rounded-xl" onClick={() => setImporting(true)}>
              <Upload className="mr-1.5 h-4 w-4" /> Import
            </Button>
          </>
        }
      />

      <Tabs value={tab} onValueChange={(v) => navigate({ search: { tab: v === "clients" ? undefined : (v as Tab) }, replace: true })}>
        <TabsList className="mb-3">
          <TabsTrigger value="clients">Clients</TabsTrigger>
          <TabsTrigger value="media">Media</TabsTrigger>
          <TabsTrigger value="locations">
            Locations
            <CountBubble n={review} tone="warning" />
          </TabsTrigger>
          <TabsTrigger value="requests">
            Requests
            <CountBubble n={requests?.pending ?? 0} />
          </TabsTrigger>
          <TabsTrigger value="duplicates">Duplicates</TabsTrigger>
        </TabsList>
        <TabsContent value="clients"><MasterListTab kind="CLIENT" /></TabsContent>
        <TabsContent value="media"><MasterListTab kind="MEDIA" /></TabsContent>
        <TabsContent value="locations"><MasterListTab kind="LOCATION" /></TabsContent>
        <TabsContent value="requests"><RequestsTab /></TabsContent>
        <TabsContent value="duplicates"><DuplicatesTab /></TabsContent>
      </Tabs>

      <ImportDialog open={importing} onClose={() => setImporting(false)} />
    </>
  );
}
