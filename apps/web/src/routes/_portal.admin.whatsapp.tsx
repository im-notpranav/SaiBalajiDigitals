import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Copy, ExternalLink, Loader2, RotateCw, Search } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-store";
import { roleLabel } from "@/lib/constants";
import { apiErrorMessage } from "@/api/allocation";
import { formatWhen } from "@/api/payments";
import {
  WA_STATUS_LABELS,
  fetchWhatsAppLog,
  fetchWhatsAppSetup,
  retryWhatsApp,
  type WhatsAppMessage,
  type WhatsAppSetup,
  type WhatsAppStatus,
} from "@/api/whatsapp";

export const Route = createFileRoute("/_portal/admin/whatsapp")({
  head: () => ({ meta: [{ title: "WhatsApp — SB OMS" }] }),
  component: WhatsAppPage,
});

const FIELD_ROLES = ["PASTER", "HELPER", "DRIVER"];

const STATUS_STYLES: Record<WhatsAppStatus, string> = {
  LOGGED: "bg-muted text-muted-foreground",
  QUEUED: "bg-primary/10 text-primary",
  SENT: "bg-primary/10 text-primary",
  DELIVERED: "bg-success/15 text-success",
  READ: "bg-success/15 text-success",
  FAILED: "bg-destructive/10 text-destructive",
  SKIPPED: "bg-warning/15 text-warning",
};

const FILTERS: (WhatsAppStatus | "")[] = ["", "LOGGED", "QUEUED", "SENT", "DELIVERED", "READ", "FAILED", "SKIPPED"];

