import { test, expect } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createApp } from "../../server.mjs";

const key = "browser-test-admin-key-only";
let server, base, dataDir;
test.beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "iky-browser-"));
  server = createApp({ dataDir, adminToken: key });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = "http://127.0.0.1:" + server.address().port;
});
test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(dataDir, { recursive: true, force: true });
});

test("Ika publishes, members order their own stock, and both reports match", async ({
  page,
  browser,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await expect(
    page.getByRole("heading", { name: "Chlebík, na ktorý sa tešíte." }),
  ).toBeVisible();
  await page.screenshot({
    path: "/tmp/chlebiky-home-desktop.png",
    fullPage: true,
  });
  await page.goto(base + "/admin");
  await page.getByLabel("Váš prístupový kľúč").fill(key);
  await page.getByRole("button", { name: "Otvoriť správu" }).click();
  await expect(
    page.getByRole("heading", { name: "Prvá ponuka začína tu." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Vytvoriť prvú ponuku" }).click();
  const editor = page.getByRole("dialog");
  await editor
    .getByLabel("Názov ponuky", { exact: true })
    .fill("Ponuka na stredu");
  await editor.getByLabel("Dátum odberu").fill("2026-10-14");
  await editor.getByLabel("Názov", { exact: true }).fill("Kváskový chlieb");
  await editor
    .getByLabel("Popis, zloženie a alergény")
    .fill("Pšenično-ražný chlebík. Obsahuje lepok.");
  await editor.getByLabel("Cena za kus (€)").fill("5.50");
  await editor.getByLabel("Počet kusov v ponuke").fill("3");
  await editor
    .getByRole("button", { name: "Pridať chlieb alebo pečivo" })
    .click();
  const second = editor.locator("fieldset").nth(1);
  await second.getByLabel("Názov", { exact: true }).fill("Maslový rožok");
  await second.getByLabel("Cena za kus (€)").fill("0.80");
  await second.getByLabel("Počet kusov v ponuke").fill("10");
  await editor
    .getByRole("button", { name: "Uložiť rozpracovanú ponuku" })
    .click();
  await expect(page.getByText("Rozpracovaná", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Zverejniť a získať odkaz" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Zverejniť ponuku", exact: true })
    .click();
  await expect(page.getByLabel("Odkaz na ponuku")).toBeVisible();
  const link = await page.getByLabel("Odkaz na ponuku").inputValue();
  expect(link).toMatch(/\/ponuka\/[a-f0-9]{32}$/);
  await page.getByRole("button", { name: "Správa do WhatsApp" }).click();
  await expect(
    page.getByRole("dialog").getByLabel("Správa", { exact: true }),
  ).toHaveValue(new RegExp(link));
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Zavrieť" })
    .click();
  await page.goto(link);
  await page
    .getByRole("button", { name: "Pridať kus: Kváskový chlieb" })
    .click();
  await page
    .getByRole("button", { name: "Pridať kus: Kváskový chlieb" })
    .click();
  await page.getByRole("button", { name: "Pridať kus: Maslový rožok" }).click();
  await page.getByRole("button", { name: "Prihlásiť a objednať" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Nový účet" })
    .click();
  const auth = page.getByRole("dialog");
  await auth.getByLabel("Vaše meno a priezvisko").fill("Anna Nováková");
  await auth.getByLabel("Telefónne číslo").fill("0900123456");
  await auth.getByLabel("Heslo", { exact: true }).fill("Test-password-123");
  await auth.getByRole("checkbox").check();
  await auth.getByRole("button", { name: "Vytvoriť môj účet" }).click();
  await expect(page.getByText("Anna Nováková", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Uložiť moju objednávku" }).click();
  await expect(
    page.getByText("Vaša objednávka je uložená.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Počet kusov: Kváskový chlieb")).toHaveValue(
    "2",
  );
  await page.reload();
  await expect(page.getByLabel("Počet kusov: Kváskový chlieb")).toHaveValue(
    "2",
  );
  await page.screenshot({
    path: "/tmp/chlebiky-offer-desktop.png",
    fullPage: true,
  });
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const mobilePage = await mobile.newPage();
  await mobilePage.goto(link);
  await mobilePage
    .getByRole("button", { name: "Pridať kus: Kváskový chlieb" })
    .click();
  await mobilePage
    .getByRole("button", { name: "Prihlásiť a objednať" })
    .click();
  await mobilePage
    .getByRole("dialog")
    .getByRole("button", { name: "Nový účet" })
    .click();
  const mobileAuth = mobilePage.getByRole("dialog");
  await mobileAuth.getByLabel("Vaše meno a priezvisko").fill("Boris Horváth");
  await mobileAuth.getByLabel("Telefónne číslo").fill("+421900123457");
  await mobileAuth
    .getByLabel("Heslo", { exact: true })
    .fill("Test-password-456");
  await mobileAuth.getByRole("checkbox").check();
  await mobileAuth.getByRole("button", { name: "Vytvoriť môj účet" }).click();
  await mobilePage
    .getByRole("button", { name: "Uložiť moju objednávku" })
    .click();
  await expect(
    mobilePage.getByText("Vaša objednávka je uložená.", { exact: true }),
  ).toBeVisible();
  expect(
    await mobilePage.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await mobilePage.screenshot({
    path: "/tmp/chlebiky-offer-mobile.png",
    fullPage: true,
  });
  await mobile.close();
  await page.goto(base + "/admin");
  await page.getByLabel("Váš prístupový kľúč").fill(key);
  await page.getByRole("button", { name: "Otvoriť správu" }).click();
  const reports = page.getByRole("table");
  await expect(
    reports.nth(1).getByRole("row", { name: /Anna Nováková/ }),
  ).toContainText("11,80");
  await expect(
    reports.nth(1).getByRole("row", { name: /Boris Horváth/ }),
  ).toContainText("5,50");
  const bread = reports.nth(0).getByRole("row", { name: /Kváskový chlieb/ });
  await expect(bread.getByRole("cell").nth(2)).toHaveText("3 ks");
  await expect(bread.getByRole("cell").nth(3)).toHaveText("0 ks");
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#export-orders").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("objednavky-2026-10-14.csv");
  await page.screenshot({
    path: "/tmp/chlebiky-admin-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/chlebiky-admin-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Použiť na ďalší týždeň" }).click();
  await page.getByRole("dialog").getByLabel("Dátum odberu").fill("2026-10-21");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Uložiť rozpracovanú ponuku" })
    .click();
  await page.getByRole("button", { name: "Zverejniť a získať odkaz" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Zverejniť ponuku", exact: true })
    .click();
  const newLink = await page.getByLabel("Odkaz na ponuku").inputValue();
  expect(newLink).not.toBe(link);
  await page.goto(link);
  await expect(page.getByText("Uzavretá", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Uložiť zmeny objednávky" }),
  ).toBeDisabled();
  expect(errors).toEqual([]);
});

test("untrusted offer text is displayed as text and guests cannot see customers", async ({
  page,
  request,
}) => {
  const auth = { Authorization: "Bearer " + key };
  const response = await request.post(base + "/api/admin/offers", {
    headers: auth,
    data: {
      title: "<img src=x onerror=alert(1)>",
      date: "2026-10-28",
      items: [
        {
          name: "<script>alert(1)</script>",
          description: "<img src=x onerror=alert(2)>",
          price: 550,
          stock: 2,
        },
      ],
    },
  });
  expect(response.status()).toBe(201);
  const { id } = await response.json();
  await request.post(base + `/api/admin/offers/${id}/publish`, {
    headers: auth,
    data: {},
  });
  const dashboard = await (
    await request.get(base + "/api/admin/dashboard", { headers: auth })
  ).json();
  const offer = dashboard.offers.find((o) => o.id === id);
  await page.goto(base + "/ponuka/" + offer.slug);
  await expect(
    page.getByRole("heading", { name: "<img src=x onerror=alert(1)>" }),
  ).toBeVisible();
  await expect(page.locator("h1 img")).toHaveCount(0);
  await expect(page.locator(".product-info script")).toHaveCount(0);
  const guest = await (
    await request.get(base + "/api/offers/" + offer.slug)
  ).json();
  expect(guest.offer.orders).toBeUndefined();
  expect(guest.offer.ownItems).toEqual([]);
});
