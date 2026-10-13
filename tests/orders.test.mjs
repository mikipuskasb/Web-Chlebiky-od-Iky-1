import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createApp } from "../server.mjs";

const adminToken = "test-only-administrator-key";
const password = "member-test-password";
const standardOffer = {
  title: "Stredajšie pečenie",
  date: "2026-10-14",
  items: [
    {
      name: "Kváskový chlieb",
      description: "Pšenično-ražný. Obsahuje lepok.",
      price: 550,
      stock: 3,
    },
    { name: "Rožok", description: "Domáce pečivo.", price: 80, stock: 10 },
  ],
};
async function fixture(t) {
  const dataDir = mkdtempSync(join(tmpdir(), "iky-test-"));
  let server = createApp({ dataDir, adminToken });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  let base = "http://127.0.0.1:" + server.address().port;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dataDir, { recursive: true, force: true });
  });
  const request = async (
    path,
    { method = "GET", body, cookie, admin = false, headers = {} } = {},
  ) => {
    const response = await fetch(base + "/api" + path, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(admin ? { Authorization: "Bearer " + adminToken } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: response.status,
      data: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  };
  const dashboard = async () =>
    (await request("/admin/dashboard", { admin: true })).data.offers;
  const offer = async (body = standardOffer) => {
    const created = await request("/admin/offers", {
      method: "POST",
      admin: true,
      body,
    });
    assert.equal(created.status, 201);
    return (await dashboard()).find((o) => o.id === created.data.id);
  };
  const publish = async (o) => {
    const result = await request(`/admin/offers/${o.id}/publish`, {
      method: "POST",
      admin: true,
      body: {},
    });
    assert.equal(result.status, 200);
    return o;
  };
  const member = async (o, name = "Anna", phone = "+421900123456") => {
    const result = await request("/register", {
      method: "POST",
      body: { name, phone, password, offerSlug: o.slug, consent: true },
    });
    assert.equal(result.status, 201);
    return result;
  };
  const order = (o, m, items, extras = {}) =>
    request(`/offers/${o.slug}/order`, {
      method: "PUT",
      cookie: m.cookie,
      body: { items, ...extras },
    });
  const restart = async () => {
    await new Promise((resolve) => server.close(resolve));
    server = createApp({ dataDir, adminToken });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    base = "http://127.0.0.1:" + server.address().port;
  };
  return { request, dashboard, offer, publish, member, order, restart };
}

test("Ika creates a private draft, edits it, publishes one shareable offer", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request("/admin/dashboard")).status, 401);
  assert.equal((await f.request("/offers/current")).data.available, false);
  const o = await f.offer();
  assert.match(o.slug, /^[a-f0-9]{32}$/);
  assert.equal((await f.request("/offers/" + o.slug)).status, 404);
  const edited = await f.request("/admin/offers/" + o.id, {
    method: "PUT",
    admin: true,
    body: { ...standardOffer, title: "Ponuka od Iky" },
  });
  assert.equal(edited.status, 200);
  await f.publish(o);
  const visible = await f.request("/offers/" + o.slug);
  assert.equal(visible.data.offer.title, "Ponuka od Iky");
  assert.equal(visible.data.offer.items[0].available, 3);
  assert.equal((await f.request("/offers/current")).data.available, true);
  assert.equal(
    (
      await f.request("/admin/offers/" + o.id, {
        method: "PUT",
        admin: true,
        body: standardOffer,
      })
    ).status,
    409,
  );
});

