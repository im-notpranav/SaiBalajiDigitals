import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { NO_DISTRICT, ZoneBoardPage, type ZoneSearch } from "@/components/allocation/ZoneBoard";
import type { Zone } from "@/api/zoneBoard";

const ZONES: Zone[] = ["LOCAL", "NON_LOCAL", "NOT_SET"];

export const Route = createFileRoute("/_portal/admin/zones")({
  head: () => ({ meta: [{ title: "Zone Board — SB OMS" }] }),
  // Anything unexpected in the address is dropped rather than shown as an error.
  validateSearch: (s: Record<string, unknown>): ZoneSearch => ({
    date: typeof s.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.date) ? s.date : undefined,
    span: s.span === "week" ? "week" : undefined,
    zone: ZONES.includes(s.zone as Zone) ? (s.zone as Zone) : undefined,
    district:
      s.zone === "NON_LOCAL" && typeof s.district === "string" && s.district.trim()
        ? s.district === NO_DISTRICT
          ? NO_DISTRICT
          : s.district.trim().slice(0, 100)
        : undefined,
  }),
  component: ZoneBoardRoute,
});

function ZoneBoardRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <ZoneBoardPage
      search={search}
      onSearch={(next, opts) => navigate({ search: next, replace: opts?.replace })}
    />
  );
}
