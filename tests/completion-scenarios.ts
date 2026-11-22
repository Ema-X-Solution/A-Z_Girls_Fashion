import { describe, it, expect } from "vitest";
import request from "supertest";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { chromium, expect as browserExpect } from "@playwright/test";
import { preview } from "vite";
import { resolve } from "node:path";
export function registerCompletionTests(get: () => any) {
  let branch: any, destination: any, opsVariant: any;
  async function fixture() {
    const { db, owner, send } = get();
    if (!branch) {
      const r = await send(owner, "/administration/branches", {
        name: "فرع اختبار الاستكمال",
        locationName: "مخزن المصدر",
      });
      expect(r.status).toBe(201);
      branch = r.body.data;
      destination = await db.stockLocation.create({
        data: { branchId: branch.id, name: "مخزن الاستلام" },
      });
      const category = await db.category.findFirstOrThrow();
      const product = await send(owner, "/products", {
        nameAr: "فستان اختبارات التشغيل",
        sku: "OPS-PRODUCT",
        categoryId: category.id,
        variants: [{ sku: "OPS-VARIANT", price: "100", cost: "20" }],
      });
      expect(product.status).toBe(201);
      opsVariant = product.body.data.variants[0];
      expect(
        (
          await send(owner, "/inventory/adjustments", {
            locationId: branch.locations[0].id,
            variantId: opsVariant.id,
            quantity: 50,
            cost: "20",
            reason: "Opening test stock",
          })
        ).status,
      ).toBe(200);
    }
    return {
      branch,
      destination,
      variant: opsVariant,
      location: branch.locations[0],
    };
  }
  async function currentShift(who: any) {
    const { send } = get();
    let shift = (await who.agent.get("/api/shifts/current")).body.data;
    if (!shift) {
      const f = await fixture();
      const reg = await send(get().owner, "/administration/registers", {
        name: crypto.randomUUID(),
        branchId: f.branch.id,
        locationId: f.location.id,
      });
      expect(reg.status).toBe(201);
      const result = await send(who, "/shifts/open", {
        registerId: reg.body.data.id,
        openingCash: "1000",
      });
      expect(result.status).toBe(201);
      shift = result.body.data;
    }
    return shift;
  }
  describe("operational completion", () => {
    it("approves expenses once, rejects self approval, keeps pending/rejected amounts out of profit and protects attachments", async () => {
      const { owner, manager, cashier, send, db, app, resetFixtureQuota } =
        get();
      await resetFixtureQuota();
      await fixture();
      const category = await send(owner, "/expense-categories", {
        name: "تصنيف مراجعة جديد",
      });
      expect(category.status).toBe(201);
      const before = (await owner.agent.get("/api/reports/dashboard")).body.data
        .expenses;
      const pending = await send(manager, "/expenses", {
        category: category.body.data.name,
        amount: "12",
        method: "CASH",
        description: "طلب مصروف معلق",
        submitForApproval: true,
      });
      expect(pending.status).toBe(201);
      expect(pending.body.data.status).toBe("PENDING");
      expect(
        (await owner.agent.get("/api/reports/dashboard")).body.data.expenses,
      ).toBe(before);
      expect(
        (
          await send(manager, `/expenses/${pending.body.data.id}/decision`, {
            approve: true,
            note: "موافقة على طلب نفسي",
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await send(cashier, `/expenses/${pending.body.data.id}/decision`, {
            approve: false,
            note: "غير مصرح",
          })
        ).status,
      ).toBe(403);
      const bytes = Buffer.from(
        "%PDF-1.4\n% expense evidence\n1 0 obj <<>> endobj\n%%EOF",
      );
      const file = await send(
        manager,
        `/expenses/${pending.body.data.id}/attachments`,
        {
          name: "إثبات مصروف.pdf",
          dataUrl: `data:application/pdf;base64,${bytes.toString("base64")}`,
        },
      );
      expect(file.status).toBe(201);
      expect(
        (
          await request(app).get(
            `/api/expense-attachments/${file.body.data.id}`,
          )
        ).status,
      ).toBe(401);
      const fetched = await owner.agent.get(
        `/api/expense-attachments/${file.body.data.id}`,
      );
      expect(fetched.status).toBe(200);
      expect(fetched.headers["cache-control"]).toBe("no-store");
      expect(Buffer.from(fetched.body)).toEqual(bytes);
      expect(
        (
          await send(manager, `/expenses/${pending.body.data.id}/attachments`, {
            name: "bad.svg",
            dataUrl: "data:image/svg+xml;base64,PHN2Zz4=",
          })
        ).status,
      ).toBe(400);
      const shift = await currentShift(owner);
      const body = {
        approve: true,
        note: "تمت مراجعة الإثبات",
        shiftId: shift.id,
      };
      const decisions = await Promise.all([
        send(owner, `/expenses/${pending.body.data.id}/decision`, body),
        send(owner, `/expenses/${pending.body.data.id}/decision`, body),
      ]);
      expect(decisions.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(
        await db.cashMovement.count({
          where: { reference: pending.body.data.id, type: "EXPENSE" },
        }),
      ).toBe(1);
      expect(
        (
          await db.cashMovement.findFirstOrThrow({
            where: { reference: pending.body.data.id },
          })
        ).shiftId,
      ).toBe(shift.id);
      expect(
        Number(
          (await owner.agent.get("/api/reports/dashboard")).body.data.expenses,
        ) - Number(before),
      ).toBe(12);
      await expect(
        db.expense.update({
          where: { id: pending.body.data.id },
          data: { amount: "1" },
        }),
      ).rejects.toThrow();
      const rejected = await send(manager, "/expenses", {
        category: category.body.data.name,
        amount: "9",
        method: "BANK",
        description: "طلب مرفوض للاختبار",
        submitForApproval: true,
      });
      expect(
        (
          await send(owner, `/expenses/${rejected.body.data.id}/decision`, {
            approve: false,
            note: "المستند غير مكتمل",
          })
        ).status,
      ).toBe(200);
      expect(
        Number(
          (await owner.agent.get("/api/reports/dashboard")).body.data.expenses,
        ) - Number(before),
      ).toBe(12);
      const stop = await owner.agent
        .patch(`/api/expense-categories/${category.body.data.id}`)
        .set("Origin", get().origin())
        .set("X-CSRF-Token", owner.csrf)
        .send({ active: false });
      expect(stop.status).toBe(200);
      expect(
        (
          await send(manager, "/expenses", {
            category: category.body.data.name,
            amount: "1",
            method: "BANK",
            description: "تصنيف متوقف",
            submitForApproval: true,
          })
        ).status,
      ).toBe(400);
    });
    it("manages branches/registers with open-shift guards and revokes sessions on role changes", async () => {
      const { owner, cashier, send, db, login, resetFixtureQuota } = get();
      await resetFixtureQuota();
      const f = await fixture();
      const role = await db.role.findUniqueOrThrow({
          where: { name: "CASHIER" },
        }),
        managerRole = await db.role.findUniqueOrThrow({
          where: { name: "MANAGER" },
        });
      const person = await send(owner, "/users", {
        name: "كاشير إدارة الفروع",
        email: "ops-cashier@example.test",
        password: get().password,
        roleIds: [role.id],
        discountLimit: "0",
      });
      expect(person.status).toBe(201);
      const who = await login("ops-cashier@example.test");
      const reg = await send(owner, "/administration/registers", {
        name: "جهاز اختبار الفرع",
        branchId: f.branch.id,
        locationId: f.destination.id,
      });
      expect(reg.status).toBe(201);
      const opened = await send(who, "/shifts/open", {
        registerId: reg.body.data.id,
        openingCash: "0",
      });
      expect(opened.status).toBe(201);
      const patch = (path: string, body: any) =>
        owner.agent
          .patch(`/api${path}`)
          .set("Origin", get().origin())
          .set("X-CSRF-Token", owner.csrf)
          .send(body);
      expect(
        (
          await patch(`/administration/registers/${reg.body.data.id}`, {
            name: "غير مسموح أثناء الوردية",
            locationId: f.destination.id,
            active: false,
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await patch(`/administration/branches/${f.branch.id}`, {
            name: f.branch.name,
            active: false,
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await send(who, `/shifts/${opened.body.data.id}/close`, {
            countedCash: "0",
            notes: "إغلاق اختبار",
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await patch(`/administration/registers/${reg.body.data.id}`, {
            name: "جهاز متوقف",
            locationId: f.destination.id,
            active: false,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await send(who, "/shifts/open", {
            registerId: reg.body.data.id,
            openingCash: "0",
          })
        ).status,
      ).toBe(400);
      expect(
        (await cashier.agent.get("/api/administration/sessions")).status,
      ).toBe(403);
      const sessions = await owner.agent.get("/api/administration/sessions");
      expect(sessions.status).toBe(200);
      expect(JSON.stringify(sessions.body)).not.toContain('"csrf"');
      const session = sessions.body.data.find(
        (s: any) => s.userId === person.body.data.id,
      );
      expect(session).toBeTruthy();
      expect(
        (await send(owner, `/administration/sessions/${session.id}/revoke`, {}))
          .status,
      ).toBe(200);
      expect((await who.agent.get("/api/auth/me")).status).toBe(401);
      const relogged = await login("ops-cashier@example.test");
      expect(
        (
          await patch(`/administration/users/${person.body.data.id}/role`, {
            roleId: managerRole.id,
          })
        ).status,
      ).toBe(200);
      expect((await relogged.agent.get("/api/auth/me")).status).toBe(401);
      const ownerRole = await db.role.findUniqueOrThrow({
        where: { name: "OWNER" },
      });
      expect(
        (
          await patch(`/administration/users/${person.body.data.id}/role`, {
            roleId: ownerRole.id,
          })
        ).status,
      ).toBe(403);
    });
    it("reconciles shipment partial receipts and quarantine release/disposal without losing valuation", async () => {
      const { owner, manager, send, db, resetFixtureQuota } = get();
      await resetFixtureQuota();
      const f = await fixture();
      const reportBefore = (await owner.agent.get("/api/reports/dashboard"))
        .body.data;
      const shipped = await send(owner, "/inventory/shipments", {
        sourceId: f.location.id,
        destinationId: f.destination.id,
        reason: "شحن اختبار",
        items: [{ variantId: f.variant.id, quantity: 7 }],
      });
      expect(shipped.status).toBe(201);
      const sid = shipped.body.data.id,
        item = shipped.body.data.items[0];
      const afterShip = (await owner.agent.get("/api/reports/dashboard")).body
        .data;
      expect(afterShip.inventoryValue).toBe(reportBefore.inventoryValue);
      expect(
        Number(afterShip.inTransitValue) - Number(reportBefore.inTransitValue),
      ).toBe(140);
      const input = { items: [{ itemId: item.id, quantity: 4 }] },
        key = crypto.randomUUID();
      expect(
        (await send(owner, `/inventory/shipments/${sid}/receive`, input, key))
          .status,
      ).toBe(200);
      expect(
        (await send(owner, `/inventory/shipments/${sid}/receive`, input, key))
          .status,
      ).toBe(200);
      expect(
        (await db.shipmentItem.findUniqueOrThrow({ where: { id: item.id } }))
          .received,
      ).toBe(4);
      expect(
        (
          await send(owner, `/inventory/shipments/${sid}/receive`, {
            items: [{ itemId: item.id, quantity: 4 }],
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await send(owner, `/inventory/shipments/${sid}/receive`, {
            items: [{ itemId: item.id, quantity: 3 }],
          })
        ).body.data.status,
      ).toBe("RECEIVED");
      const held = await send(owner, "/inventory/holds", {
        locationId: f.destination.id,
        variantId: f.variant.id,
        quantity: 3,
        reason: "فحص جودة",
      });
      expect(held.status).toBe(201);
      const beforeResolve = (await owner.agent.get("/api/reports/dashboard"))
        .body.data;
      expect(beforeResolve.inventoryValue).toBe(reportBefore.inventoryValue);
      expect(
        (
          await send(owner, `/inventory/holds/${held.body.data.id}/resolve`, {
            action: "RELEASE",
            quantity: 1,
            reason: "صالح للبيع",
          })
        ).status,
      ).toBe(200);
      const dispose = { action: "DISPOSE", quantity: 2, reason: "تالف نهائي" };
      const outcomes = await Promise.all([
        send(owner, `/inventory/holds/${held.body.data.id}/resolve`, dispose),
        send(owner, `/inventory/holds/${held.body.data.id}/resolve`, dispose),
      ]);
      expect(outcomes.map((r) => r.status).sort()).toEqual([200, 409]);
      const final = (await owner.agent.get("/api/reports/dashboard")).body.data;
      expect(
        Number(reportBefore.inventoryValue) - Number(final.inventoryValue),
      ).toBe(40);
      expect(
        Number(final.stockDamageCost) - Number(reportBefore.stockDamageCost),
      ).toBe(40);
      const hidden = await manager.agent.get("/api/inventory/shipments");
      expect(JSON.stringify(hidden.body)).not.toContain('"unitCost"');
      await expect(
        db.shipmentItem.update({
          where: { id: item.id },
          data: { quantity: 99 },
        }),
      ).rejects.toThrow();
    });
    it("reconciles continuous stock counts with movements after each recorded line and cancels unused counts", async () => {
      const { owner, send, db, resetFixtureQuota } = get();
      await resetFixtureQuota();
      const f = await fixture();
      const before = await db.stockBalance.findUniqueOrThrow({
        where: {
          variantId_locationId: {
            variantId: f.variant.id,
            locationId: f.destination.id,
          },
        },
      });
      const count = await send(owner, "/inventory/stock-counts", {
        locationId: f.destination.id,
        mode: "CONTINUOUS",
      });
      expect(count.status).toBe(201);
      expect(
        (
          await send(owner, "/inventory/adjustments", {
            locationId: f.destination.id,
            variantId: f.variant.id,
            quantity: 3,
            cost: "20",
            reason: "حركة قبل تسجيل العد",
          })
        ).status,
      ).toBe(200);
      const saved = await owner.agent
        .patch(`/api/inventory/stock-counts/${count.body.data.id}`)
        .set("Origin", get().origin())
        .set("X-CSRF-Token", owner.csrf)
        .send({
          items: [{ variantId: f.variant.id, actual: before.quantity + 2 }],
        });
      expect(saved.status).toBe(200);
      expect(
        (
          await send(owner, "/inventory/adjustments", {
            locationId: f.destination.id,
            variantId: f.variant.id,
            quantity: 2,
            cost: "20",
            reason: "حركة بعد العد",
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await send(
            owner,
            `/inventory/stock-counts/${count.body.data.id}/approve`,
            {},
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await db.stockBalance.findUniqueOrThrow({
            where: {
              variantId_locationId: {
                variantId: f.variant.id,
                locationId: f.destination.id,
              },
            },
          })
        ).quantity,
      ).toBe(before.quantity + 4);
      const cancelled = await send(owner, "/inventory/stock-counts", {
        locationId: f.destination.id,
        mode: "CONTINUOUS",
      });
      expect(cancelled.status).toBe(201);
      expect(
        (
          await send(
            owner,
            `/inventory/stock-counts/${cancelled.body.data.id}/cancel`,
            {},
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await send(
            owner,
            `/inventory/stock-counts/${cancelled.body.data.id}/approve`,
            {},
          )
        ).status,
      ).toBe(409);
    });
    it("applies owner-configured customer discounts and freezes old receipt amounts", async () => {
      const { owner, manager, send, db, resetFixtureQuota } = get();
      await resetFixtureQuota();
      const f = await fixture(),
        shift = await currentShift(owner);
      const customer = await send(owner, "/customers", {
        name: "عميل خصم دائم",
        phone: "01275550001",
      });
      expect(customer.status).toBe(201);
      const patch = (who: any, p: string, body: any) =>
        who.agent
          .patch(`/api${p}`)
          .set("Origin", get().origin())
          .set("X-CSRF-Token", who.csrf)
          .send(body);
      expect(
        (
          await patch(manager, `/customers/${customer.body.data.id}/discount`, {
            percent: "10",
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await patch(owner, `/customers/${customer.body.data.id}/discount`, {
            percent: "10",
          })
        ).status,
      ).toBe(200);
      await send(owner, "/inventory/adjustments", {
        locationId:
          shift.register?.locationId ??
          (
            await db.register.findUniqueOrThrow({
              where: { id: shift.registerId },
            })
          ).locationId,
        variantId: f.variant.id,
        quantity: 3,
        cost: "20",
        reason: "تهيئة بيع خصم العميل",
      });
      const sold = await send(owner, "/sales", {
        shiftId: shift.id,
        customerId: customer.body.data.id,
        items: [{ variantId: f.variant.id, quantity: 1 }],
        payments: [{ method: "CASH", amount: "100" }],
      });
      expect(sold.status).toBe(201);
      expect(sold.body.data.total).toBe("90");
      const snapshot = await db.sale.findUniqueOrThrow({
        where: { id: sold.body.data.id },
      });
      expect((snapshot.receiptSnapshot as any).customerDiscount).toBe("10.00");
      expect(
        (
          await patch(owner, `/customers/${customer.body.data.id}/discount`, {
            percent: "0",
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await db.sale.findUniqueOrThrow({ where: { id: snapshot.id } })
        ).total.toString(),
      ).toBe("90");
    });
    it("groups a frozen UTC-midnight fixture into the correct Cairo day and month", async () => {
      const { db, owner, resetFixtureQuota } = get();
      await resetFixtureQuota();
      const template = await db.sale.findFirstOrThrow({
        include: { items: true },
        orderBy: { createdAt: "desc" },
      });
      const { items } = template;
      const values = Object.fromEntries(
        Object.entries(template).filter(([key]) =>
          !["id", "number", "receiptNumber", "createdAt", "items"].includes(key),
        ),
      );
      await db.sale.create({
        data: {
          ...values,
          receiptNumber: "CAIRO-BOUNDARY-TEST",
          createdAt: new Date("2025-12-31T22:30:00Z"),
          items: {
            create: items.map(
              ({ id: _itemId, saleId: _saleId, ...line }: any) => line,
            ),
          },
        },
      });
      const params =
        "from=2025-12-31T00:00:00.000Z&to=2026-01-02T00:00:00.000Z";
      const day = await owner.agent.get(`/api/reports/detail/daily?${params}`);
      expect(day.status).toBe(200);
      expect(day.body.data).toHaveLength(1);
      expect(day.body.data[0].label).toBe("2026-01-01");
      const month = await owner.agent.get(
        `/api/reports/detail/monthly?${params}`,
      );
      expect(month.body.data[0].label).toBe("2026-01");
    });
    it("exports all report types with scope, pagination, search, protected profit and readable Arabic PDFs", async () => {
      const { owner, manager, cashier, resetFixtureQuota } = get();
      await resetFixtureQuota();
      const from = new Date(Date.now() - 86400000).toISOString(),
        to = new Date(Date.now() + 86400000).toISOString(),
        params = `from=${from}&to=${to}`;
      const kinds = [
        "daily",
        "monthly",
        "category",
        "product",
        "variant",
        "cashier",
        "payments",
        "returns",
        "discounts",
        "purchases",
        "suppliers",
        "inventory",
        "low-stock",
        "movements",
        "expenses",
        "gross-profit",
        "net-profit",
        "shifts",
      ];
      for (const kind of kinds) {
        const result = await owner.agent.get(
          `/api/reports/detail/${kind}?${params}`,
        );
        expect(result.status, kind + JSON.stringify(result.body)).toBe(200);
        expect(result.body.columns.length).toBeGreaterThan(0);
        expect(result.body.data.length).toBeLessThanOrEqual(30);
      }
      const hidden = await cashier.agent.get(
        `/api/reports/detail/product?${params}`,
      );
      expect(hidden.status).toBe(403);
      const managerReport = await manager.agent.get(
        `/api/reports/detail/product?${params}`,
      );
      expect(managerReport.status).toBe(200);
      expect(
        managerReport.body.columns.some((c: any) =>
          ["cost", "profit"].includes(c.key),
        ),
      ).toBe(false);
      expect(
        (
          await owner.agent.get(
            "/api/reports/detail/daily?from=2020-01-01&to=2026-01-01",
          )
        ).status,
      ).toBe(400);
      const searched = await owner.agent.get(
        `/api/reports/detail/variant?${params}&q=OPS-VARIANT`,
      );
      expect(searched.status).toBe(200);
      expect(
        searched.body.data.every((r: any) => r.label.includes("OPS-VARIANT")),
      ).toBe(true);
      const paged = await owner.agent.get(
        `/api/reports/detail/movements?${params}&offset=30`,
      );
      expect(paged.status).toBe(200);
      expect(paged.body.data.length).toBeLessThanOrEqual(30);
      const xlsx = await owner.agent
        .get(`/api/reports/detail/purchases?${params}&format=xlsx`)
        .buffer(true)
        .parse((res: any, done: any) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => done(null, Buffer.concat(chunks)));
        });
      expect(xlsx.status).toBe(200);
      expect(xlsx.headers["content-type"]).toContain("spreadsheetml");
      expect(Buffer.from(xlsx.body).subarray(0, 2).toString()).toBe("PK");
      await mkdir("test-results", { recursive: true });
      for (const kind of ["net-profit", "expenses", "variant"]) {
        const pdf = await owner.agent.get(
          `/api/reports/detail/${kind}?${params}&format=pdf`,
        );
        expect(pdf.status).toBe(200);
        expect(Buffer.from(pdf.body).subarray(0, 5).toString()).toBe("%PDF-");
        await writeFile(`test-results/report-${kind}.pdf`, pdf.body);
      }
    });
    it("operates expense approval, report PDF export, admin screens and shipping while POS excludes cloud carts", async () => {
      const { app, manager, send, resetFixtureQuota } = get();
      await resetFixtureQuota();
      const f = await fixture();
      const pending = await send(manager, "/expenses", {
        category: "أخرى",
        amount: "3",
        method: "BANK",
        description: "مصروف واجهة تجريبي",
        submitForApproval: true,
      });
      expect(pending.status).toBe(201);
      const server = app.listen(0, "127.0.0.1");
      await new Promise<void>((r) => server.once("listening", r));
      const web = await preview({
        root: resolve("apps/web"),
        preview: {
          host: "127.0.0.1",
          port: await get().availablePort(),
          strictPort: true,
          proxy: { "/api": `http://127.0.0.1:${server.address().port}` },
        },
      });
      const url = `http://127.0.0.1:${(web.httpServer.address() as any).port}`,
        priorOrigin = process.env.APP_ORIGIN;
      process.env.APP_ORIGIN = url;
      const browser = await chromium.launch({
        channel: process.env.BROWSER_CHANNEL ?? "msedge",
        headless: true,
      });
      async function context() {
        const c = await browser.newContext({
          viewport: { width: 1440, height: 1050 },
          acceptDownloads: true,
        });
        expect(
          (
            await c.request.post(url + "/api/auth/login", {
              headers: { Origin: url },
              data: { email: "owner@example.test", password: get().password },
            })
          ).status(),
        ).toBe(200);
        return c;
      }
      try {
        const c = await context(),
          page = await c.newPage();
        const errors: string[] = [];
        page.on("pageerror", (e) => {
          errors.push(e.message);
          console.info("Completion browser error: " + e.message);
        });
        await page.goto(url + "/expenses");
        await browserExpect(
          page.getByRole("heading", { name: "المصروفات", exact: true }),
        ).toBeVisible();
        await page
          .getByRole("row")
          .filter({ hasText: "مصروف واجهة تجريبي" })
          .getByRole("button", { name: "تفاصيل ومرفقات" })
          .click();
        await page
          .getByLabel("ملاحظة المراجع", { exact: true })
          .fill("تمت مراجعة المصروف من الشاشة");
        const decision = page.waitForResponse(
          (r) =>
            r.url().endsWith(`/expenses/${pending.body.data.id}/decision`) &&
            r.request().method() === "POST",
        );
        await page
          .getByRole("button", { name: "تسجيل القرار", exact: true })
          .click();
        expect((await decision).status()).toBe(200);
        await browserExpect(page.getByRole("dialog")).toHaveCount(0);
        await page.screenshot({
          path: "test-results/completion-expenses.png",
          fullPage: true,
        });
        await page.goto(url + "/administration");
        await browserExpect(
          page.getByRole("heading", {
            name: "الفروع والأجهزة والجلسات",
            exact: true,
          }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "جلسات الدخول", exact: true })
          .click();
        await browserExpect(
          page.getByRole("cell", { name: "جلسة هذا الجهاز", exact: true }),
        ).toBeVisible();
        await page.screenshot({
          path: "test-results/completion-sessions.png",
          fullPage: true,
        });
        await page.goto(url + "/reports");
        await page
          .getByLabel("نوع التقرير", { exact: true })
          .selectOption("expenses");
        await page
          .getByLabel("بحث داخل التقرير", { exact: true })
          .fill("مصروف واجهة تجريبي");
        await browserExpect(
          page.getByRole("cell", { name: "مصروف واجهة تجريبي", exact: true }),
        ).toBeVisible();
        await page.screenshot({
          path: "test-results/completion-reports.png",
          fullPage: true,
        });
        const downloaded = page.waitForEvent("download");
        await page
          .getByRole("link", { name: "تصدير PDF", exact: true })
          .click();
        const download = await downloaded;
        await download.saveAs("test-results/report-browser.pdf");
        expect(
          (await readFile("test-results/report-browser.pdf"))
            .subarray(0, 5)
            .toString(),
        ).toBe("%PDF-");
        await page.goto(url + "/inventory/advanced");
        await page
          .getByRole("button", { name: "شحنة تحويل جديدة", exact: true })
          .click();
        const dialog = page.getByRole("dialog");
        await dialog
          .getByLabel("المخزن المصدر", { exact: true })
          .selectOption(f.location.id);
        await dialog
          .getByLabel("المخزن المستلم", { exact: true })
          .selectOption(f.destination.id);
        await dialog
          .getByLabel("بحث عن صنف بالاسم أو SKU", { exact: true })
          .fill("OPS-PRODUCT");
        await browserExpect(
          dialog.getByLabel("الصنف", { exact: true }).locator("option"),
        ).toHaveCount(2);
        await dialog
          .getByLabel("الصنف", { exact: true })
          .selectOption(f.variant.id);
        await dialog.getByLabel("السبب", { exact: true }).fill("شحنة متصفح");
        const shipmentResponse = page.waitForResponse(
          (r) =>
            r.url().endsWith("/api/inventory/shipments") &&
            r.request().method() === "POST",
        );
        await dialog
          .getByRole("button", { name: "شحن وخصم من المصدر", exact: true })
          .click();
        expect((await shipmentResponse).status()).toBe(201);
        await browserExpect(dialog).toHaveCount(0);
        await page.screenshot({
          path: "test-results/completion-shipments.png",
          fullPage: true,
        });
        await page.goto(url + "/pos");
        await page
          .getByRole("textbox", { name: "مسح الباركود", exact: true })
          .fill(f.variant.barcode);
        await page
          .getByRole("textbox", { name: "مسح الباركود", exact: true })
          .press("Enter");
        await browserExpect(page.locator(".cart-line")).toHaveCount(1);
        await page
          .getByRole("combobox", { name: "رقم العميل أو الاسم", exact: true })
          .fill("01275550001");
        await page
          .getByRole("listbox", { name: "نتائج بحث العملاء", exact: true })
          .getByRole("option")
          .first()
          .click();
        await browserExpect(page.getByRole("button", { name: "تعليق ومزامنة للخادم", exact: true })).toHaveCount(0);
        await browserExpect(page.getByRole("button", { name: "السلال المشتركة", exact: true })).toHaveCount(0);
        await browserExpect(page.locator(".cart-line")).toHaveCount(1);
        expect(errors).toEqual([]);
      } finally {
        await browser.close();
        web.httpServer.closeAllConnections();
        await new Promise<void>((r) => web.httpServer.close(() => r()));
        server.closeAllConnections();
        await new Promise<void>((r) => server.close(() => r()));
        process.env.APP_ORIGIN = priorOrigin;
      }
    }, 90000);
  });
}