test("registration requires an invitation, strong password, consent and unique normalized phone", async (t) => {
  const f = await fixture(t);
  const o = await f.publish(await f.offer());
  const body = {
    name: "Anna Nováková",
    phone: "0900 123 456",
    password,
    offerSlug: o.slug,
    consent: true,
  };
  assert.equal(
    (
      await f.request("/register", {
        method: "POST",
        body: { ...body, offerSlug: "0".repeat(32) },
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await f.request("/register", {
        method: "POST",
        body: { ...body, password: "short" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.request("/register", {
        method: "POST",
        body: { ...body, consent: false },
      })
    ).status,
    400,
  );
  const m = await f.request("/register", { method: "POST", body });
  assert.equal(m.status, 201);
  assert.equal(m.data.member.phone, "+421900123456");
  assert.equal(
    (
      await f.request("/register", {
        method: "POST",
        body: { ...body, phone: "+421900123456" },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await f.request("/login", {
        method: "POST",
        body: { phone: body.phone, password: "wrong-password" },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await f.request("/login", {
        method: "POST",
        body: { phone: body.phone, password },
      })
    ).status,
    200,
  );
  assert.equal(
    (await f.request("/session", { cookie: m.cookie })).data.member.name,
    "Anna Nováková",
  );
});

test("members can modify only their own order; totals and cancellation are accurate", async (t) => {
  const f = await fixture(t);
  const o = await f.publish(await f.offer());
  const a = await f.member(o);
  const b = await f.member(o, "Boris", "+421900123457");
  const [bread, roll] = o.items;
  assert.equal(
    (
      await f.order(o, a, [
        { id: bread.id, quantity: 2 },
        { id: roll.id, quantity: 3 },
      ])
    ).status,
    200,
  );
  const attempted = await f.order(o, b, [{ id: roll.id, quantity: 1 }], {
    memberId: a.data.member.id,
  });
  assert.equal(attempted.status, 200);
  const own = (await f.request("/offers/" + o.slug, { cookie: b.cookie })).data
    .offer;
  assert.deepEqual(own.ownItems, [{ id: roll.id, quantity: 1 }]);
  assert.equal(
    (await f.request("/offers/" + o.slug)).data.offer.ownItems.length,
    0,
  );
  let report = (await f.dashboard())[0];
  assert.equal(report.orders.length, 2);
  assert.equal(report.items[0].sold, 2);
  assert.equal(report.items[1].sold, 4);
  assert.equal(
    (await f.order(o, a, [{ id: bread.id, quantity: 1 }])).status,
    200,
  );
  report = (await f.dashboard())[0];
  assert.equal(report.items[0].available, 2);
  assert.equal(report.items[1].available, 9);
  assert.equal((await f.order(o, a, [])).status, 200);
  report = (await f.dashboard())[0];
  assert.equal(report.orders.length, 1);
  assert.equal(report.orders[0].name, "Boris");
  assert.equal(report.items[0].available, 3);
});

test("concurrent requests for the final stock cannot oversell", async (t) => {
  const f = await fixture(t);
  const o = await f.publish(
    await f.offer({
      ...standardOffer,
      items: [{ ...standardOffer.items[0], stock: 1 }],
    }),
  );
  const a = await f.member(o);
  const b = await f.member(o, "Boris", "+421900123457");
  const results = await Promise.all([
    f.order(o, a, [{ id: o.items[0].id, quantity: 1 }]),
    f.order(o, b, [{ id: o.items[0].id, quantity: 1 }]),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const report = (await f.dashboard())[0];
  assert.equal(report.items[0].sold, 1);
  assert.equal(report.items[0].available, 0);
  assert.equal(report.orders.length, 1);
});

test("invalid or stale order rolls back without losing the previous reservation", async (t) => {
  const f = await fixture(t);
  const o = await f.publish(await f.offer());
  const a = await f.member(o);
  const b = await f.member(o, "Boris", "+421900123457");
  const p = o.items[0];
  await f.order(o, a, [{ id: p.id, quantity: 2 }]);
  await f.order(o, b, [{ id: p.id, quantity: 1 }]);
  assert.equal((await f.order(o, a, [{ id: p.id, quantity: 3 }])).status, 409);
  for (const items of [
    [{ id: p.id, quantity: -1 }],
    [{ id: p.id, quantity: 1.5 }],
    [
      { id: p.id, quantity: 1 },
      { id: p.id, quantity: 1 },
    ],
    [{ id: 99999, quantity: 1 }],
  ])
    assert.equal((await f.order(o, a, items)).status, 400);
  const current = (await f.request("/offers/" + o.slug, { cookie: a.cookie }))
    .data.offer;
  assert.equal(current.ownItems[0].quantity, 2);
  assert.equal(current.items[0].sold, 3);
});

test("a new week closes the previous week while preserving orders and member accounts", async (t) => {
  const f = await fixture(t);
  const previous = await f.publish(await f.offer());
  const a = await f.member(previous);
  await f.order(previous, a, [{ id: previous.items[0].id, quantity: 2 }]);
  const next = await f.offer({
    ...standardOffer,
    title: "Ďalší týždeň",
    date: "2026-10-21",
  });
  await f.publish(next);
  assert.notEqual(previous.slug, next.slug);
  assert.equal((await f.order(previous, a, [])).status, 409);
  assert.equal(
    (await f.request("/offers/" + previous.slug, { cookie: a.cookie })).data
      .offer.ownItems[0].quantity,
    2,
  );
  assert.equal(
    (await f.order(next, a, [{ id: next.items[0].id, quantity: 1 }])).status,
    200,
  );
  const reports = await f.dashboard();
  assert.equal(reports.find((o) => o.id === previous.id).status, "closed");
  assert.equal(reports.find((o) => o.id === previous.id).items[0].sold, 2);
  assert.equal(reports.find((o) => o.id === next.id).items[0].sold, 1);
  assert.equal(
    (
      await f.request(`/admin/offers/${next.id}/close`, {
        method: "POST",
        body: {},
        admin: true,
      })
    ).status,
    200,
  );
  assert.equal((await f.order(next, a, [])).status, 409);
});

test("orders and sessions survive a server restart; password reset revokes sessions", async (t) => {
  const f = await fixture(t);
  const o = await f.publish(await f.offer());
  const a = await f.member(o);
  await f.order(o, a, [{ id: o.items[0].id, quantity: 2 }]);
  await f.restart();
  assert.equal((await f.dashboard())[0].items[0].sold, 2);
  assert.equal(
    (await f.request("/session", { cookie: a.cookie })).data.member.name,
    "Anna",
  );
  const reset = await f.request(`/admin/members/${a.data.member.id}/password`, {
    method: "POST",
    admin: true,
    body: { password: "new-test-password" },
  });
  assert.equal(reset.status, 200);
  assert.equal(
    (await f.request("/session", { cookie: a.cookie })).data.member,
    null,
  );
  assert.equal(
    (
      await f.request("/login", {
        method: "POST",
        body: { phone: a.data.member.phone, password },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await f.request("/login", {
        method: "POST",
        body: { phone: a.data.member.phone, password: "new-test-password" },
      })
    ).status,
    200,
  );
  assert.equal((await f.dashboard())[0].orders[0].name, "Anna");
});

test("API rejects cross-origin mutations, malformed data and unauthenticated orders", async (t) => {
  const f = await fixture(t);
  const o = await f.publish(await f.offer());
  assert.equal(
    (
      await f.request("/admin/offers", {
        method: "POST",
        admin: true,
        body: standardOffer,
        headers: { Origin: "https://other.example" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await f.request("/login", { method: "POST", body: null })).status,
    400,
  );
  assert.equal(
    (
      await f.request("/admin/offers", {
        method: "POST",
        admin: true,
        body: { ...standardOffer, date: "2026-02-30" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.request(`/offers/${o.slug}/order`, {
        method: "PUT",
        body: { items: [] },
      })
    ).status,
    401,
  );
  assert.equal((await f.request("/health")).data.ok, true);
});
