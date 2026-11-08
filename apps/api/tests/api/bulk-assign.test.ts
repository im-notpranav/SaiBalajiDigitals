import { beforeAll, describe, expect, it } from "vitest";
import { as, makeOrder, makeUser, prisma, uniq } from "./helpers";

let csm: Awaited<ReturnType<typeof makeUser>>;
let manager: Awaited<ReturnType<typeof makeUser>>;
let teamA: Awaited<ReturnType<typeof makeUser>>;
let teamB: Awaited<ReturnType<typeof makeUser>>;

beforeAll(async () => {
  csm = await makeUser("CSM");
  manager = await makeUser("PRODUCTION_MANAGER");
  teamA = await makeUser("PRODUCTION");
  teamB = await makeUser("PRODUCTION");
});

/** An order with `n` items, all of the given media. */
async function orderWithItems(n: number, media = "Flex") {
  const { order, store } = await makeOrder(csm);
  await prisma.orderItem.updateMany({ where: { order_id: order.id }, data: { media } });
  for (let i = 2; i <= n; i++) {
    await prisma.orderItem.create({
      data: {
        order_id: order.id, order_store_id: store.id, s_no: i, media,
        width_inches: 12, height_inches: 12, qty: 1, total_sft: 1, rate: 10, amount: 10,
      },
    });
  }
  const items = await prisma.orderItem.findMany({ where: { order_id: order.id }, orderBy: { s_no: "asc" } });
  return { order, items };
}

const teamsOn = async (itemId: number) =>
  (await prisma.orderItemAssignment.findMany({ where: { order_item_id: itemId } })).map((a) => a.user_id).sort();

describe("PATCH /api/orders/:orderId/items/assign", () => {
  it("adds teams to every selected item in one save and keeps who was already there", async () => {
    const { order, items } = await orderWithItems(3);
    await prisma.orderItemAssignment.create({ data: { order_item_id: items[0]!.id, user_id: teamA.id } });

    const res = await as(manager)
      .patch(`/api/orders/${order.id}/items/assign`)
      .send({ mode: "add", assignments: items.map((i) => ({ item_id: i.id, user_ids: [teamB.id] })) });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ updated: 3, skipped: 0 });
    expect(await teamsOn(items[0]!.id)).toEqual([teamA.id, teamB.id].sort());
    expect(await teamsOn(items[1]!.id)).toEqual([teamB.id]);
    expect(await teamsOn(items[2]!.id)).toEqual([teamB.id]);
  });

  it("replace leaves exactly the chosen teams and never touches a finished item", async () => {
    const { order, items } = await orderWithItems(2);
    await prisma.orderItemAssignment.create({ data: { order_item_id: items[0]!.id, user_id: teamA.id } });
    await prisma.orderItemAssignment.create({
      data: { order_item_id: items[1]!.id, user_id: teamA.id, completed: true, completed_at: new Date() },
    });
    await prisma.orderItem.update({ where: { id: items[1]!.id }, data: { production_completed: true } });

    const res = await as(manager)
      .patch(`/api/orders/${order.id}/items/assign`)
      .send({ mode: "replace", assignments: items.map((i) => ({ item_id: i.id, user_ids: [teamB.id] })) });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ updated: 1, skipped: 1 });
    expect(await teamsOn(items[0]!.id)).toEqual([teamB.id]);
    expect(await teamsOn(items[1]!.id)).toEqual([teamA.id]);
  });

  it("tells each team once, however many items it was given", async () => {
    const { order, items } = await orderWithItems(4);
    const res = await as(manager)
      .patch(`/api/orders/${order.id}/items/assign`)
      .send({ mode: "add", assignments: items.map((i) => ({ item_id: i.id, user_ids: [teamA.id] })) });
    expect(res.status).toBe(200);

    const notes = await prisma.notification.findMany({ where: { user_id: teamA.id, order_id: order.id } });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.title).toBe(`4 items assigned on ${order.order_no}`);
  });

  it("refuses an item from another order, a non-production user, and other roles", async () => {
    const { order, items } = await orderWithItems(1);
    const other = await orderWithItems(1);

    const foreign = await as(manager)
      .patch(`/api/orders/${order.id}/items/assign`)
      .send({ mode: "add", assignments: [{ item_id: other.items[0]!.id, user_ids: [teamA.id] }] });
    expect(foreign.status).toBe(404);

    const notStaff = await as(manager)
      .patch(`/api/orders/${order.id}/items/assign`)
      .send({ mode: "add", assignments: [{ item_id: items[0]!.id, user_ids: [csm.id] }] });
    expect(notStaff.status).toBe(400);

    const wrongRole = await as(csm)
      .patch(`/api/orders/${order.id}/items/assign`)
      .send({ mode: "add", assignments: [{ item_id: items[0]!.id, user_ids: [teamA.id] }] });
    expect(wrongRole.status).toBe(403);

    expect(await teamsOn(items[0]!.id)).toEqual([]);
  });
});

describe("GET /api/orders/:orderId/assign-suggestions", () => {
  it("suggests the teams a media was most often given, only for unassigned items", async () => {
    const media = uniq("Vinyl ");
    // History: two items of this media went to team A, one to team B.
    const past = await orderWithItems(3, media);
    await prisma.orderItemAssignment.create({ data: { order_item_id: past.items[0]!.id, user_id: teamA.id } });
    await prisma.orderItemAssignment.create({ data: { order_item_id: past.items[1]!.id, user_id: teamA.id } });
    await prisma.orderItemAssignment.create({ data: { order_item_id: past.items[2]!.id, user_id: teamB.id } });

    // Same media typed differently, plus one item already assigned.
    const { order, items } = await orderWithItems(2, `  ${media.toUpperCase()} `);
    await prisma.orderItemAssignment.create({ data: { order_item_id: items[1]!.id, user_id: teamB.id } });

    const res = await as(manager).get(`/api/orders/${order.id}/assign-suggestions`);
    expect(res.status).toBe(200);
    expect(res.body.suggestions).toEqual([{ item_id: items[0]!.id, user_ids: [teamA.id], based_on: 2 }]);
  });

  it("suggests nothing for a media nobody has worked on", async () => {
    const { order } = await orderWithItems(2, uniq("Never seen "));
    const res = await as(manager).get(`/api/orders/${order.id}/assign-suggestions`);
    expect(res.status).toBe(200);
    expect(res.body.suggestions).toEqual([]);
  });
});
