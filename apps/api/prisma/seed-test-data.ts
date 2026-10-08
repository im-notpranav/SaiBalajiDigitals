/**
 * TEMPORARY TEST DATA SEEDER
 *
 * Creates fake orders across ALL pipeline stages with realistic dates
 * so every module (TAT, dashboards, aging, billing, payment) can be tested.
 *
 * Run:    npx tsx prisma/seed-test-data.ts
 * Remove: npx tsx prisma/seed-test-data.ts --cleanup
 *
 * All test orders use the client name prefix "[TEST]" for easy identification
 * and the order_no prefix "TEST" so they never collide with real ORD sequence.
 */

import { PrismaClient, type OrderStatus } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

const prisma = new PrismaClient();

// ── Config ──────────────────────────────────────────────────────────
const TEST_PREFIX = "[TEST]";
const CSM_ID = 1;       // bablugoud
const ADMIN_ID = 4;     // maheshgoud
const ACCT_ID = 3;      // accountant
const PROD1_ID = 2;     // production1 / Machine1
const PROD2_ID = 8;     // production2 / Machine2
const PROD_MGR_ID = 9;  // operator / Suresh Kumar

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(10, 0, 0, 0);
  return d;
}

function sft(w: number, h: number, qty: number): number {
  return parseFloat(((w * h * qty) / 144).toFixed(2));
}

function amt(w: number, h: number, qty: number, rate: number): number {
  return parseFloat((sft(w, h, qty) * rate).toFixed(2));
}

// ── Order definitions ───────────────────────────────────────────────
interface TestItem {
  media: string;
  width_inches: number;
  height_inches: number;
  qty: number;
  rate: number;
  remarks?: string;
  remarks_confirmed?: boolean;
  production_completed?: boolean;
  production_completed_at?: Date;
  assign_to?: number[];      // production user IDs
  assign_completed?: boolean; // are the assignments completed?
  is_flagged?: boolean;
  flag_reason?: string;
}

interface TestOrder {
  order_no: string;
  client_name: string;
  store_name: string;
  location: string;
  status: OrderStatus;
  date: Date;
  created_by: number;
  creator_name: string;
  po_number?: string;
  installed_at?: Date;
  installed_by?: number;
  billing_completed_at?: Date;
  invoice_no?: string;
  bill_amount?: number;
  billing_date?: Date;
  amount_received?: number;
  payment_received_at?: Date;
  payment_received_by?: number;
  remarks?: string;
  remarks_other_text?: string;
  items: TestItem[];
  follow_ups?: { note: string; created_by: number; created_at: Date }[];
}

