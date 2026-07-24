export type OrderStatus =
  | "draft"
  | "pending"
  | "in_production"
  | "ready_to_bill"
  | "billed"
  | "closed";

export interface OrderItem {
  id: string;
  description: string;
  quantity: number;
  rate: number;
  total: number;
}

export interface Order {
  id: string;
  number: string;
  customer: string;
  createdBy: string;
  createdAt: string;
  status: OrderStatus;
  stage: string;
  ageHours: number;
  total: number;
  sft: number;
  items: OrderItem[];
  priority: "low" | "medium" | "high";
}

const stages: Record<OrderStatus, string> = {
  draft: "Draft",
  pending: "Awaiting Production",
  in_production: "In Production",
  ready_to_bill: "Ready to Bill",
  billed: "Billed",
  closed: "Closed",
};

function makeItems(seed: number): OrderItem[] {
  const specs = [
    "Vinyl Flex Banner 8x4 ft",
    "Backlit ACP Signage",
    "3D LED Channel Letters",
    "Rollup Standee 3x6",
    "Foam Board Print A2",
    "Vehicle Wrap Full",
  ];
  const n = 1 + (seed % 3);
  return Array.from({ length: n }, (_, i) => {
    const qty = 1 + ((seed + i) % 8);
    const rate = 250 + ((seed * 37 + i * 91) % 1400);
    return {
      id: `it-${seed}-${i}`,
      description: specs[(seed + i) % specs.length]!,
      quantity: qty,
      rate,
      total: qty * rate,
    };
  });
}

const customers = [
  "Reliance Retail",
  "Tata Motors",
  "Infosys Campus",
  "HDFC Bank",
  "Bharat Petroleum",
  "Zomato",
  "Café Coffee Day",
  "Ola Electric",
  "Lulu Mall",
  "Apollo Hospitals",
  "Manipal University",
  "Decathlon",
];

const employees = ["Ananya Rao", "Vikram Iyer", "Sneha Kapoor", "Rahul Nair"];
const statuses: OrderStatus[] = [
  "pending",
  "pending",
  "in_production",
  "in_production",
  "in_production",
  "ready_to_bill",
  "billed",
  "closed",
];

export const ORDERS: Order[] = Array.from({ length: 42 }, (_, i) => {
  const items = makeItems(i + 1);
  const total = items.reduce((s, it) => s + it.total, 0);
  const status = statuses[i % statuses.length]!;
  const daysAgo = (i * 3) % 45;
  const createdAt = new Date(Date.now() - daysAgo * 86400000).toISOString();
  return {
    id: `ord-${i + 1}`,
    number: `ORD26${String(1000 + i).padStart(4, "0")}`,
    customer: customers[i % customers.length]!,
    createdBy: employees[i % employees.length]!,
    createdAt,
    status,
    stage: stages[status],
    ageHours: 3 + ((i * 7) % 96),
    total,
    sft: 40 + ((i * 13) % 480),
    items,
    priority: (["low", "medium", "high"] as const)[i % 3]!,
  };
});

export function ordersByStatus(status: OrderStatus) {
  return ORDERS.filter((o) => o.status === status);
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  role: string;
  action: string;
  target: string;
  detail: string;
}

export const AUDIT: AuditEntry[] = Array.from({ length: 60 }, (_, i) => {
  const actions = [
    { a: "order.create", d: "Created new order" },
    { a: "order.status.advance", d: "Advanced production status" },
    { a: "order.billed", d: "Marked as billed" },
    { a: "order.closed", d: "Closed with remark: Delivered" },
    { a: "order.edit", d: "Updated line item quantity" },
    { a: "user.deactivate", d: "Deactivated user account" },
    { a: "fy.rollover", d: "Financial year rollover executed" },
  ];
  const act = actions[i % actions.length]!;
  const actors = [
    { n: "Ananya Rao", r: "Employee" },
    { n: "Karthik Menon", r: "Production" },
    { n: "Priya Sharma", r: "Accountant" },
    { n: "Rajesh Balaji", r: "Administrator" },
  ];
  const actor = actors[i % actors.length]!;
  return {
    id: `au-${i + 1}`,
    at: new Date(Date.now() - i * 1800000).toISOString(),
    actor: actor.n,
    role: actor.r,
    action: act.a,
    target: `ORD26${String(1000 + (i % 42)).padStart(4, "0")}`,
    detail: act.d,
  };
});

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: "employee" | "production" | "accountant" | "admin";
  status: "active" | "inactive";
  lastActive: string;
}

export const APP_USERS: AppUser[] = [
  { id: "1", name: "Ananya Rao", email: "ananya@saibalaji.com", role: "employee", status: "active", lastActive: "2m ago" },
  { id: "2", name: "Vikram Iyer", email: "vikram@saibalaji.com", role: "employee", status: "active", lastActive: "18m ago" },
  { id: "3", name: "Sneha Kapoor", email: "sneha@saibalaji.com", role: "employee", status: "active", lastActive: "1h ago" },
  { id: "4", name: "Rahul Nair", email: "rahul@saibalaji.com", role: "employee", status: "inactive", lastActive: "12d ago" },
  { id: "5", name: "Karthik Menon", email: "karthik@saibalaji.com", role: "production", status: "active", lastActive: "5m ago" },
  { id: "6", name: "Divya Pillai", email: "divya@saibalaji.com", role: "production", status: "active", lastActive: "22m ago" },
  { id: "7", name: "Priya Sharma", email: "priya@saibalaji.com", role: "accountant", status: "active", lastActive: "just now" },
  { id: "8", name: "Rajesh Balaji", email: "rajesh@saibalaji.com", role: "admin", status: "active", lastActive: "just now" },
];

export interface Notification {
  id: string;
  title: string;
  body: string;
  at: string;
  read: boolean;
  kind: "info" | "success" | "warning";
}

export const NOTIFICATIONS: Notification[] = [
  { id: "n1", title: "Order ORD261004 billed", body: "Your order has been marked as billed by accounts.", at: "2m ago", read: false, kind: "success" },
  { id: "n2", title: "New order in production queue", body: "ORD261012 needs stage advancement.", at: "18m ago", read: false, kind: "info" },
  { id: "n3", title: "FY rollover due in 6 days", body: "Financial year FY26 closes on 30 Apr.", at: "1h ago", read: false, kind: "warning" },
  { id: "n4", title: "Order ORD260998 closed", body: "Closure remark: Delivered.", at: "3h ago", read: true, kind: "success" },
  { id: "n5", title: "Admin override applied", body: "ORD261000 edited by Administrator.", at: "1d ago", read: true, kind: "info" },
];

export const REVENUE_TREND = [
  { month: "Nov", revenue: 1240000, orders: 78 },
  { month: "Dec", revenue: 1580000, orders: 92 },
  { month: "Jan", revenue: 1420000, orders: 85 },
  { month: "Feb", revenue: 1780000, orders: 104 },
  { month: "Mar", revenue: 2140000, orders: 121 },
  { month: "Apr", revenue: 1890000, orders: 112 },
];

export const CLOSURE_REMARK_TYPES = [
  "Delivered",
  "Customer Cancelled",
  "Duplicate Order",
  "Payment Cleared",
  "Custom Reason",
];

export const REMARK_TYPES = [
  "Clarification",
  "Internal Note",
  "Customer Update",
  "Production Handoff",
  "QC Hold",
];

export function inr(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}
