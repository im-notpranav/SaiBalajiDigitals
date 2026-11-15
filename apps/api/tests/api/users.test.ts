import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import app from "../../src/app";
import { as, makeOrder, makeUser, prisma, uniq } from "./helpers";

let superAdmin: Awaited<ReturnType<typeof makeUser>>;
let om: Awaited<ReturnType<typeof makeUser>>;
let csm: Awaited<ReturnType<typeof makeUser>>;

/** The smallest bytes detectFileType reads as a PNG. */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16, 1)]);

/** A CSM code no other test run has used. */
const freshCode = () => uniq("C").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20);

beforeAll(async () => {
  superAdmin = await makeUser("ADMIN", { is_super_admin: true });
  om = await makeUser("OPERATION_MANAGER");
  csm = await makeUser("CSM");
});

describe("creating an employee", () => {
  const base = () => ({ name: "New Person", username: uniq("newp"), password: "long-enough", role: "HELPER" });

  it("needs a mobile and an email", async () => {
    expect((await as(superAdmin).post("/api/users").send(base())).status).toBe(400);
    expect((await as(superAdmin).post("/api/users").send({ ...base(), phone: "9876543210" })).status).toBe(400);
    expect((await as(superAdmin).post("/api/users").send({ ...base(), email: "a@example.com" })).status).toBe(400);
  });

  it("stores them normalised", async () => {
    const res = await as(superAdmin).post("/api/users").send({ ...base(), phone: "98765 43210", email: "A@Example.com" });
    expect(res.status).toBe(201);
    expect(res.body.phone).toBe("+919876543210");
    expect(res.body.email).toBe("a@example.com");
  });

  it("applies to field staff too", async () => {
    const field = { name: "Field Person", username: uniq("field"), password: "long-enough", role: "PASTER" };
    expect((await as(superAdmin).post("/api/field-staff").send(field)).status).toBe(400);
    const res = await as(superAdmin).post("/api/field-staff").send({ ...field, phone: "9876543211", email: "f@example.com" });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe("f@example.com");
  });
});

describe("usernames in capitals", () => {
  const person = (username: string) => ({ name: "Caps Person", username, password: "long-enough", role: "HELPER", phone: "9876543213", email: "caps@example.com" });

  it("stores whatever case is typed in capitals, on both pages", async () => {
    const typed = ` ${uniq("sbd")} `;
    const res = await as(superAdmin).post("/api/users").send(person(typed));
    expect(res.status).toBe(201);
    expect(res.body.username).toBe(typed.trim().toUpperCase());

    const field = await as(superAdmin).post("/api/field-staff").send({ ...person(uniq("Fld")), role: "DRIVER" });
    expect(field.status).toBe(201);
    expect(field.body.username).toMatch(/^[A-Z0-9_]+$/);
  });

  it("treats a different case as the same name", async () => {
    const name = uniq("same");
    expect((await as(superAdmin).post("/api/users").send(person(name.toUpperCase()))).status).toBe(201);
    expect((await as(superAdmin).post("/api/users").send(person(name.toLowerCase()))).status).toBe(400);
    const check = await as(superAdmin).get(`/api/users/check?username=${name.toLowerCase()}`);
    expect(check.body.available).toBe(false);
  });

  it("refuses anything but letters, numbers and underscores", async () => {
    expect((await as(superAdmin).post("/api/users").send(person("has space"))).status).toBe(400);
    expect((await as(superAdmin).post("/api/users").send(person("dash-ed"))).status).toBe(400);
  });

  it("signs in whatever case is typed", async () => {
    const user = await makeUser("CSM");
    await prisma.user.update({ where: { id: user.id }, data: { password: await bcrypt.hash("right-password", 4) } });
    const res = await request(app).post("/api/auth/login").send({ username: ` ${user.username.toLowerCase()} `, password: "right-password" });
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe(user.username);
  });
});

describe("CSM codes on a new CSM", () => {
  const newCsm = (csm_code?: string) => ({
    name: "Code Person", username: uniq("csm"), password: "long-enough", role: "CSM", phone: "9876543214", email: "code@example.com",
    ...(csm_code !== undefined ? { csm_code } : {}),
  });

  it("is required for a CSM", async () => {
    expect((await as(superAdmin).post("/api/users").send(newCsm())).status).toBe(400);
  });

  it("creates the code, or takes over one nobody holds", async () => {
    const code = freshCode();
    const res = await as(superAdmin).post("/api/users").send(newCsm(code.toLowerCase()));
    expect(res.status).toBe(201);
    const row = await prisma.csmCode.findUniqueOrThrow({ where: { code } });
    expect(row.user_id).toBe(res.body.id);
    expect(row.kind).toBe("CSM");

    const spare = freshCode();
    await prisma.csmCode.create({ data: { code: spare, kind: "UNKNOWN", is_active: false } });
    const taker = await as(superAdmin).post("/api/users").send(newCsm(spare));
    expect(taker.status).toBe(201);
    const taken = await prisma.csmCode.findUniqueOrThrow({ where: { code: spare } });
    expect(taken).toMatchObject({ user_id: taker.body.id, kind: "CSM", is_active: true });
  });

  it("refuses a code another CSM holds, and makes no account", async () => {
    const code = freshCode();
    await prisma.csmCode.create({ data: { code, kind: "CSM", user_id: csm.id } });
    const body = newCsm(code);
    const res = await as(superAdmin).post("/api/users").send(body);
    expect(res.status).toBe(409);
    expect(res.body.message).toContain(`CSM code ${code} already belongs to`);
    expect(await prisma.user.findUnique({ where: { username: body.username.toUpperCase() } })).toBeNull();
  });
});

