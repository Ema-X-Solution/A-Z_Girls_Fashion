CREATE TABLE "Promotion" (
 "id" UUID PRIMARY KEY, "name" TEXT NOT NULL, "type" TEXT NOT NULL,
 "productIds" JSONB NOT NULL DEFAULT '[]', "percent" DECIMAL(7,2) NOT NULL DEFAULT 0,
 "buyQuantity" INTEGER NOT NULL DEFAULT 2, "getQuantity" INTEGER NOT NULL DEFAULT 1,
 "startsAt" TIMESTAMP(3) NOT NULL, "endsAt" TIMESTAMP(3) NOT NULL,
 "active" BOOLEAN NOT NULL DEFAULT false, "createdBy" UUID NOT NULL REFERENCES "User"("id"),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CHECK ("type" IN ('PERCENT','BUY_X_GET_Y')), CHECK ("endsAt">"startsAt"),
 CHECK ("percent">=0 AND "percent"<=100), CHECK ("buyQuantity" BETWEEN 1 AND 50 AND "getQuantity" BETWEEN 1 AND 50),
 CHECK (jsonb_typeof("productIds")='array')
);
CREATE INDEX "Promotion_active_startsAt_endsAt_idx" ON "Promotion"("active","startsAt","endsAt");
CREATE TABLE "BrandAsset" (
 "id" TEXT PRIMARY KEY, "mime" TEXT NOT NULL, "data" BYTEA NOT NULL,
 "createdBy" UUID NOT NULL REFERENCES "User"("id"), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK ("id" ~ '^[a-f0-9]{64}$'), CHECK ("mime" IN ('image/png','image/jpeg','image/webp')),
 CHECK (octet_length("data") BETWEEN 32 AND 140000)
);
INSERT INTO "Permission"("key") VALUES ('promotions.manage') ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission"("roleId","permissionKey") SELECT "id",'promotions.manage' FROM "Role" WHERE "name" IN ('OWNER','MANAGER') ON CONFLICT DO NOTHING;
