import { readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";
const str = { type: "string" },
  uuid = { type: "string", format: "uuid" },
  amount = {
    type: "string",
    pattern: "^\\d{1,10}(\\.\\d{1,2})?$",
    example: "100.00",
  },
  integer = { type: "integer", minimum: 1 },
  method = { type: "string", enum: ["CASH", "CARD", "WALLET", "BANK"] };
const object = (properties, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
});
const array = (items) => ({ type: "array", items, minItems: 1 });
const variant = object(
  {
    sku: str,
    barcode: str,
    options: { type: "object", additionalProperties: str },
    price: amount,
    cost: amount,
    minStock: { type: "integer", minimum: 0 },
    reorderQuantity: integer,
  },
  ["sku", "price"],
);
const checkout = object(
  {
    shiftId: uuid,
    customerId: uuid,
    requireCustomer: {
      type: "boolean",
      enum: [true],
      description:
        "New POS checkout sends true and requires customerId; omitted on legacy integration/recovery requests.",
    },
    loyaltyPoints: { type: "integer", minimum: 0, maximum: 1000000 },
    items: array(
      object(
        {
          variantId: uuid,
          quantity: integer,
          discount: amount,
          discountType: { type: "string", enum: ["FIXED", "PERCENT"] },
        },
        ["variantId", "quantity"],
      ),
    ),
    discount: amount,
    discountType: { type: "string", enum: ["FIXED", "PERCENT"] },
    payments: array(
      object(
        {
          method,
          amount,
          cardBrand: str,
          authorizationCode: str,
          cardLast4: { type: "string", pattern: "^$|^[0-9]{4}$" },
        },
        ["method", "amount"],
      ),
    ),
    notes: str,
  },
  ["shiftId", "items", "payments"],
);
const returned = object({
  shiftId: uuid,
  reason: str,
  method,
  items: array(
    object({
      saleItemId: uuid,
      quantity: integer,
      sellable: { type: "boolean" },
    }),
  ),
});
const schemas = {
  "POST /api/auth/login": object({
    email: { type: "string", format: "email" },
    password: { type: "string", format: "password" },
  }),
  "POST /api/users": object(
    {
      name: str,
      email: { type: "string", format: "email" },
      password: { type: "string", minLength: 14 },
      roleIds: array(uuid),
      discountLimit: amount,
    },
    ["name", "email", "password", "roleIds"],
  ),
  "PATCH /api/users/:id/status": object({ active: { type: "boolean" } }),
  "POST /api/users/:id/reset-password": object({
    password: { type: "string", minLength: 14 },
  }),
  "POST /api/roles": object({ name: str, permissions: array(str) }),
  "PATCH /api/roles/:id": object({
    permissions: { type: "array", items: str },
  }),
  "POST /api/categories": object({ name: str, parentId: uuid }, ["name"]),
  "POST /api/brands": object({ name: str }),
  "POST /api/products": object(
    {
      nameAr: str,
      nameEn: str,
      description: str,
      sku: str,
      categoryId: uuid,
      brandId: uuid,
      season: str,
      collection: str,
      variants: array(variant),
    },
    ["nameAr", "sku", "categoryId", "variants"],
  ),
  "PATCH /api/products/:id": object(
    {
      nameAr: str,
      nameEn: str,
      description: str,
      sku: str,
      categoryId: uuid,
      brandId: uuid,
      season: str,
      collection: str,
    },
    [],
  ),
  "POST /api/products/:id/variants": variant,
  "PATCH /api/variants/:id": {
    ...variant,
    required: [],
    properties: { ...variant.properties, active: { type: "boolean" } },
  },
  "POST /api/inventory/adjustments": object(
    {
      variantId: uuid,
      locationId: uuid,
      quantity: { type: "integer", minimum: -100000, maximum: 100000 },
      reason: str,
      cost: amount,
    },
    ["variantId", "locationId", "quantity", "reason"],
  ),
  "POST /api/inventory/stock-counts": object({ locationId: uuid }),
  "PATCH /api/inventory/stock-counts/:id": object({
    items: array(
      object({ variantId: uuid, actual: { type: "integer", minimum: 0 } }),
    ),
  }),
  "POST /api/suppliers": object(
    {
      name: str,
      phone: str,
      email: { type: "string", format: "email" },
      address: str,
      notes: str,
      openingBalance: amount,
    },
    ["name"],
  ),
  "POST /api/purchases": object({
    supplierId: uuid,
    locationId: uuid,
    items: array(
      object({ variantId: uuid, quantity: integer, unitCost: amount }),
    ),
  }),
  "POST /api/purchases/:id/receive": object({
    items: array(object({ purchaseItemId: uuid, quantity: integer })),
  }),
  "POST /api/suppliers/:id/payments": object(
    {
      amount,
      method,
      shiftId: uuid,
      reference: str,
      notes: str,
    },
    ["amount", "method"],
  ),
  "POST /api/supplier-invoices/:id/returns": object({
    reason: str,
    items: array(object({ receiptItemId: uuid, quantity: integer })),
  }),
  "POST /api/barcodes/print-labels": object({
    items: array(
      object({
        variantId: uuid,
        quantity: { type: "integer", minimum: 1, maximum: 500 },
      }),
    ),
  }),
  "POST /api/shifts/open": object({ registerId: uuid, openingCash: amount }),
  "POST /api/shifts/:id/cash-movements": object({
    type: { type: "string", enum: ["IN", "OUT"] },
    amount,
    reason: str,
  }),
  "POST /api/shifts/:id/close": object({ countedCash: amount, notes: str }, [
    "countedCash",
  ]),
  "POST /api/sales": checkout,
  "POST /api/sales/:id/returns": returned,
  "POST /api/sales/:id/exchanges": object({ returned, replacement: checkout }),
  "POST /api/customers": object(
    {
      name: str,
      phone: str,
      email: { type: "string", format: "email" },
      address: str,
      notes: str,
    },
    ["phone"],
  ),
  "PATCH /api/customers/:id": object({
    name: str,
    phone: str,
    email: { type: ["string", "null"], format: "email" },
    address: str,
    notes: str,
  }),
  "POST /api/customers/resolve": object({ phone: str, name: str }, ["phone"]),
  "POST /api/expenses": object(
    { category: str, amount, method, description: str, shiftId: uuid },
    ["category", "amount", "method", "description"],
  ),
  "PATCH /api/settings/store": object({
    name: str,
    currency: { type: "string", enum: ["EGP"] },
    timezone: { type: "string", enum: ["Africa/Cairo"] },
    address: str,
    phone: str,
    taxRate: amount,
    returnDays: { type: "integer", minimum: 0, maximum: 365 },
    receiptFooter: str,
    receiptWidth: { type: "integer", enum: [58, 80] },
  }),
};
schemas["POST /api/sales/quote"] = checkout;
for (const suffix of ["quote", "net"])
  schemas[`POST /api/sales/:id/exchanges/${suffix}`] = object({
    returned,
    replacement: { ...checkout, required: ["shiftId", "items"] },
  });