describe("a user's own profile", () => {
  it("refuses changes to email and mobile, and leaves them as they were", async () => {
    await prisma.user.update({ where: { id: csm.id }, data: { phone: "+919000000000", email: "keep@example.com" } });
    expect((await as(csm).put("/api/users/me").send({ email: "new@example.com" })).status).toBe(400);
    expect((await as(csm).put("/api/users/me").send({ phone: "9876543212" })).status).toBe(400);
    expect((await as(csm).put("/api/users/me").send({ username: "changed" })).status).toBe(400);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: csm.id } });
    expect(row.email).toBe("keep@example.com");
    expect(row.phone).toBe("+919000000000");
  });

  it("still lets them change their name", async () => {
    const res = await as(csm).put("/api/users/me").send({ name: "Renamed" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Renamed");
  });
});

describe("profile pictures", () => {
  it("are set and removed by the super admin, and served to anyone signed in", async () => {
    const up = await as(superAdmin).post(`/api/users/${csm.id}/photo`).set("Content-Type", "application/octet-stream").send(PNG);
    expect(up.status).toBe(200);
    expect(up.body.photo_url).toMatch(new RegExp(`^/users/${csm.id}/photo\\?v=`));

    const served = await as(om).get(`/api/users/${csm.id}/photo`);
    expect(served.status).toBe(200);
    expect(served.headers["content-type"]).toBe("image/png");

    const gone = await as(superAdmin).delete(`/api/users/${csm.id}/photo`);
    expect(gone.status).toBe(200);
    expect(gone.body.photo_url).toBeNull();
    expect((await as(om).get(`/api/users/${csm.id}/photo`)).status).toBe(404);
  });

  it("are no longer uploaded by the person themself", async () => {
    const res = await as(csm).post("/api/users/me/photo").set("Content-Type", "application/octet-stream").send(PNG);
    expect(res.status).not.toBe(200);
  });

  it("for field staff are set by the super admin too, not the Operation Manager", async () => {
    const paster = await makeUser("PASTER");
    const up = await as(superAdmin).post(`/api/field-staff/${paster.id}/photo`).set("Content-Type", "application/octet-stream").send(PNG);
    expect(up.status).toBe(200);
    expect((await as(superAdmin).delete(`/api/field-staff/${paster.id}/photo`)).status).toBe(200);
    expect((await as(om).post(`/api/field-staff/${paster.id}/photo`).set("Content-Type", "application/octet-stream").send(PNG)).status).toBe(403);
    // The field staff route is for field staff only; office accounts go through /api/users.
    expect((await as(superAdmin).post(`/api/field-staff/${csm.id}/photo`).set("Content-Type", "application/octet-stream").send(PNG)).status).toBe(403);
  });

  it("refuses anything that is not a picture", async () => {
    const res = await as(superAdmin).post(`/api/users/${csm.id}/photo`).set("Content-Type", "application/octet-stream").send(Buffer.from("%PDF-1.7 not a picture"));
    expect(res.status).toBe(415);
  });
});

describe("deleting permanently", () => {
  it("keeps the row for history, wipes the login and contact details, and retires the codes", async () => {
    const person = await makeUser("CSM");
    await prisma.user.update({ where: { id: person.id }, data: { name: "Ravi", phone: "+919876500000", email: "ravi@example.com" } });
    const code = freshCode();
    await prisma.csmCode.create({ data: { code, kind: "CSM", user_id: person.id } });
    const { order } = await makeOrder({ ...person, name: "Ravi" });

    const res = await as(superAdmin).delete(`/api/users/${person.id}`);
    expect(res.status).toBe(200);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: person.id } });
    expect(row).toMatchObject({
      name: "Deleted user (Ravi)", username: `DELETED_${person.id}`, phone: null, email: null, photo_url: null, emp_code: null,
      is_active: false, whatsapp_opt_out: true,
    });
    expect(row.deleted_at).not.toBeNull();
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).created_by).toBe(person.id);
    // The code stays with the deleted CSM (so his old jobs don't move to whoever takes it next),
    // switched off so it leaves the pick-lists.
    expect(await prisma.csmCode.findUniqueOrThrow({ where: { code } })).toMatchObject({ user_id: person.id, is_active: false });

    const list = await as(superAdmin).get("/api/users");
    expect(list.body.users.some((u: { id: number }) => u.id === person.id)).toBe(false);
    // Their old session is refused.
    expect((await as(person).get("/api/auth/me")).status).toBe(401);
  });

  it("waits while they still have open work", async () => {
    const paster = await makeUser("PASTER");
    const day = new Date("2026-12-01");
    await prisma.leaveRecord.create({ data: { user_id: paster.id, from_date: day, to_date: day, status: "PENDING" } });
    const res = await as(superAdmin).delete(`/api/field-staff/${paster.id}`);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/1 pending leave request/);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: paster.id } })).deleted_at).toBeNull();
  });

  it("is the super admin's for office accounts", async () => {
    const admin = await makeUser("ADMIN");
    const target = await makeUser("CSM");
    expect((await as(admin).delete(`/api/users/${target.id}`)).status).toBe(403);
    expect((await as(superAdmin).delete(`/api/users/${superAdmin.id}`)).status).toBe(400);
  });
});

