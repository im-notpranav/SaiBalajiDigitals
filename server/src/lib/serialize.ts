import type { Order, OrderItem, Role } from "@prisma/client";
import { decimalToNumber } from "./prisma.js";

type OrderWithItems = Order & { items: OrderItem[] };

function serializeItem(item: OrderItem) {
  return {
    id: item.id,
    s_no: item.s_no,
    media: item.media,
    width_inches: decimalToNumber(item.width_inches),
    height_inches: decimalToNumber(item.height_inches),
    qty: decimalToNumber(item.qty),
    total_sft: decimalToNumber(item.total_sft),
    rate: decimalToNumber(item.rate),
    amount: decimalToNumber(item.amount),
  };
}

function orderTotal(order: OrderWithItems) {
  return order.items.reduce((s, i) => s + decimalToNumber(i.amount), 0);
}

export function serializeOrder(order: OrderWithItems, role: Role) {
  const total_amount = Number(orderTotal(order).toFixed(2));

  if (role === "production") {
    return {
      id: order.id,
      order_no: order.order_no,
      client_name: order.client_name,
      store_name: order.store_name,
      location: order.location,
      status: order.status,
      items: order.items.map((i) => ({
        s_no: i.s_no,
        media: i.media,
        width_inches: decimalToNumber(i.width_inches),
        height_inches: decimalToNumber(i.height_inches),
        qty: decimalToNumber(i.qty),
        total_sft: decimalToNumber(i.total_sft),
      })),
    };
  }

  return {
    id: order.id,
    order_no: order.order_no,
    client_name: order.client_name,
    store_name: order.store_name,
    location: order.location,
    date: order.date.toISOString(),
    po_number: order.po_number,
    remarks: order.remarks,
    status: order.status,
    invoice_no: order.invoice_no,
    bill_amount: order.bill_amount != null ? decimalToNumber(order.bill_amount) : null,
    created_by: order.created_by,
    creator_name: order.creator_name,
    items: order.items.map(serializeItem),
    total_amount,
    created_at: order.created_at.toISOString(),
  };
}

export function serializeOrders(orders: OrderWithItems[], role: Role) {
  return orders.map((o) => serializeOrder(o, role));
}
