import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { FilterChip } from "@/components/dashboard/DashboardBits";
import { Button } from "@/components/ui/button";
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
  /** Which page of results, from 2 up; page 1 leaves it out. */
  page?: number;
}

/** Orders per page. The API's own default, so a list without a page asks for the same 50. */
export const ORDERS_PAGE_SIZE = 50;

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
    page: Number.isInteger(Number(search.page)) && Number(search.page) > 1 ? Number(search.page) : undefined,
  };
}

export function useOrdersFilters(search: OrdersSearch) {
  const navigate = useNavigate();
  const [section, setSection] = useState<OrdersSection>(search.section ?? "active");
  const [q, setQ] = useState(search.q ?? "");
  const [field, setField] = useState<SearchField>("any");
  const debouncedQ = useDebounce(q, 300);

  // The page stays mounted when the header's search runs from this same page.
  useEffect(() => setQ(search.q ?? ""), [search.q]);
  useEffect(() => {
    if (search.section) setSection(search.section);
  }, [search.section]);

  // The page lives in the URL, so Back, a reload or a shared link return to it.
  const page = search.page ?? 1;
  const setPage = (next: number) => {
    navigate({ to: ".", search: ((prev: OrdersSearch) => ({ ...prev, page: next > 1 ? next : undefined })) as never });
    document.querySelector("main")?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  };

  // A new search, tab or filter starts again at page 1.
  const filterKey = [section, field, debouncedQ, search.from, search.to, search.creator].join("|");
  const lastKey = useRef(filterKey);
  useEffect(() => {
    if (lastKey.current === filterKey) return;
    lastKey.current = filterKey;
    if (search.page) navigate({ to: ".", search: ((prev: OrdersSearch) => ({ ...prev, page: undefined })) as never, replace: true });
  }, [filterKey, search.page, navigate]);

  const params: Record<string, string | undefined> = {
    section,
    from: search.from,
    to: search.to,
    creator: search.creator,
    limit: String(ORDERS_PAGE_SIZE),
    page: page > 1 ? String(page) : undefined,
  };
  if (debouncedQ) params[field === "any" ? "q" : field] = debouncedQ;

  return { search, section, setSection, q, setQ, field, setField, debouncedQ, params, page, setPage };
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
  const { search, section, setSection, q, setQ, field, setField, debouncedQ, page } = filters;
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
          {total > shown && shown > 0 && (
            <>
              {" · "}showing {(page - 1) * ORDERS_PAGE_SIZE + 1}–{(page - 1) * ORDERS_PAGE_SIZE + shown}
            </>
          )}
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

    </div>
  );
}

/** Previous and Next under an order list, when it runs past one page. */
export function OrdersPager({ filters, total }: { filters: ReturnType<typeof useOrdersFilters>; total: number }) {
  const { page, setPage } = filters;
  const pages = Math.max(1, Math.ceil(total / ORDERS_PAGE_SIZE));
  if (pages <= 1 && page <= 1) return null;
  return (
    <nav aria-label="Pages of orders" className="mt-4 flex items-center justify-between gap-3">
      <Button variant="outline" size="sm" className="rounded-lg" disabled={page <= 1} onClick={() => setPage(page - 1)}>
        <ChevronLeft className="mr-1 h-4 w-4" aria-hidden /> Previous
      </Button>
      <span className="text-sm text-muted-foreground" aria-current="page">
        Page {page} of {pages}
      </span>
      <Button variant="outline" size="sm" className="rounded-lg" disabled={page >= pages} onClick={() => setPage(page + 1)}>
        Next <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
      </Button>
    </nav>
  );
}
