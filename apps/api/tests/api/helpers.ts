import jwt from "jsonwebtoken";
import request from "supertest";
import type { Role } from "@prisma/client";
import app from "../../src/app";
import { prisma } from "../../src/utils/prisma";

export { prisma };

let seq = 0;
/** Unique per run and per call, so files sharing the test database never collide. */
export const uniq = (prefix: string) => `${prefix}${Date.now().toString(36)}${++seq}`;

export async function makeUser(role: Role, over: { is_super_admin?: boolean; is_active?: boolean } = {}) {
  const username = uniq(role.toLowerCase().slice(0, 6));
  return prisma.user.create({ data: { name: username, username, password: "not-used", role, ...over } });
}

type U = { id: number; username: string; name: string; role: Role | string };

/**
 * Requests signed in as `u`. The cookie is minted directly rather than through /login,
 * whose rate limit would trip across a test run; `authenticate` still re-reads the user.
 */
export function as(u: U) {
  const cookie = `token=${jwt.sign({ id: u.id, username: u.username, name: u.name, role: u.role }, process.env.JWT_SECRET!)}`;
  const agent = request(app);
  return {
    get: (url: string) => agent.get(url).set("Cookie", cookie),
    post: (url: string) => agent.post(url).set("Cookie", cookie),
    put: (url: string) => agent.put(url).set("Cookie", cookie),
    patch: (url: string) => agent.patch(url).set("Cookie", cookie),
    delete: (url: string) => agent.delete(url).set("Cookie", cookie),
  };
}

/** An order raised by `csm` with one store holding one ₹1,000 item. */
export async function makeOrder(csm: U, opts: { installed?: boolean } = {}) {
  const order = await prisma.order.create({
    data: {
      order_no: uniq("T"),
      client_name: "Test client",
      creator_name: csm.name,
      created_by: csm.id,
      stores: { create: [{ s_no: 1, store_name: uniq("Store "), location: "Hyderabad", installed_at: opts.installed ? new Date() : null }] },
    },
    include: { stores: true },
  });
  const store = order.stores[0];
  await prisma.orderItem.create({
    data: {
      order_id: order.id,
      order_store_id: store.id,
      s_no: 1,
      media: "Flex",
      width_inches: 120,
      height_inches: 120,
      qty: 1,
      total_sft: 100,
      rate: 10,
      amount: 1000,
    },
  });
  return { order, store };
}

/** Only `keep` stays an active Cost Control Manager. */
export const onlyActiveCcm = (keep: { id: number } | null) =>
  prisma.user.updateMany({
    where: { role: "COST_CONTROL_MANAGER", ...(keep ? { id: { not: keep.id } } : {}) },
    data: { is_active: false },
  });
