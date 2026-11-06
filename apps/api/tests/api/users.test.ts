import { beforeAll, describe, expect, it } from "vitest";
import { as, makeUser, prisma, uniq } from "./helpers";

let superAdmin: Awaited<ReturnType<typeof makeUser>>;
let om: Awaited<ReturnType<typeof makeUser>>;
let csm: Awaited<ReturnType<typeof makeUser>>;

/** The smallest bytes detectFileType reads as a PNG. */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16, 1)]);

beforeAll(async () => {
  superAdmin = await makeUser("ADMIN", { is_super_admin: true });
  om = await makeUser("OPERATION_MANAGER");
  csm = await makeUser("CSM");
});

describe("creating an employee", () => {
  const base = () => ({ name: "New Person", username: uniq("newp"), password: "long-enough", role: "CSM" });

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
    expect((await as(om).post("/api/field-staff").send(field)).status).toBe(400);
    const res = await as(om).post("/api/field-staff").send({ ...field, phone: "9876543211", email: "f@example.com" });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe("f@example.com");
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
  it("uploads, serves and removes a picture", async () => {
    const up = await as(csm).post("/api/users/me/photo").set("Content-Type", "application/octet-stream").send(PNG);
    expect(up.status).toBe(200);
    expect(up.body.photo_url).toMatch(new RegExp(`^/users/${csm.id}/photo\\?v=`));

    const served = await as(om).get(`/api/users/${csm.id}/photo`);
    expect(served.status).toBe(200);
    expect(served.headers["content-type"]).toBe("image/png");

    const gone = await as(csm).delete("/api/users/me/photo");
    expect(gone.status).toBe(200);
    expect(gone.body.photo_url).toBeNull();
    expect((await as(om).get(`/api/users/${csm.id}/photo`)).status).toBe(404);
  });

  it("refuses anything that is not a picture", async () => {
    const res = await as(csm).post("/api/users/me/photo").set("Content-Type", "application/octet-stream").send(Buffer.from("%PDF-1.7 not a picture"));
    expect(res.status).toBe(415);
  });
});
