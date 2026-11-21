import { createFileRoute } from "@tanstack/react-router";
import { RateCardPage } from "@/components/rates/RateCardPage";

export const Route = createFileRoute("/_portal/employee/rate-cards")({
  head: () => ({ meta: [{ title: "Rate Cards — SB OMS" }] }),
  component: () => <RateCardPage mode="csm" />,
});
