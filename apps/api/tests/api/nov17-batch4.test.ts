import { beforeAll, describe, expect, it } from "vitest";
import { addMasters, as, makeUser, prisma, uniq } from "./helpers";

let admin: Awaited<ReturnType<typeof makeUser>>;
let superAdmin: Awaited<ReturnType<typeof makeUser>>;
let pm: Awaited<ReturnType<typeof makeUser>>;
let csm: Awaited<ReturnType<typeof makeUser>>;
let opA: Awaited<ReturnType<typeof makeUser>>;
let opB: Awaited<ReturnType<typeof makeUser>>;
let opOther: Awaited<ReturnType<typeof makeUser>>;
let cnc: { id: number };
let uv: { id: number };
let media: string;

beforeAll(async () => {
  admin = await makeUser("ADMIN");
  superAdmin = await makeUser("ADMIN", { is_super_admin: true });
  pm = await makeUser("PRODUCTION_MANAGER");
  csm = await makeUser("CSM");
  opA = await makeUser("PRODUCTION");
  opB = await makeUser("PRODUCTION");
  opOther = await makeUser("PRODUCTION");
  cnc = await prisma.machine.findUniqueOrThrow({ where: { name: "CNC" } });
  uv = await prisma.machine.findUniqueOrThrow({ where: { name: "UV Machine" } });
  media = uniq("Cut Media ");
  await addMasters({ media: [media] });
  await prisma.media.update({ where: { name: media }, data: { default_machine_id: cnc.id } });
  await prisma.user.updateMany({ where: { id: { in: [opA.id, opB.id] } }, data: { machine_id: cnc.id } });
  await prisma.user.update({ where: { id: opOther.id }, data: { machine_id: uv.id } });
});

/** An open order with one line of the CNC line item, written straight to the table. */
async function cncLine() {
  const order = await prisma.order.create({
    data: {
      order_no: uniq("M"),
      client_name: "Test client",
      creator_name: csm.name,
      created_by: csm.id,
      stores: { create: [{ s_no: 1, store_name: uniq("Store "), location: "Hyderabad" }] },
    },
    include: { stores: true },
  });
  return prisma.orderItem.create({
    data: { order_id: order.id, order_store_id: order.stores[0]!.id, s_no: 1, media, width_inches: 12, height_inches: 12, qty: 1, total_sft: 1, rate: 10, amount: 10 },
  });
}

describe("machine queue", () => {
  it("a new line takes its line item's default machine", async () => {
    const line = await cncLine();
    expect(line.machine_id).toBe(cnc.id);
  });

  it("queues for every operator on the machine; the first to start takes it", async () => {
    const line = await cncLine();
    const qa = await as(opA).get("/api/production/machine-queue");
    const qb = await as(opB).get("/api/production/machine-queue");
    expect(qa.body.machine.name).toBe("CNC");
    expect(qa.body.lines.some((l: any) => l.id === line.id)).toBe(true);
    expect(qb.body.lines.some((l: any) => l.id === line.id)).toBe(true);
    const qo = await as(opOther).get("/api/production/machine-queue");
    expect(qo.body.lines.some((l: any) => l.id === line.id)).toBe(false);

    expect((await as(opOther).post(`/api/production/lines/${line.id}/start`)).status).toBe(403);
    const a = await as(opA).post(`/api/production/lines/${line.id}/start`);
    expect(a.status).toBe(200);
    expect(a.body.taken).toBe(true);
    expect((await as(opB).post(`/api/production/lines/${line.id}/start`)).status).toBe(409);
    const after = await as(opB).get("/api/production/machine-queue");
    expect(after.body.lines.some((l: any) => l.id === line.id)).toBe(false);
    const assigned = await prisma.orderItemAssignment.findMany({ where: { order_item_id: line.id } });
    expect(assigned.map((x) => x.user_id)).toEqual([opA.id]);
  });

  it("a rejected line goes to the PM, who moves it to another machine", async () => {
    const line = await cncLine();
    expect((await as(opA).post(`/api/production/lines/${line.id}/reject`).send({ reason: "x" })).status).toBe(400);
    expect((await as(opA).post(`/api/production/lines/${line.id}/reject`).send({ reason: "Needs UV print" })).status).toBe(200);
    const told = await prisma.notification.findFirst({ where: { user_id: pm.id, title: { contains: "Line rejected" } } });
    expect(told?.body).toContain("Needs UV print");
    expect((await as(opB).get("/api/production/machine-queue")).body.lines.some((l: any) => l.id === line.id)).toBe(false);

    const board = await as(pm).get("/api/production/board");
    const onBoard = board.body.lines.find((l: any) => l.id === line.id);
    expect(onBoard.returned_reason).toBe("Needs UV print");

    const moved = await as(pm).patch(`/api/production/lines/${line.id}/machine`).send({ machine_id: uv.id });
    expect(moved.status).toBe(200);
    expect(moved.body.line.returned_at).toBeNull();
    expect((await as(opOther).get("/api/production/machine-queue")).body.lines.some((l: any) => l.id === line.id)).toBe(true);
  });

  it("moving a running line takes it off its operator", async () => {
    const line = await cncLine();
    await as(opA).post(`/api/production/lines/${line.id}/start`);
    await as(pm).patch(`/api/production/lines/${line.id}/machine`).send({ machine_id: uv.id });
    expect(await prisma.orderItemAssignment.count({ where: { order_item_id: line.id } })).toBe(0);
    const fresh = await prisma.orderItem.findUniqueOrThrow({ where: { id: line.id } });
    expect(fresh.started_at).toBeNull();
  });
});

describe("machine master", () => {
  it("only the super admin adds or renames machines; the PM sets an operator's machine", async () => {
    const name = uniq("Laser ");
    expect((await as(admin).post("/api/machines").send({ name })).status).toBe(403);
    const made = await as(superAdmin).post("/api/machines").send({ name });
    expect(made.status).toBe(201);
    expect((await as(superAdmin).post("/api/machines").send({ name: name.toUpperCase() })).status).toBe(409);
    expect((await as(pm).put(`/api/machines/operators/${opOther.id}`).send({ machine_id: made.body.machine.id })).status).toBe(200);
    expect((await as(pm).put(`/api/machines/media/1`).send({ machine_id: null })).status).toBe(403);
    const list = await as(opA).get("/api/machines");
    expect(list.body.machines.find((m: any) => m.name === "CNC").operator_count).toBeGreaterThanOrEqual(2);
    await prisma.user.update({ where: { id: opOther.id }, data: { machine_id: uv.id } });
  });
});
