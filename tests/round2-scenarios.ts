import { chromium, expect as browserExpect } from "@playwright/test";
import { preview } from "vite";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";

export function registerRound2Tests(get: () => any) {
  describe.sequential(
    "round2 data-preservation and display regressions",
    () => {
      let variant: any, priceOnly: any, destination: any;
      const options = { المقاس: "M", اللون: "أزرق" };
      it("preserves every omitted variant field and limits the price-only role", async () => {
        const { db, owner, send, login, password, resetFixtureQuota } = get();
        await resetFixtureQuota();
        const category = await db.category.findFirstOrThrow();
        const created = await send(owner, "/products", {
          nameAr: "منتج اختبار الإصلاحات",
          categoryId: category.id,
          variants: [
            {
              price: "200.00",
              cost: "43.00",
              options,
              minStock: 7,
              reorderQuantity: 13,
            },
          ],
        });
        expect(created.status).toBe(201);
        variant = created.body.data.variants[0];
        const role = await send(owner, "/roles", {
          name: `Price-only ${crypto.randomUUID()}`,
          permissions: [
            "products.change_price",
            "inventory.view",
            "pos.access",
          ],
        });
        expect(role.status).toBe(201);
        const email = `price-${crypto.randomUUID()}@example.test`;
        const user = await send(owner, "/users", {
          name: "Price-only regression",
          email,
          password,
          roleIds: [role.body.data.id],
        });
        expect(user.status).toBe(201);
        priceOnly = await login(email);
        const patch = (who: any, body: unknown) =>
          who.agent
            .patch(`/api/variants/${variant.id}`)
            .set("Origin", get().origin())
            .set("X-CSRF-Token", who.csrf)
            .send(body);
        const before = await db.productVariant.findUniqueOrThrow({
          where: { id: variant.id },
        });
        const changed = await patch(priceOnly, { price: "175.00" });
        expect(changed.status).toBe(200);
        expect(changed.body.data.cost).toBeUndefined();
        const afterPrice = await db.productVariant.findUniqueOrThrow({
          where: { id: variant.id },
        });
        expect(afterPrice).toEqual({ ...before, price: afterPrice.price });
        expect(afterPrice.price.toFixed(2)).toBe("175.00");
        expect((await patch(priceOnly, { minStock: 9 })).status).toBe(200);
        const afterMinimum = await db.productVariant.findUniqueOrThrow({
          where: { id: variant.id },
        });
        expect(afterMinimum).toEqual({ ...afterPrice, minStock: 9 });
        expect((await patch(priceOnly, { price: "0" })).status).toBe(200);
        expect(
          (
            await db.productVariant.findUniqueOrThrow({
              where: { id: variant.id },
            })
          ).price.toString(),
        ).toBe("0");
        for (const body of [
          {},
          { price: "10", cost: "0" },
          { price: "10", options: {} },
          { active: false },
          { sku: "changed" },
          { barcode: "123456" },
          { reorderQuantity: 1 },
        ])
          expect((await patch(priceOnly, body)).status).toBe(400);
        const unprivilegedEmail = `no-price-${crypto.randomUUID()}@example.test`;
        const viewRole = await send(owner, "/roles", {
          name: `View ${crypto.randomUUID()}`,
          permissions: ["products.view"],
        });
        await send(owner, "/users", {
          name: "View-only regression",
          email: unprivilegedEmail,
          password,
          roleIds: [viewRole.body.data.id],
        });
        expect(
          (await patch(await login(unprivilegedEmail), { price: "10" })).status,
        ).toBe(403);
        expect((await patch(owner, { price: "200.00" })).status).toBe(200);
        const audit = await db.auditLog.findFirstOrThrow({
          where: { action: "VARIANT_UPDATE", reference: variant.id },
          orderBy: { createdAt: "desc" },
        });
        expect(audit.details).toMatchObject({
          price: { before: "0.00", after: "200.00" },
        });
      });
      it("labels shipment and quarantine items without exposing costs to inventory-only staff", async () => {
        const { db, owner, send, resetFixtureQuota } = get();
        await resetFixtureQuota();
        const location = await db.stockLocation.findFirstOrThrow();
        destination = await db.stockLocation.create({
          data: {
            branchId: location.branchId,
            name: `Round2 destination ${crypto.randomUUID()}`,
          },
        });
        expect(
          (
            await send(owner, "/inventory/adjustments", {
              locationId: location.id,
              variantId: variant.id,
              quantity: 20,
              cost: "43",
              reason: "Round2 isolated stock",
            })
          ).status,
        ).toBe(200);
        const shipment = await send(owner, "/inventory/shipments", {
          sourceId: location.id,
          destinationId: destination.id,
          reason: "Round2 labeled shipment",
          items: [{ variantId: variant.id, quantity: 2 }],
        });
        expect(shipment.status).toBe(201);
        const hold = await send(owner, "/inventory/holds", {
          locationId: location.id,
          variantId: variant.id,
          quantity: 1,
          reason: "Round2 labeled hold",
        });
        expect(hold.status).toBe(201);
        const shipped = await priceOnly.agent.get("/api/inventory/shipments");
        const held = await priceOnly.agent.get("/api/inventory/holds");
        expect(shipped.status).toBe(200);
        expect(held.status).toBe(200);
        const item = shipped.body.data.find(
          (row: any) => row.id === shipment.body.data.id,
        ).items[0];
        const heldItem = held.body.data.find(
          (row: any) => row.id === hold.body.data.id,
        );
        for (const row of [item, heldItem]) {
          expect(row.variantLabel).toContain("منتج اختبار الإصلاحات");
          expect(row.variantLabel).toContain(variant.sku);
          expect(row.variantLabel).toContain("أزرق");
          expect(row.variantLabel).toContain("M");
          expect(row.unitCost).toBeUndefined();
          expect(row.cost).toBeUndefined();
          expect(row.variant).toBeUndefined();
        }
      });
      it("exports a PDF whose header retains the selected Cairo calendar day", async () => {
        const { owner } = get();
        const query =
          "from=2026-11-21T22%3A00%3A00.000Z&to=2026-11-22T21%3A59%3A59.999Z&format=pdf";
        const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
        await mkdir("test-results", { recursive: true });
        for (const kind of ["daily", "net-profit", "inventory"]) {
          const response = await owner.agent.get(
            `/api/reports/detail/${kind}?${query}`,
          );
          expect(response.status).toBe(200);
          const bytes = Buffer.from(response.body);
          expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
          await writeFile(`test-results/round2-${kind}.pdf`, bytes);
          const loading = getDocument({
            data: new Uint8Array(bytes),
            useSystemFonts: true,
            isEvalSupported: false,
          });
          const document = await loading.promise;
          const content = await (await document.getPage(1)).getTextContent();
          const text = content.items
            .map((item) => ("str" in item ? item.str : ""))
            .join(" ");
          expect(text).toContain("2026-11-22");
          expect(text).not.toContain("2026-11-21");
          await loading.destroy();
        }
      });
      it("returns separate promotion and customer discounts without changing the total", async () => {
        const { db, owner, send } = get();
        const customer = await db.customer.create({
          data: {
            name: "Round2 discount customer",
            phone: "+201077700099",
            discountPercent: "10",
          },
        });
        const originalStore = await db.systemSetting.findUniqueOrThrow({
          where: { key: "store" },
        });
        await db.systemSetting.update({
          where: { key: "store" },
          data: {
            value: {
              ...originalStore.value,
              taxRate: "0",
              taxMode: "EXCLUSIVE",
            },
          },
        });
        const active = await db.promotion.findMany({
          where: { active: true },
          select: { id: true },
        });
        await db.promotion.updateMany({
          where: { id: { in: active.map((row: any) => row.id) } },
          data: { active: false },
        });
        const campaign = await db.promotion.create({
          data: {
            name: "Round2 ten-percent",
            type: "PERCENT",
            percent: "10",
            productIds: [variant.productId],
            buyQuantity: 1,
            getQuantity: 1,
            active: true,
            createdBy: owner.user.id,
            startsAt: new Date(Date.now() - 60000),
            endsAt: new Date(Date.now() + 3600000),
          },
        });
        try {
          const body = {
            shiftId: crypto.randomUUID(),
            items: [{ variantId: variant.id, quantity: 1 }],
            discount: "0",
            payments: [{ method: "CASH", amount: "0" }],
          };
          const promoOnly = await send(owner, "/sales/quote", body);
          expect(promoOnly.status).toBe(200);
          expect(promoOnly.body.data).toMatchObject({
            promotionDiscount: "20.00",
            customerDiscount: "0.00",
            automaticDiscount: "20.00",
          });
          const combined = await send(owner, "/sales/quote", {
            ...body,
            customerId: customer.id,
          });
          expect(combined.status).toBe(200);
          expect(combined.body.data).toMatchObject({
            promotionDiscount: "20.00",
            customerDiscount: "18.00",
            automaticDiscount: "38.00",
          });
          expect(Number(combined.body.data.discount)).toBe(38);
          expect(Number(combined.body.data.total)).toBe(162);
          const manual = await send(owner, "/sales/quote", {
            ...body,
            customerId: customer.id,
            discount: "5",
          });
          expect(manual.status).toBe(200);
          expect(manual.body.data).toMatchObject({
            promotionDiscount: "20.00",
            customerDiscount: "18.00",
            manualDiscount: "5.00",
          });
          expect(Number(manual.body.data.discount)).toBe(43);
          expect(Number(manual.body.data.total)).toBe(157);
          await db.promotion.update({
            where: { id: campaign.id },
            data: { active: false },
          });
          const customerOnly = await send(owner, "/sales/quote", {
            ...body,
            customerId: customer.id,
          });
          expect(customerOnly.status).toBe(200);
          expect(customerOnly.body.data).toMatchObject({
            promotionDiscount: "0.00",
            customerDiscount: "20.00",
            automaticDiscount: "20.00",
            promotion: null,
          });
        } finally {
          await db.systemSetting.update({
            where: { key: "store" },
            data: { value: originalStore.value },
          });
          await db.promotion.update({
            where: { id: campaign.id },
            data: { active: false },
          });
          await db.promotion.updateMany({
            where: { id: { in: active.map((row: any) => row.id) } },
            data: { active: true },
          });
        }
      });
      it("renders preserved options, readable inventory and split discounts in the built browser UI", async () => {
        const {
          db,
          app,
          owner,
          send,
          password,
          availablePort,
          resetFixtureQuota,
        } = get();
        await resetFixtureQuota();
        const originalStore = await db.systemSetting.findUniqueOrThrow({
          where: { key: "store" },
        });
        const active = await db.promotion.findMany({
          where: { active: true },
          select: { id: true },
        });
        await db.promotion.updateMany({
          where: { active: true },
          data: { active: false },
        });
        await db.systemSetting.update({
          where: { key: "store" },
          data: {
            value: {
              ...originalStore.value,
              taxRate: "0",
              taxMode: "EXCLUSIVE",
            },
          },
        });
        const campaign = await db.promotion.create({
          data: {
            name: "عرض اختبار 10%",
            type: "PERCENT",
            percent: "10",
            productIds: [variant.productId],
            buyQuantity: 1,
            getQuantity: 1,
            active: true,
            createdBy: owner.user.id,
            startsAt: new Date(Date.now() - 60000),
            endsAt: new Date(Date.now() + 3600000),
          },
        });
        const existingShift = await db.cashShift.findFirst({
          where: { userId: owner.user.id, closedAt: null },
        });
        if (!existingShift) {
          const location = await db.stockLocation.findFirstOrThrow();
          const register = await db.register.create({
            data: {
              name: "Round2 browser register",
              branchId: location.branchId,
              locationId: location.id,
            },
          });
          expect(
            (
              await send(owner, "/shifts/open", {
                registerId: register.id,
                openingCash: "0",
              })
            ).status,
          ).toBe(201);
        }
        const http = app.listen(0, "127.0.0.1");
        await new Promise<void>((resolve) => http.once("listening", resolve));
        const apiPort = (http.address() as { port: number }).port;
        const web = await preview({
          root: resolve("apps/web"),
          preview: {
            host: "127.0.0.1",
            port: await availablePort(),
            strictPort: true,
            proxy: { "/api": `http://127.0.0.1:${apiPort}` },
          },
        });
        const url = `http://127.0.0.1:${(web.httpServer.address() as { port: number }).port}`;
        const priorOrigin = process.env.APP_ORIGIN;
        process.env.APP_ORIGIN = url;
        const browser = await chromium.launch({
          channel: process.env.BROWSER_CHANNEL ?? "msedge",
          headless: true,
        });
        try {
          const context = await browser.newContext({
            viewport: { width: 1600, height: 1100 },
          });
          expect(
            (
              await context.request.post(url + "/api/auth/login", {
                headers: { Origin: url },
                data: { email: "owner@example.test", password },
              })
            ).status(),
          ).toBe(200);
          const page = await context.newPage();
          const errors: string[] = [];
          page.on("pageerror", (error) => errors.push(error.message));
          await page.goto(url + "/products");
          await page
            .getByPlaceholder("ابحث بالاسم أو الكود...")
            .fill("منتج اختبار الإصلاحات");
          const productRow = page
            .getByRole("row")
            .filter({ hasText: "منتج اختبار الإصلاحات" });
          await page.screenshot({
            path: "test-results/round2-products-loading.png",
            fullPage: true,
          });
          await browserExpect(productRow).toBeVisible();
          await productRow
            .getByRole("button", { name: "التفاصيل", exact: true })
            .click();
          const productDialog = page.getByRole("dialog");
          await browserExpect(productDialog).toContainText("أزرق");
          await browserExpect(productDialog).toContainText("M");
          await productDialog.screenshot({
            path: "test-results/round2-variant-preserved.png",
          });
          await page.keyboard.press("Escape");
          await page.goto(url + "/inventory/advanced");
          await page
            .getByRole("row")
            .filter({ hasText: destination.name })
            .getByRole("button", { name: "تفاصيل واستلام", exact: true })
            .click();
          await browserExpect(page.getByRole("dialog")).toContainText(
            "منتج اختبار الإصلاحات",
          );
          await page
            .getByRole("dialog")
            .screenshot({ path: "test-results/round2-shipment-labels.png" });
          await page.keyboard.press("Escape");
          await page
            .getByRole("button", { name: "المخزون المحجور", exact: true })
            .click();
          await browserExpect(
            page.getByRole("row").filter({ hasText: variant.sku }),
          ).toContainText("أزرق");
          await page.screenshot({
            path: "test-results/round2-hold-labels.png",
            fullPage: true,
          });
          await page.goto(url + "/pos");
          const scan = page.getByRole("textbox", { name: "مسح الباركود" });
          await scan.fill(variant.barcode);
          await scan.press("Enter");
          await browserExpect(page.locator(".cart-line")).toHaveCount(1);
          await page
            .getByRole("combobox", { name: "رقم العميل أو الاسم", exact: true })
            .fill("+201077700099");
          await page
            .getByRole("listbox", { name: "نتائج بحث العملاء", exact: true })
            .getByRole("option")
            .first()
            .click();
          await page
            .getByLabel(`خصم ${variant.sku}`, { exact: true })
            .fill("10");
          await page.getByLabel("خصم على الفاتورة", { exact: true }).fill("5");
          await browserExpect(
            page.getByTestId("promotion-discount"),
          ).toContainText("٢٠");
          await browserExpect(
            page.getByTestId("customer-discount"),
          ).toContainText("١٧");
          await browserExpect(page.locator(".grand-total")).toContainText(
            "١٤٨",
          );
          await page.screenshot({
            path: "test-results/round2-pos-discount-split.png",
            fullPage: true,
          });
          expect(errors).toEqual([]);
        } finally {
          await browser.close();
          web.httpServer.closeAllConnections();
          await new Promise<void>((resolve) =>
            web.httpServer.close(() => resolve()),
          );
          http.closeAllConnections();
          await new Promise<void>((resolve) => http.close(() => resolve()));
          process.env.APP_ORIGIN = priorOrigin;
          await db.promotion.update({
            where: { id: campaign.id },
            data: { active: false },
          });
          await db.promotion.updateMany({
            where: { id: { in: active.map((row: any) => row.id) } },
            data: { active: true },
          });
          await db.systemSetting.update({
            where: { key: "store" },
            data: { value: originalStore.value },
          });
        }
      }, 60000);
    },
  );
          }
