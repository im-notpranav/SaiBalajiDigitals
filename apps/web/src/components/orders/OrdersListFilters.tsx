import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";
import { Search } from "lucide-react";
import { FilterChip } from "@/components/dashboard/DashboardBits";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDebounce } from "@/hooks/use-debounce";

/**
 * The filters shared by the Admin's, the CSM's and the Accountant's order lists. A link can set
 * them through the URL: the header's search, or a dashboard number that opens the matching list.
 */

export type OrdersSection = "active" | "completed";
type SearchField = "any" | "client" | "store" | "order_no";

export interface OrdersSearch {
  q?: string;
  section?: OrdersSection;
  /** Order dates, yyyy-MM-dd. */
  from?: string;
  to?: string;
  /** The exact name of the person who created the order. */
  creator?: string;
}

const text = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

export function parseOrdersSearch(search: Record<string, unknown>): OrdersSearch {
  return {
    // A search for digits arrives as a number once the router has read the URL.
    q: typeof search.q === "number" ? String(search.q) : text(search.q),
    section: search.section === "active" || search.section === "completed" ? search.section : undefined,
    from: day(search.from),
    to: day(search.to),
    creator: text(search.creator),
  };
}

export function useOrdersFilters(search: OrdersSearch) {
  const [section, setSection] = useState<OrdersSection>(search.section ?? "active");
  const [q, setQ] = useState(search.q ?? "");
  const [field, setField] = useState<SearchField>("any");
  const debouncedQ = useDebounce(q, 300);

  // The page stays mounted when the header's search runs from this same page.
  useEffect(() => setQ(search.q ?? ""), [search.q]);
  useEffect(() => {
    if (search.section) setSection(search.section);
  }, [search.section]);

  const params: Record<string, string | undefined> = {
    section,
    from: search.from,
    to: search.to,
    creator: search.creator,
  };
  if (debouncedQ) params[field === "any" ? "q" : field] = debouncedQ;

  return { search, section, setSection, q, setQ, field, setField, debouncedQ, params };
}

const showDay = (iso: string) => format(new Date(`${iso}T00:00:00`), "dd MMM yyyy");

const PLACEHOLDER: Record<SearchField, string> = {
  any: "Search by order number, client or store...",
  client: "Search by client name...",
  store: "Search by store name...",
  order_no: "Search by order number...",
};

export function OrdersFilterBar({
  filters,
  total,
  shown,
}: {
  filters: ReturnType<typeof useOrdersFilters>;
  total: number;
  shown: number;
}) {
  const navigate = useNavigate();
  const { search, section, setSection, q, setQ, field, setField, debouncedQ } = filters;
  const clear = (keys: (keyof OrdersSearch)[]) =>
    navigate({
      to: ".",
      search: ((prev: OrdersSearch) => {
        const next = { ...prev };
        for (const k of keys) delete next[k];
        return next;
      }) as never,
      replace: true,
    });

  const other: OrdersSection = section === "active" ? "completed" : "active";
  const hasDates = search.from || search.to;

  return (
    <div className="surface-panel mb-4 grid gap-3 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={section} onValueChange={(v) => setSection(v as OrdersSection)} className="w-full sm:w-[300px]">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="completed">Completed</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Takes its own line on a phone: the select plus a 200px-minimum search box is
            wider than the content column at 375px. */}
        <div className="flex w-full min-w-0 flex-1 items-center gap-2 sm:w-auto">
          <Select value={field} onValueChange={(v) => setField(v as SearchField)}>
            <SelectTrigger aria-label="Search in" className="w-[120px] shrink-0 sm:w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Everything</SelectItem>
              <SelectItem value="client">Client Name</SelectItem>
              <SelectItem value="store">Store Name</SelectItem>
              <SelectItem value="order_no">Order No</SelectItem>
            </SelectContent>
          </Select>

          <div className="relative min-w-0 flex-1 sm:min-w-[200px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search orders"
              placeholder={PLACEHOLDER[field]}
              className="pl-9"
            />
          </div>
        </div>

        <div className="w-full text-xs text-muted-foreground sm:ml-auto sm:w-auto" role="status">
          {total} {total === 1 ? "order" : "orders"} found
          {debouncedQ && (
            <>
              {" · "}
              <button
                type="button"
                onClick={() => setSection(other)}
                className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Look in {other === "completed" ? "Completed" : "Active"}
              </button>
            </>
          )}
        </div>
      </div>

      {(hasDates || search.creator) && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Showing only:</span>
          {hasDates && (
            <FilterChip
              label={`Dated ${search.from ? showDay(search.from) : "any time"} to ${search.to ? showDay(search.to) : "today"}`}
              onClear={() => clear(["from", "to"])}
            />
          )}
          {search.creator && <FilterChip label={`Created by ${search.creator}`} onClear={() => clear(["creator"])} />}
        </div>
      )}

      {total > shown && (
        <p className="text-xs text-muted-foreground">
          Showing the first {shown} of {total}. Search or narrow the dates to find the rest.
        </p>
      )}
    </div>
  );
}