schemas["POST /api/users"].properties.employeeCode = str;
schemas["POST /api/products"].properties.returnRule = {
  type: "string",
  enum: ["STANDARD", "DEFECT_ONLY"],
};
const binding = object({
  id: uuid,
  revision: { type: "integer", minimum: 1 },
  token: { type: "string", pattern: "^[a-f0-9]{64}$" },
});
const draft = {
  type: "object",
  description:
    "Bounded POS draft: display-only variants/items, quantities, customer, discounts, notes and tender drafts. Shared cart binding is supplied separately. Server prices/costs are authoritative.",
};
schemas["POST /api/expenses"].properties.submitForApproval = {
  type: "boolean",
  description:
    "True queues for another reviewer; users without expenses.approve always queue. Authorized direct CASH posts require own open shift.",
};
schemas["POST /api/inventory/stock-counts"].properties.mode = {
  type: "string",
  enum: ["CUTOFF", "CONTINUOUS"],
  default: "CUTOFF",
};
Object.assign(schemas, {
  "POST /api/expense-categories": object({ name: str }),
  "PATCH /api/expense-categories/:id": object({ active: { type: "boolean" } }),
  "POST /api/expenses/:id/decision": object(
    { approve: { type: "boolean" }, note: str, shiftId: uuid },
    ["approve", "note"],
  ),
  "POST /api/expenses/:id/attachments": object({
    name: str,
    dataUrl: {
      type: "string",
      maxLength: 1100000,
      description:
        "Base64 PDF/JPEG/PNG/WebP, decoded limit 750000 bytes, max five attachments; authenticated download only.",
    },
  }),
  "POST /api/administration/branches": object({ name: str, locationName: str }),
  "PATCH /api/administration/branches/:id": object({
    name: str,
    active: { type: "boolean" },
  }),
  "POST /api/administration/registers": object({
    name: str,
    branchId: uuid,
    locationId: uuid,
  }),
  "PATCH /api/administration/registers/:id": object({
    name: str,
    locationId: uuid,
    active: { type: "boolean" },
  }),
  "PATCH /api/administration/users/:id/role": object({ roleId: uuid }),
  "PATCH /api/customers/:id/discount": object({ percent: amount }),
  "POST /api/inventory/shipments": object({
    sourceId: uuid,
    destinationId: uuid,
    reason: str,
    items: array(object({ variantId: uuid, quantity: integer })),
  }),
  "POST /api/inventory/shipments/:id/receive": object({
    items: array(object({ itemId: uuid, quantity: integer })),
  }),
  "POST /api/inventory/holds": object({
    locationId: uuid,
    variantId: uuid,
    quantity: integer,
    reason: str,
  }),
  "POST /api/inventory/holds/:id/resolve": object({
    action: { type: "string", enum: ["RELEASE", "DISPOSE"] },
    quantity: integer,
    reason: str,
  }),
  "POST /api/shared-carts": object(
    {
      title: str,
      locationId: uuid,
      draft,
      reserve: { type: "boolean", default: false },
    },
    ["title", "locationId", "draft"],
  ),
  "POST /api/shared-carts/:id/sync": object({
    binding,
    stamp: {
      type: "integer",
      minimum: 1,
      description:
        "Monotonically increasing client timestamp within this lease; older writes ignored.",
    },
    draft,
  }),
  "POST /api/shared-carts/:id/release": object({ binding, draft }),
});
checkout.properties.sharedCart = binding;
schemas["POST /api/products"].properties.imageDataUrl = {
  type: "string",
  maxLength: 200000,
  description:
    "Optional PNG/JPEG/WebP base64 image, decoded maximum 140000 bytes. Product and image are saved atomically under products.create. Omit to create without an image.",
};
schemas["POST /api/sales/:id/returns"].properties.reasonType = {
  type: "string",
  enum: ["CHANGE_MIND", "MANUFACTURING_DEFECT"],
};
Object.assign(schemas["PATCH /api/settings/store"].properties, {
  taxMode: { type: "string", enum: ["INCLUSIVE", "EXCLUSIVE"] },
  branchName: str,
  taxNumber: str,
  commercialRegister: str,
  invoicePrefix: str,
  returnPolicy: str,
});
const paths = {};
const campaign = object(
  {
    name: str,
    type: { type: "string", enum: ["PERCENT", "BUY_X_GET_Y"] },
    productIds: { type: "array", items: uuid, maxItems: 200 },
    percent: amount,
    buyQuantity: { type: "integer", minimum: 1, maximum: 50 },
    getQuantity: { type: "integer", minimum: 1, maximum: 50 },
    startsAt: { type: "string", format: "date-time" },
    endsAt: { type: "string", format: "date-time" },
    active: { type: "boolean" },
  },
  ["name", "type", "startsAt", "endsAt"],
);
schemas["POST /api/promotions"] = campaign;
schemas["PATCH /api/promotions/:id"] = campaign;
schemas["POST /api/settings/logo"] = object({
  dataUrl: {
    type: "string",
    maxLength: 200000,
    description: "Base64 PNG/JPEG/WebP, decoded maximum 140000 bytes.",
  },
});
schemas["POST /api/products/:id/image"] = object({
  dataUrl: {
    type: "string",
    nullable: true,
    maxLength: 200000,
    description:
      "Base64 PNG/JPEG/WebP; decoded limit 140000 bytes. Null removes the product image. Requires products.update. Content-addressed assets are retained; stock and historical receipts are unchanged.",
  },
});
checkout.properties.discountApprovalId = uuid;
schemas["POST /api/discount-approvals"] = object({
  sale: checkout,
  reason: { type: "string", minLength: 3, maxLength: 1000 },
});
schemas["POST /api/discount-approvals/:id/decision"] = object({
  decision: { type: "string", enum: ["APPROVED", "REJECTED"] },
  note: { type: "string", minLength: 3, maxLength: 1000 },
});
schemas["PATCH /api/loyalty/settings"] = object({
  enabled: { type: "boolean" },
  spendPerPoint: amount,
  pointValue: amount,
  expiryDays: { type: "integer", minimum: 1, maximum: 3650 },
  maxRedeemPercent: { type: "integer", minimum: 1, maximum: 90 },
  minimumRedeemPoints: { type: "integer", minimum: 1, maximum: 1000000 },
});
schemas["POST /api/inventory/documents"] = object(
  {
    type: { type: "string", enum: ["TRANSFER", "DAMAGE", "ADJUSTMENT"] },
    sourceId: uuid,
    destinationId: uuid,
    reason: str,
    items: array(
      object(
        {
          variantId: uuid,
          quantity: { type: "integer", minimum: -100000, maximum: 100000 },
          cost: amount,
        },
        ["variantId", "quantity"],
      ),
    ),
  },
  ["type", "sourceId", "reason", "items"],
);
schemas["POST /api/inventory/locations"] = object({
  name: str,
  branchId: uuid,
});
for (const [file, prefix] of [
  ["apps/api/src/app.ts", ""],
  ["apps/api/src/routes/roles.routes.ts", "/api"],
  ["apps/api/src/routes/users.routes.ts", "/api"],
  ["apps/api/src/routes/catalog.routes.ts", "/api"],
  ["apps/api/src/routes/resources.routes.ts", "/api"],
  ["apps/api/src/routes/inventory.routes.ts", "/api"],
  ["apps/api/src/routes/purchases.routes.ts", "/api"],
  ["apps/api/src/routes/shifts.routes.ts", "/api"],
  ["apps/api/src/routes/sales.routes.ts", "/api"],
  ["apps/api/src/routes/sales-quote.routes.ts", "/api"],
  ["apps/api/src/routes/customers.routes.ts", "/api"],
  ["apps/api/src/routes/expenses.routes.ts", "/api"],
  ["apps/api/src/routes/settings.routes.ts", "/api"],
  ["apps/api/src/routes/audit.routes.ts", "/api"],
  ["apps/api/src/routes/reports.ts", "/api/reports"],
  ["apps/api/src/routes/barcodes.ts", "/api/barcodes"],
  ["apps/api/src/routes/supplier-routes.ts", "/api"],
  ["apps/api/src/routes/exchanges.ts", "/api"],
  ["apps/api/src/routes/checkout-recovery.ts", "/api"],
  ["apps/api/src/routes/discount-approvals.ts", "/api"],
  ["apps/api/src/routes/promotions.ts", "/api"],
  ["apps/api/src/routes/branding.ts", "/api"],
  ["apps/api/src/routes/product-images.ts", "/api"],
  ["apps/api/src/routes/loyalty-routes.ts", "/api"],
  ["apps/api/src/routes/stock-documents.ts", "/api"],
  ["apps/api/src/routes/customers.ts", "/api"],
  ["apps/api/src/routes/expense-workflow.ts", "/api"],
  ["apps/api/src/routes/administration.ts", "/api"],
  ["apps/api/src/routes/customer-discounts.ts", "/api"],
  ["apps/api/src/routes/advanced-stock.ts", "/api"],
  ["apps/api/src/routes/shared-carts.ts", "/api"],
  ["apps/api/src/routes/detailed-reports.ts", "/api"],
]) {
  const source = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const routes = [];
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      [
        "app",
        "roles",
        "usersRouter",
        "catalogRouter",
        "resourcesRouter",
        "inventoryRouter",
        "purchasesRouter",
        "shiftsRouter",
        "salesRouter",
        "salesQuoteRouter",
        "customersRouter",
        "expensesRouter",
        "settingsRouter",
        "auditRouter",
        "reports",
        "barcodes",
        "supplierRoutes",
        "exchanges",
        "checkoutRecovery",
        "discountApprovals",
        "promotions",
        "branding",
        "productImages",
        "publicBranding",
        "loyaltyRoutes",
        "stockDocuments",
        "customers",
        "expenseWorkflow",
        "administration",
        "customerDiscounts",
        "advancedStock",
        "sharedCarts",
        "detailedReports",
      ].includes(node.expression.expression.getText(sourceFile)) &&
      ["get", "post", "patch"].includes(node.expression.name.text) &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    )
      routes.push([
        null,
        node.expression.name.text,
        node.arguments[0].text,
        node.arguments
          .slice(1)
          .map((a) => a.getText(sourceFile))
          .join(","),
      ]);
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  for (const match of routes) {
    const verb = match[1],
      raw = prefix + match[2],
      path = raw.replace(/:([a-zA-Z]+)/g, "{$1}"),
      key = `${verb.toUpperCase()} ${raw}`,
      parameters = [];
    for (const param of raw.matchAll(/:([a-zA-Z]+)/g))
      parameters.push({
        in: "path",
        name: param[1],
        required: true,
        schema:
          raw.startsWith("/api/brand-assets/") ||
          raw.startsWith("/api/administration/sessions/")
            ? { type: "string", pattern: "^[a-f0-9]{64}$" }
            : param[1] === "id"
              ? uuid
              : str,
      });
    const auth =
      raw.includes("/auth/login") ||
      raw === "/api/health" ||
      raw === "/api/branding" ||
      raw.startsWith("/api/brand-assets/")
        ? []
        : [{ session: [] }];
    if (verb !== "get" && auth.length)
      parameters.push(
        { in: "header", name: "X-CSRF-Token", required: true, schema: str },
        {
          in: "header",
          name: "Origin",
          required: true,
          schema: { type: "string", format: "uri" },
        },
      );
    if (
      verb === "get" &&
      !["/api/loyalty/settings", "/api/inventory/documents"].includes(raw) &&
      !/^\/api\/customers\/[^/]+\/loyalty$/.test(raw) &&
      !/auth|health|lookup|:id$|registers|locations|store|permissions|roles|categories|brands|branding|promotions|discount-approvals/.test(
        raw,
      )
    )
      parameters.push(
        {
          in: "query",
          name: "limit",
          schema: { type: "integer", minimum: 1, maximum: 100, default: 30 },
        },
        {
          in: "query",
          name: "offset",
          schema: { type: "integer", minimum: 0, default: 0 },
        },
      );
    if (
      verb === "get" &&
      (raw === "/api/inventory/documents" ||
        /^\/api\/customers\/[^/]+\/loyalty$/.test(raw))
    )
      parameters.push({
        in: "query",
        name: "offset",
        schema: { type: "integer", minimum: 0, default: 0 },
      });
    if (verb === "get" && raw === "/api/inventory/documents")
      parameters.push({
        in: "query",
        name: "type",
        schema: { type: "string", enum: ["TRANSFER", "DAMAGE", "ADJUSTMENT"] },
      });
    if (raw === "/api/products" || raw === "/api/customers")
      parameters.push({ in: "query", name: "q", schema: str });
    if (raw === "/api/sales" && verb === "get")
      parameters.push({
        in: "query",
        name: "number",
        schema: { type: "string", pattern: "^\\d{1,18}$" },
      });
    if (raw.startsWith("/api/reports/"))
      for (const name of ["from", "to"])
        parameters.push({
          in: "query",
          name,
          required: raw.endsWith("/export") || raw.includes("/detail/"),
          schema: { type: "string", format: "date-time" },
        });
    if (raw === "/api/reports/detail/:kind")
      parameters.push(
        { in: "query", name: "q", schema: str },
        {
          in: "query",
          name: "format",
          schema: {
            type: "string",
            enum: ["json", "xlsx", "pdf"],
            default: "json",
          },
        },
      );
    const financial =
      verb === "post" &&
      /inventory\/(?:shipments|holds)(?:\/|$)|inventory\/stock-counts\/.+\/cancel$|shared-carts(?:$|\/[^/]+\/(?:claim|cancel)$)|\/decision$|discount-approvals$|sales(?:\/|$)|receive$|adjustments$|shifts\/open$|cash-movements$|\/close$|expenses$|\/payments$|supplier-invoices\/.+\/returns$/.test(
        raw,
      );
    if (financial)
      parameters.push({
        in: "header",
        name: "Idempotency-Key",
        required: true,
        schema: { type: "string", minLength: 16, maxLength: 100 },
      });
    const requiredPermissions = [
      ...match[3].matchAll(/can\(([^)]+)\)/g),
    ].flatMap((v) => [...v[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]));
    const operation = {
      summary: key,
      operationId: `${verb}_${raw.replace(/[^a-zA-Z0-9]/g, "_")}`,
      tags: [raw.split("/")[2]],
      security: auth,
      parameters,
      "x-permissions": requiredPermissions,
      description: requiredPermissions.length
        ? `Required backend permission(s): ${requiredPermissions.join(", ")}. Multiple gates may require both; see API.md.`
        : "Authenticated session unless health/login.",
      responses: {
        200: {
          description:
            "Successful operation. JSON { data, total? }; decimal and invoice-number values are strings.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Envelope" },
            },
          },
        },
        400: { $ref: "#/components/responses/Error" },
        401: { $ref: "#/components/responses/Error" },
        403: { $ref: "#/components/responses/Error" },
        404: { $ref: "#/components/responses/Error" },
        409: { $ref: "#/components/responses/Error" },
        429: { description: "Rate limit exceeded" },
      },
    };
    if (schemas[key])
      operation.requestBody = {
        required: true,
        content: { "application/json": { schema: schemas[key] } },
      };
    if (
      verb === "post" &&
      /^\/api\/(users|products|customers|suppliers|purchases|expenses|sales|shifts\/open|roles|brands|categories)$/.test(
        raw,
      )
    )
      operation.responses["201"] = {
        ...operation.responses["200"],
        description: "Created",
      };
    if (raw.endsWith("/export"))
      operation.responses["200"] = {
        description: "Excel workbook (maximum 10,000 invoices)",
        content: {
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
            schema: { type: "string", format: "binary" },
          },
        },
      };
    if (raw.startsWith("/api/brand-assets/"))
      operation.responses["200"] = {
        description: "Immutable raster logo, cached by content hash",
        content: Object.fromEntries(
          ["image/png", "image/jpeg", "image/webp"].map((mime) => [
            mime,
            { schema: { type: "string", format: "binary" } },
          ]),
        ),
      };
    paths[path] ??= {};
    paths[path][verb] = operation;
  }
}
writeFileSync(
  "docs/openapi.json",
  JSON.stringify(
    {
      openapi: "3.0.3",
      info: {
        title: "A&Z Girls Fashion API",
        version: "0.1.0",
        description:
          "Implemented API only. See API.md for accounting rules and limitations.",
      },
      servers: [{ url: "/" }],
      paths,
      components: {
        securitySchemes: {
          session: { type: "apiKey", in: "cookie", name: "az_session" },
        },
        schemas: {
          Envelope: {
            type: "object",
            properties: { data: {}, total: { type: "integer" } },
          },
          Error: object({ error: object({ code: str, message: str }) }),
        },
        responses: {
          Error: {
            description:
              "Validation, authentication, authorization, not-found or business conflict. Error codes are stable strings.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
        },
      },
    },
    null,
    2,
  ) + "\n",
);
console.log(`Documented ${Object.keys(paths).length} API paths.`);
