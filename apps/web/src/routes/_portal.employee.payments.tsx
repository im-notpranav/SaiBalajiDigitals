import { createFileRoute } from "@tanstack/react-router";
import { MyPaymentRequests } from "@/components/payments/PaymentPages";

export const Route = createFileRoute("/_portal/employee/payments")({
  head: () => ({ meta: [{ title: "Payment Requests — SB OMS" }] }),
  component: () => <MyPaymentRequests crumbs={[{ label: "Payment Requests" }]} />,
});