describe("the super admin changes anything after creating an account", () => {
  const contact = { phone: "9876543215", email: "edit@example.com" };
  const edit = (u: { id: number; username: string; name: string }, over: Record<string, unknown>) =>
    as(superAdmin).put(`/api/users/${u.id}`).send({ name: u.name, username: u.username, role: "CSM", ...contact, ...over });

  it("sets and clears the employee code", async () => {
    const person = await makeUser("CSM");
    const code = uniq("E").toUpperCase().slice(0, 20);
    const set = await edit(person, { emp_code: code });
    expect(set.status).toBe(200);
    expect(set.body.emp_code).toBe(code);
    const cleared = await edit(person, { emp_code: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.emp_code).toBeNull();
  });

  it("removes a CSM code when the box is emptied, freeing it for someone else", async () => {
    const person = await makeUser("CSM");
    const code = freshCode();
    await prisma.csmCode.create({ data: { code, kind: "CSM", user_id: person.id } });
    const res = await edit(person, { csm_code: null, replace_csm_code: code.toLowerCase() });
    expect(res.status).toBe(200);
    // No job uses it, so it is simply let go.
    expect((await prisma.csmCode.findUniqueOrThrow({ where: { code } })).user_id).toBeNull();
  });

  it("swaps a CSM code for a new one", async () => {
    const person = await makeUser("CSM");
    const old = freshCode();
    const next = freshCode();
    await prisma.csmCode.create({ data: { code: old, kind: "CSM", user_id: person.id } });
    expect((await edit(person, { csm_code: next, replace_csm_code: old })).status).toBe(200);
    expect((await prisma.csmCode.findUniqueOrThrow({ where: { code: next } })).user_id).toBe(person.id);
    expect((await prisma.csmCode.findUniqueOrThrow({ where: { code: old } })).user_id).toBeNull();
  });

  it("edits his own account, but not his own role", async () => {
    const me = await prisma.user.findUniqueOrThrow({ where: { id: superAdmin.id } });
    const own = (over: Record<string, unknown>) =>
      as(superAdmin).put(`/api/users/${me.id}`).send({ name: me.name, username: me.username, role: "ADMIN", ...contact, ...over });
    expect((await own({ name: "Super Renamed" })).status).toBe(200);
    const res = await own({ role: "OPERATION_MANAGER" });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("You can't change your own role.");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: me.id } })).role).toBe("ADMIN");
  });

  it("corrects a field staff username, in capitals", async () => {
    const paster = await makeUser("PASTER");
    const fresh = uniq("fix");
    const res = await as(superAdmin).patch(`/api/field-staff/${paster.id}`).send({ username: fresh, ...contact });
    expect(res.status).toBe(200);
    expect(res.body.username).toBe(fresh.toUpperCase());
    // Someone else's name, in any case, is refused.
    const taken = await as(superAdmin).patch(`/api/field-staff/${paster.id}`).send({ username: csm.username.toLowerCase(), ...contact });
    expect(taken.status).toBe(400);
  });
});

describe("field staff for the Operation Manager and other admins", () => {
  it("is a list they can read but not change", async () => {
    const admin = await makeUser("ADMIN");
    const paster = await makeUser("PASTER");
    const body = { name: "Nope", username: uniq("nope"), password: "long-enough", role: "PASTER", phone: "9876543216", email: "n@example.com" };
    for (const who of [om, admin]) {
      expect((await as(who).get("/api/field-staff")).status).toBe(200);
      expect((await as(who).post("/api/field-staff").send(body)).status).toBe(403);
      expect((await as(who).patch(`/api/field-staff/${paster.id}`).send({ name: "Changed", phone: "9876543216", email: "n@example.com" })).status).toBe(403);
      expect((await as(who).put(`/api/field-staff/${paster.id}/status`).send({ is_active: false })).status).toBe(403);
      expect((await as(who).put(`/api/field-staff/${paster.id}/password`).send({ new_password: "long-enough" })).status).toBe(403);
      expect((await as(who).delete(`/api/field-staff/${paster.id}`)).status).toBe(403);
    }
    expect(await prisma.user.findUniqueOrThrow({ where: { id: paster.id } })).toMatchObject({ name: paster.name, is_active: true, deleted_at: null });
  });
});
