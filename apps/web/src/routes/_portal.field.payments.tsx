import { createFileRoute } from "@tanstack/react-router";
import { MyPaymentRequests } from "@/components/payments/PaymentPages";

export const Route = createFileRoute("/_portal/field/payments")({
  head: () => ({ meta: [{ title: "Payments — SB OMS" }] }),
  component: () => <MyPaymentRequests crumbs={[{ label: "Payments" }]} />,
});