function WhatsAppPage() {
  const { user } = useAuth();
  const setup = useQuery({ queryKey: ["whatsapp", "setup"], queryFn: fetchWhatsAppSetup, enabled: user?.role === "ADMIN" });

  if (user?.role !== "ADMIN") {
    return (
      <PageHeader
        title="WhatsApp"
        description="WhatsApp messages are managed by the Admin."
        crumbs={[{ label: "WhatsApp" }]}
      />
    );
  }

  return (
    <>
      <PageHeader
        title="WhatsApp"
        description="Job, payment and order updates sent to staff through AskEva. Every message is recorded here."
        crumbs={[{ label: "Administrator" }, { label: "WhatsApp" }]}
      />
      {setup.data && <ModeBanner setup={setup.data} />}
      <Tabs defaultValue="log" className="mt-4">
        <TabsList>
          <TabsTrigger value="log">Delivery log</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="people">
            Phone numbers
            {setup.data && setup.data.people.missing_phone.length > 0 && (
              <span className="ml-1.5 rounded-full bg-warning/15 px-1.5 text-[11px] text-warning">
                {setup.data.people.missing_phone.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="log">
          <DeliveryLog />
        </TabsContent>
        <TabsContent value="templates">{setup.data && <Templates setup={setup.data} />}</TabsContent>
        <TabsContent value="people">{setup.data && <People setup={setup.data} />}</TabsContent>
      </Tabs>
    </>
  );
}

function ModeBanner({ setup }: { setup: WhatsAppSetup }) {
  if (setup.live) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
        <div>
          <div className="font-semibold">Live: messages are sent through AskEva ({setup.send_host}).</div>
          <div className="text-muted-foreground">
            {setup.webhook_secret_set
              ? "Delivery reports are switched on, so messages move to Delivered and Read as WhatsApp confirms them."
              : "Delivery reports are off (ASKEVA_WEBHOOK_SECRET is not set), so messages stop at Sent."}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
      <div>
        <div className="font-semibold">Log only: nothing is sent to WhatsApp yet.</div>
        <div className="text-muted-foreground">
          Every message is recorded below as "Logged" so you can check who would get what. To start sending, get the
          templates on the Templates tab approved in AskEva, then set {setup.token_set ? "" : "ASKEVA_TOKEN and "}
          WHATSAPP_MODE=live on the server.
        </div>
      </div>
    </div>
  );
}

function DeliveryLog() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<WhatsAppStatus | "">("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  // Search as you type, without a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const log = useQuery({
    queryKey: ["whatsapp", "log", status, q, page],
    queryFn: () => fetchWhatsAppLog({ status, q, page }),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });

  const retry = useMutation({
    mutationFn: (m: WhatsAppMessage) => retryWhatsApp(m.id),
    onSuccess: (res) => {
      if (res.status === "QUEUED") toast.success(res.message);
      else toast.warning(res.message);
      qc.invalidateQueries({ queryKey: ["whatsapp"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not send it again")),
  });

  const data = log.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  return (
    <div className="grid gap-3">
      <div className="surface-panel flex flex-wrap items-center gap-2 p-3">
        {FILTERS.map((s) => (
          <button
            key={s || "all"}
            type="button"
            onClick={() => {
              setStatus(s);
              setPage(1);
            }}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium",
              status === s ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
            )}
          >
            {s ? WA_STATUS_LABELS[s] : "All"}
            {s && data ? <span className="ml-1 opacity-70">{data.counts_30d[s]}</span> : null}
          </button>
        ))}
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, number or text" className="pl-9" />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Counts are for the last 30 days. The list refreshes every 15 seconds.</p>

      <div className="surface-panel overflow-hidden">
        {log.isLoading ? (
          <div className="p-8 text-center text-muted-foreground">Loading messages…</div>
        ) : !data?.messages.length ? (
          <div className="p-8 text-center text-muted-foreground">
            No messages {status || q ? "match this filter" : "yet. They appear here as jobs, payments and orders change"}.
          </div>
        ) : (
          <ul className="divide-y">
            {data.messages.map((m) => (
              <li key={m.id} className="grid gap-1.5 p-3 sm:grid-cols-[11rem_1fr_auto] sm:gap-4">
                <div className="text-sm">
                  <div className="font-medium">{m.user?.name ?? "Removed user"}</div>
                  <div className="text-xs text-muted-foreground">
                    {m.user ? roleLabel(m.user.role) : ""}
                    {m.to_phone ? ` · ${m.to_phone}` : ""}
                  </div>
                  <div className="text-xs text-muted-foreground">{formatWhen(m.created_at)}</div>
                </div>
                <div className="min-w-0 text-sm">
                  <div className="whitespace-pre-wrap break-words">{m.preview}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    <span className="font-mono">{m.template}</span>
                    {m.attempts > 1 ? ` · ${m.attempts} tries` : ""}
                    {m.delivered_at ? ` · delivered ${formatWhen(m.delivered_at)}` : ""}
                    {m.read_at ? ` · read ${formatWhen(m.read_at)}` : ""}
                  </div>
                  {m.link && (
                    <a
                      href={m.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" /> {m.link}
                    </a>
                  )}
                  {m.error && (
                    <div className={cn("mt-0.5 text-xs", m.status === "FAILED" ? "text-destructive" : "text-warning")}>{m.error}</div>
                  )}
                </div>
                <div className="flex items-start gap-2 sm:flex-col sm:items-end">
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLES[m.status])}>
                    {WA_STATUS_LABELS[m.status]}
                  </span>
                  {m.can_retry && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={retry.isPending}
                      onClick={() => retry.mutate(m)}
                      title="Looks up their number and opt-out again, then queues it"
                    >
                      {retry.isPending && retry.variables?.id === m.id ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RotateCw className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      Send again
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {data && data.total > data.page_size && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <span className="text-muted-foreground">
            Page {data.page} of {pages} · {data.total} messages
          </span>
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Newer
          </Button>
          <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Older
          </Button>
        </div>
      )}
    </div>
  );
}

function Templates({ setup }: { setup: WhatsAppSetup }) {
  const copy = (text: string, what: string) => {
    void navigator.clipboard?.writeText(text);
    toast.success(`${what} copied`);
  };
  return (
    <div className="grid gap-3">
      <div className="surface-panel p-4 text-sm text-muted-foreground">
        WhatsApp only delivers business messages that use templates Meta has approved. Create each template below in
        AskEva with exactly this name and text, category <strong className="text-foreground">Utility</strong>, language{" "}
        <strong className="text-foreground">English</strong>. Messages wait for these approvals before going live.
        <div className="mt-3 grid gap-1 rounded-lg border bg-muted/40 px-3 py-2 text-foreground">
          <div className="font-medium">Add the same button to every template</div>
          <div>
            Type <strong>Visit website</strong>, text <strong>{setup.button.text}</strong>, URL type <strong>Dynamic</strong>:
          </div>
          <div className="flex items-center gap-2">
            <code className="break-all rounded bg-background px-2 py-1 text-xs">{setup.button.url}</code>
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => copy(setup.button.url, "Button URL")} aria-label="Copy button URL">
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="text-xs text-muted-foreground">
            The app address comes from the server's APP_URL setting{setup.app_url ? "" : " (not set yet)"}. Each message
            fills {"{{1}}"} with what it is about, and the page it opens depends on who taps it.
          </div>
        </div>
      </div>
      {setup.templates.map((t) => (
        <div key={t.template} className="surface-panel grid gap-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-semibold">{t.template}</span>
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => copy(t.template, "Name")} aria-label={`Copy ${t.template}`}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            <span className="text-xs text-muted-foreground">
              {t.category} · {t.language}
            </span>
          </div>
          <div className="flex items-start gap-2">
            <p className="flex-1 rounded-lg bg-muted/60 px-3 py-2 text-sm">{t.body}</p>
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => copy(t.body, "Text")} aria-label="Copy text">
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="text-xs text-muted-foreground">
            Button sample: <span className="font-mono">{t.button_sample}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            {t.vars.map((v, i) => (
              <span key={v} className="mr-3 inline-block">
                <span className="font-mono">{`{{${i + 1}}}`}</span> {v}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function People({ setup }: { setup: WhatsAppSetup }) {
  const p = setup.people;
  return (
    <div className="grid gap-3">
      <div className="surface-panel p-4 text-sm">
        <strong>{p.with_phone}</strong> of {p.active} active people have a mobile number
        {p.opted_out ? (
          <>
            ; <strong>{p.opted_out}</strong> turned WhatsApp off
          </>
        ) : null}
        . People without a number still get in-app notifications; their WhatsApp messages show as "Not sent". Add numbers on{" "}
        <Link to="/admin/users" className="text-primary underline-offset-2 hover:underline">
          Users
        </Link>{" "}
        or, for field staff,{" "}
        <Link to="/admin/field-staff" className="text-primary underline-offset-2 hover:underline">
          Field Staff
        </Link>
        , then use "Send again" on their messages.
      </div>
      {p.missing_phone.length > 0 && (
        <div className="surface-panel overflow-hidden">
          <div className="border-b bg-muted/40 px-4 py-2 text-sm font-semibold">No mobile number ({p.missing_phone.length})</div>
          <ul className="grid divide-y sm:grid-cols-2 sm:divide-y-0">
            {p.missing_phone.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm sm:border-b">
                <span>{u.name}</span>
                <span className="text-xs text-muted-foreground">
                  {roleLabel(u.role)}
                  {FIELD_ROLES.includes(u.role) ? " · Field Staff page" : " · Users page"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