const testOrders: TestOrder[] = [
  // ═══════════════════════════════════════════════════════════════════
  // STAGE 1: ACTIVE — fresh orders, no production yet
  // ═══════════════════════════════════════════════════════════════════
  {
    order_no: "TEST0001",
    client_name: `${TEST_PREFIX} Reliance Digital`,
    store_name: "Hitech City Outlet",
    location: "Hyderabad",
    status: "Active",
    date: daysAgo(1),
    created_by: CSM_ID,
    creator_name: "Bablu Goud",
    po_number: "PO-RD-2026-001",
    items: [
      { media: "Vinyl", width_inches: 48, height_inches: 96, qty: 2, rate: 35 },
      { media: "Flex", width_inches: 120, height_inches: 36, qty: 1, rate: 25 },
    ],
  },
  {
    order_no: "TEST0002",
    client_name: `${TEST_PREFIX} Cafe Coffee Day`,
    store_name: "Jubilee Hills",
    location: "Hyderabad",
    status: "Active",
    date: daysAgo(3),
    created_by: CSM_ID,
    creator_name: "Bablu Goud",
    items: [
      { media: "Sunboard", width_inches: 24, height_inches: 36, qty: 4, rate: 45 },
      { media: "Acrylic", width_inches: 12, height_inches: 18, qty: 6, rate: 120 },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // STAGE 2: ACTIVE — in production (assigned, some completed)
  // ═══════════════════════════════════════════════════════════════════
  {
    order_no: "TEST0003",
    client_name: `${TEST_PREFIX} Big Bazaar`,
    store_name: "Ameerpet",
    location: "Hyderabad",
    status: "Active",
    date: daysAgo(6),
    created_by: CSM_ID,
    creator_name: "Bablu Goud",
    po_number: "PO-BB-440",
    items: [
      {
        media: "Vinyl", width_inches: 96, height_inches: 48, qty: 3, rate: 30,
        assign_to: [PROD1_ID],
        production_completed: true, production_completed_at: daysAgo(3),
        assign_completed: true,
      },
      {
        media: "Flex", width_inches: 240, height_inches: 48, qty: 1, rate: 22,
        assign_to: [PROD2_ID],
        // still in production — not completed
      },
      {
        media: "Sunboard", width_inches: 18, height_inches: 24, qty: 8, rate: 50,
        assign_to: [PROD1_ID, PROD2_ID],
        // split assignment, neither completed
      },
    ],
  },
  {
    order_no: "TEST0004",
    client_name: `${TEST_PREFIX} Titan Eye Plus`,
    store_name: "Begumpet",
    location: "Secunderabad",
    status: "Active",
    date: daysAgo(10), // 10 days old → should show as overdue/aging
    created_by: CSM_ID,
    creator_name: "Bablu Goud",
    items: [
      {
        media: "Acrylic", width_inches: 36, height_inches: 48, qty: 2, rate: 150,
        assign_to: [PROD1_ID],
        // long overdue in production — 10 days
      },
      {
        media: "Vinyl", width_inches: 60, height_inches: 36, qty: 1, rate: 35,
        assign_to: [PROD1_ID],
        production_completed: true, production_completed_at: daysAgo(5),
        assign_completed: true,
      },
    ],
  },
  // Active order with a flagged item
  {
    order_no: "TEST0005",
    client_name: `${TEST_PREFIX} Decathlon`,
    store_name: "Gachibowli",
    location: "Hyderabad",
    status: "Active",
    date: daysAgo(5),
    created_by: CSM_ID,
    creator_name: "Bablu Goud",
    items: [
      {
        media: "Flex", width_inches: 180, height_inches: 60, qty: 1, rate: 20,
        assign_to: [PROD2_ID],
        is_flagged: true,
        flag_reason: "Size changed by client — should be 200x60",
      },
      {
        media: "Vinyl", width_inches: 48, height_inches: 72, qty: 2, rate: 30,
        assign_to: [PROD1_ID],
        production_completed: true, production_completed_at: daysAgo(2),
        assign_completed: true,
      },
    ],
  },
  // Active order with a loss remark (proposed, not confirmed)
  {
    order_no: "TEST0006",
    client_name: `${TEST_PREFIX} Tanishq`,
    store_name: "Kukatpally",
    location: "Hyderabad",
    status: "Active",
    date: daysAgo(4),
    created_by: CSM_ID,
    creator_name: "Bablu Goud",
    items: [
      { media: "Acrylic", width_inches: 24, height_inches: 36, qty: 3, rate: 200 },
      {
        media: "Vinyl", width_inches: 36, height_inches: 48, qty: 1, rate: 35,
        remarks: "Reprint",
        remarks_confirmed: false, // proposed by CSM, pending admin confirmation
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // STAGE 3: INSTALLED — production done, installation confirmed
  // ═══════════════════════════════════════════════════════════════════
  {
    order_no: "TEST0007",
    client_name: `${TEST_PREFIX} Apollo Pharmacy`,
    store_name: "Madhapur",
    location: "Hyderabad",
    status: "Installed",
    date: daysAgo(12),
    created_by: CSM_ID,
    creator_name: "Bablu Goud",
    installed_at: daysAgo(5),
    installed_by: CSM_ID,
    items: [
      {
        media: "Vinyl", width_inches: 72, height_inches: 48, qty: 2, rate: 30,
        assign_to: [PROD1_ID],
        production_completed: true, production_completed_at: daysAgo(7),
        assign_completed: true,
      },
      {
        media: "Flex", width_inches: 96, height_inches: 36, qty: 1, rate: 22,
        assign_to: [PROD2_ID],
        production_completed: true, production_completed_at: daysAgo(6),
        assign_completed: true,
      },
    ],
  },
  {
    order_no: "TEST0008",
    client_name: `${TEST_PREFIX} Malabar Gold`,
    store_name: "KPHB Colony",
    location: "Hyderabad",
    status: "Installed",
    date: daysAgo(15),
    created_by: CSM_ID,
    creator_name: "Bablu Goud",
    installed_at: daysAgo(8),
    installed_by: CSM_ID,
    items: [
      {
        media: "Acrylic", width_inches: 48, height_inches: 72, qty: 1, rate: 180,
        assign_to: [PROD1_ID],
        production_completed: true, production_completed_at: daysAgo(10),
        assign_completed: true,
      },
      {
        media: "Sunboard", width_inches: 24, height_inches: 36, qty: 6, rate: 55,
        assign_to: [PROD2_ID],
        production_completed: true, production_completed_at: daysAgo(9),
        assign_completed: true,
        remarks: "Sample",
        remarks_confirmed: true, // confirmed loss
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // STAGE 4: BILLING COMPLETED — invoice raised, awaiting payment
  // ═══════════════════════════════════════════════════════════════════
  {
    order_no: "TEST0009",
    client_name: `${TEST_PREFIX} Raymond`,
    store_name: "Banjara Hills",
    location: "Hyderabad",
    status: "BillingCompleted",
    date: daysAgo(20),
    created_by: CSM_ID,
    creator_name: "Bablu Goud",
    installed_at: daysAgo(14),
    installed_by: CSM_ID,
    billing_completed_at: daysAgo(10),
    invoice_no: "INV-TEST-001",
    bill_amount: 0, // will be computed
    billing_date: daysAgo(10),
    items: [
      {
        media: "Vinyl", width_inches: 96, height_inches: 72, qty: 2, rate: 32,
        assign_to: [PROD1_ID],
        production_completed: true, production_completed_at: daysAgo(16),
        assign_completed: true,
      },
      {
        media: "Flex", width_inches: 120, height_inches: 48, qty: 1, rate: 25,
        assign_to: [PROD2_ID],
        production_completed: true, production_completed_at: daysAgo(15),
        assign_completed: true,
      },
    ],
    follow_ups: [
      { note: "Called client, said payment will be processed next week", created_by: CSM_ID, created_at: daysAgo(7) },
      { note: "Reminder sent via email", created_by: ACCT_ID, created_at: daysAgo(3) },
    ],
  },
  {
    order_no: "TEST0010",
    client_name: `${TEST_PREFIX} Peter England`,
    store_name: "Ameerpet",
    location: "Hyderabad",
    status: "BillingCompleted",
    date: daysAgo(25),
    created_by: CSM_ID,
    creator_name: "Bablu Goud",
    installed_at: daysAgo(18),
    installed_by: CSM_ID,
    billing_completed_at: daysAgo(12),
    invoice_no: "INV-TEST-002",
    bill_amount: 0,
    billing_date: daysAgo(12),
    items: [
      {
        media: "Sunboard", width_inches: 48, height_inches: 36, qty: 4, rate: 50,
        assign_to: [PROD1_ID, PROD2_ID],
        production_completed: true, production_completed_at: daysAgo(20),
        assign_completed: true,
      },
    ],
    follow_ups: [
      { note: "1st follow-up: Client requested invoice copy", created_by: ACCT_ID, created_at: daysAgo(8) },
      { note: "2nd follow-up: Spoke to accounts dept, processing", created_by: CSM_ID, created_at: daysAgo(5) },
      { note: "3rd follow-up: Escalated to manager, overdue 12 days", created_by: ACCT_ID, created_at: daysAgo(1) },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // STAGE 5: PENDING — billed short (amount mismatch)
  // ═══════════════════════════════════════════════════════════════════
  {
    order_no: "TEST0011",
    client_name: `${TEST_PREFIX} Lenskart`,
    store_name: "Tolichowki",
    location: "Hyderabad",
    status: "Pending",
    date: daysAgo(18),
    created_by: CSM_ID,
    creator_name: "Bablu Goud",
    installed_at: daysAgo(12),
    installed_by: CSM_ID,
    billing_completed_at: daysAgo(8),
    invoice_no: "INV-TEST-003",
    bill_amount: 5000, // deliberately wrong — creates mismatch
    billing_date: daysAgo(8),
    items: [
      {
        media: "Acrylic", width_inches: 36, height_inches: 24, qty: 5, rate: 130,
        assign_to: [PROD1_ID],
        production_completed: true, production_completed_at: daysAgo(14),
        assign_completed: true,
      },
      {
        media: "Vinyl", width_inches: 48, height_inches: 36, qty: 2, rate: 35,
        assign_to: [PROD2_ID],
        production_completed: true, production_completed_at: daysAgo(13),
        assign_completed: true,
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // STAGE 6: PAYMENT RECEIVED — fully paid
  // ═══════════════════════════════════════════════════════════════════
  {
    order_no: "TEST0012",
    client_name: `${TEST_PREFIX} Croma`,
    store_name: "Punjagutta",
    location: "Hyderabad",
    status: "PaymentReceived",
    date: daysAgo(35),
    created_by: CSM_ID,
    creator_name: "Bablu Goud",
    po_number: "PO-CROMA-112",
    installed_at: daysAgo(28),
    installed_by: CSM_ID,
    billing_completed_at: daysAgo(22),
    invoice_no: "INV-TEST-004",
    bill_amount: 0,
    billing_date: daysAgo(22),
    amount_received: 0, // will be set = bill_amount
    payment_received_at: daysAgo(10),
    payment_received_by: ACCT_ID,
    items: [
      {
        media: "Flex", width_inches: 180, height_inches: 72, qty: 1, rate: 20,
        assign_to: [PROD1_ID],
        production_completed: true, production_completed_at: daysAgo(30),
        assign_completed: true,
      },
      {
        media: "Vinyl", width_inches: 96, height_inches: 48, qty: 3, rate: 30,
        assign_to: [PROD2_ID],
        production_completed: true, production_completed_at: daysAgo(30),
        assign_completed: true,
      },
    ],
    follow_ups: [
      { note: "Payment confirmed via NEFT", created_by: ACCT_ID, created_at: daysAgo(10) },
    ],
  },
  {
    order_no: "TEST0013",
    client_name: `${TEST_PREFIX} Jio Store`,
    store_name: "Secunderabad",
    location: "Secunderabad",
    status: "PaymentReceived",
    date: daysAgo(45),
    created_by: CSM_ID,
    creator_name: "Bablu Goud",
    installed_at: daysAgo(38),
    installed_by: CSM_ID,
    billing_completed_at: daysAgo(32),
    invoice_no: "INV-TEST-005",
    bill_amount: 0,
    billing_date: daysAgo(32),
    amount_received: 0,
    payment_received_at: daysAgo(5),
    payment_received_by: ACCT_ID,
    items: [
      {
        media: "Sunboard", width_inches: 36, height_inches: 48, qty: 3, rate: 55,
        assign_to: [PROD1_ID],
        production_completed: true, production_completed_at: daysAgo(40),
        assign_completed: true,
      },
      {
        media: "Acrylic", width_inches: 18, height_inches: 24, qty: 2, rate: 160,
        assign_to: [PROD1_ID],
        production_completed: true, production_completed_at: daysAgo(40),
        assign_completed: true,
      },
    ],
  },
  // PaymentReceived but with a short payment (amount_received < bill)
  {
    order_no: "TEST0014",
    client_name: `${TEST_PREFIX} Bata`,
    store_name: "Dilsukhnagar",
    location: "Hyderabad",
    status: "PaymentReceived",
    date: daysAgo(30),
    created_by: CSM_ID,
    creator_name: "Bablu Goud",
    installed_at: daysAgo(22),
    installed_by: CSM_ID,
    billing_completed_at: daysAgo(16),
    invoice_no: "INV-TEST-006",
    bill_amount: 0,
    billing_date: daysAgo(16),
    amount_received: 3000, // deliberately short-paid
    payment_received_at: daysAgo(2),
    payment_received_by: ACCT_ID,
    items: [
      {
        media: "Flex", width_inches: 120, height_inches: 48, qty: 2, rate: 25,
        assign_to: [PROD2_ID],
        production_completed: true, production_completed_at: daysAgo(24),
        assign_completed: true,
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // STAGE 7: COMPLETED — admin force-closed
  // ═══════════════════════════════════════════════════════════════════
  {
    order_no: "TEST0015",
    client_name: `${TEST_PREFIX} Wipro Lighting`,
    store_name: "HITEC City",
    location: "Hyderabad",
    status: "Completed",
    date: daysAgo(60),
    created_by: CSM_ID,
    creator_name: "Bablu Goud",
    installed_at: daysAgo(50),
    installed_by: CSM_ID,
    billing_completed_at: daysAgo(45),
    invoice_no: "INV-TEST-007",
    bill_amount: 0,
    billing_date: daysAgo(45),
    amount_received: 0,
    payment_received_at: daysAgo(30),
    payment_received_by: ACCT_ID,
    remarks: "Revised" as any,
    remarks_other_text: "Client requested revised scope — closed after partial delivery",
    items: [
      {
        media: "Vinyl", width_inches: 120, height_inches: 96, qty: 1, rate: 28,
        assign_to: [PROD1_ID],
        production_completed: true, production_completed_at: daysAgo(53),
        assign_completed: true,
      },
      {
        media: "Sunboard", width_inches: 48, height_inches: 36, qty: 3, rate: 48,
        assign_to: [PROD2_ID],
        production_completed: true, production_completed_at: daysAgo(52),
        assign_completed: true,
        remarks: "FreeOfCost",
        remarks_confirmed: true,
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // STAGE 8: BILLING COMPLETED — very overdue payment (>30 days)
  // Tests the overdue/aging detection
  // ═══════════════════════════════════════════════════════════════════
  {
    order_no: "TEST0016",
    client_name: `${TEST_PREFIX} Havells`,
    store_name: "LB Nagar",
    location: "Hyderabad",
    status: "BillingCompleted",
    date: daysAgo(50),
    created_by: CSM_ID,
    creator_name: "Bablu Goud",
    installed_at: daysAgo(42),
    installed_by: CSM_ID,
    billing_completed_at: daysAgo(38),
    invoice_no: "INV-TEST-008",
    bill_amount: 0,
    billing_date: daysAgo(38),
    items: [
      {
        media: "Acrylic", width_inches: 72, height_inches: 48, qty: 2, rate: 140,
        assign_to: [PROD1_ID],
        production_completed: true, production_completed_at: daysAgo(45),
        assign_completed: true,
      },
    ],
    follow_ups: [
      { note: "1st follow-up call — no response", created_by: CSM_ID, created_at: daysAgo(30) },
      { note: "2nd follow-up — client says next month", created_by: ACCT_ID, created_at: daysAgo(20) },
      { note: "3rd follow-up — escalated, still pending", created_by: CSM_ID, created_at: daysAgo(10) },
      { note: "4th follow-up — legal notice warning sent", created_by: ACCT_ID, created_at: daysAgo(2) },
    ],
  },
];

// ── Seed logic ──────────────────────────────────────────────────────
async function seedTestData() {
  console.log("🌱 Seeding test data across all pipeline stages...\n");

  let created = 0;
  for (const def of testOrders) {
    // Skip if already exists
    const existing = await prisma.order.findUnique({ where: { order_no: def.order_no } });
    if (existing) {
      console.log(`  ⏭  ${def.order_no} already exists, skipping`);
      continue;
    }

    // Compute item totals
    const itemsData = def.items.map((item, idx) => {
      const totalSft = sft(item.width_inches, item.height_inches, item.qty);
      const amount = amt(item.width_inches, item.height_inches, item.qty, item.rate);
      return {
        s_no: idx + 1,
        media: item.media,
        width_inches: new Decimal(item.width_inches),
        height_inches: new Decimal(item.height_inches),
        qty: new Decimal(item.qty),
        total_sft: new Decimal(totalSft),
        rate: new Decimal(item.rate),
        amount: new Decimal(amount),
        remarks: item.remarks as any ?? null,
        remarks_confirmed: item.remarks_confirmed ?? false,
        remarks_confirmed_at: item.remarks_confirmed ? daysAgo(3) : null,
        remarks_confirmed_by: item.remarks_confirmed ? ADMIN_ID : null,
        remarks_set_at: item.remarks ? daysAgo(4) : null,
        remarks_set_by: item.remarks ? CSM_ID : null,
        is_flagged: item.is_flagged ?? false,
        flag_reason: item.flag_reason ?? null,
        flagged_at: item.is_flagged ? daysAgo(2) : null,
        flagged_by: item.is_flagged ? CSM_ID : null,
        production_completed: item.production_completed ?? false,
        production_completed_at: item.production_completed_at ?? null,
      };
    });

    // Compute billable total (exclude confirmed losses)
    const billableTotal = itemsData.reduce((sum, item, idx) => {
      const defItem = def.items[idx]!;
      const isConfirmedLoss = defItem.remarks && defItem.remarks_confirmed;
      return isConfirmedLoss ? sum : sum + parseFloat(item.amount.toString());
    }, 0);

    // Set bill_amount to billable total for billed orders
    let finalBillAmount = def.bill_amount;
    if (finalBillAmount === 0 && def.invoice_no) {
      finalBillAmount = parseFloat(billableTotal.toFixed(2));
    }

    // Set amount_received for paid orders
    let finalAmountReceived = def.amount_received;
    if (finalAmountReceived === 0 && def.payment_received_at) {
      finalAmountReceived = finalBillAmount;
    }

    const order = await prisma.order.create({
      data: {
        order_no: def.order_no,
        client_name: def.client_name,
        store_name: def.store_name,
        location: def.location,
        status: def.status,
        date: def.date,
        created_by: def.created_by,
        creator_name: def.creator_name,
        po_number: def.po_number ?? null,
        installed_at: def.installed_at ?? null,
        installed_by: def.installed_by ?? null,
        billing_completed_at: def.billing_completed_at ?? null,
        invoice_no: def.invoice_no ?? null,
        bill_amount: finalBillAmount != null ? new Decimal(finalBillAmount) : null,
        billing_date: def.billing_date ?? null,
        amount_received: finalAmountReceived != null ? new Decimal(finalAmountReceived) : null,
        payment_received_at: def.payment_received_at ?? null,
        payment_received_by: def.payment_received_by ?? null,
        remarks: def.remarks as any ?? null,
        remarks_other_text: def.remarks_other_text ?? null,
        items: { create: itemsData },
      },
      include: { items: true },
    });

    // Create assignments for items
    for (let i = 0; i < def.items.length; i++) {
      const itemDef = def.items[i]!;
      const dbItem = order.items[i]!;
      if (itemDef.assign_to) {
        for (const userId of itemDef.assign_to) {
          await prisma.orderItemAssignment.create({
            data: {
              order_item_id: dbItem.id,
              user_id: userId,
              assigned_by: PROD_MGR_ID,
              assigned_at: new Date(def.date.getTime() + 86400000), // day after order
              completed: itemDef.assign_completed ?? false,
              completed_at: itemDef.assign_completed && itemDef.production_completed_at
                ? itemDef.production_completed_at
                : null,
            },
          });
        }
      }
    }

    // Create follow-ups
    if (def.follow_ups) {
      for (const fu of def.follow_ups) {
        await prisma.paymentFollowUp.create({
          data: {
            order_id: order.id,
            note: fu.note,
            created_by: fu.created_by,
            created_at: fu.created_at,
          },
        });
      }
    }

    const statusLabel = {
      Active: "🟢 Active",
      Installed: "🔵 Installed",
      BillingCompleted: "🟡 Billing Done",
      Pending: "🟠 Pending",
      PaymentReceived: "✅ Payment Received",
      Completed: "⬛ Completed",
    }[def.status];

    console.log(`  ✓ ${def.order_no}  ${statusLabel.padEnd(22)} ${def.client_name}  (${def.items.length} items, ₹${billableTotal.toFixed(0)})`);
    created++;
  }

  console.log(`\n✅ Seeded ${created} test orders. Run with --cleanup to remove them.`);
}

async function cleanupTestData() {
  console.log("🧹 Removing all test data...\n");

  const testOrders = await prisma.order.findMany({
    where: { order_no: { startsWith: "TEST" } },
    select: { id: true, order_no: true },
  });

  if (testOrders.length === 0) {
    console.log("  No test orders found. Nothing to clean up.");
    return;
  }

  for (const order of testOrders) {
    // Cascade delete handles items, assignments, follow-ups, change logs, notifications
    await prisma.order.delete({ where: { id: order.id } });
    console.log(`  🗑  Deleted ${order.order_no}`);
  }

  console.log(`\n✅ Removed ${testOrders.length} test orders.`);
}

// ── Entry point ─────────────────────────────────────────────────────
const isCleanup = process.argv.includes("--cleanup");

(isCleanup ? cleanupTestData() : seedTestData())
  .catch((e) => {
    console.error("❌ Error:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
