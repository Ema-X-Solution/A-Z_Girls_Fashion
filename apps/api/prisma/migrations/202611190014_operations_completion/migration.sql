-- Additive operations completion; existing foreign keys, indexes, ledgers and financial records retained.

ALTER TABLE "Branch" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Customer" ADD COLUMN     "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0;

ALTER TABLE "Expense" ADD COLUMN     "decidedAt" TIMESTAMP(3),
ADD COLUMN     "decidedBy" UUID,
ADD COLUMN     "decisionNote" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "shiftId" UUID,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'APPROVED';

ALTER TABLE "Register" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "SaleItem" ADD COLUMN     "categoryName" TEXT NOT NULL DEFAULT 'غير مصنف';

ALTER TABLE "StockCount" ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'CUTOFF';

ALTER TABLE "StockCountItem" ADD COLUMN     "countedAt" TIMESTAMP(3);

CREATE TABLE "ExpenseCategory" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExpenseAttachment" (
    "id" UUID NOT NULL,
    "expenseId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpenseAttachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Shipment" (
    "id" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "destinationId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SHIPPED',
    "reason" TEXT NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShipmentItem" (
    "id" UUID NOT NULL,
    "shipmentId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "received" INTEGER NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "ShipmentItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StockHold" (
    "id" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "released" INTEGER NOT NULL DEFAULT 0,
    "disposed" INTEGER NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(18,4) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockHold_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SharedCart" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "draft" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "leaseHash" TEXT,
    "leasedBy" UUID,
    "leaseUntil" TIMESTAMP(3),
    "saleId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SharedCart_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CartReservation" (
    "cartId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CartReservation_pkey" PRIMARY KEY ("cartId","variantId")
);

CREATE UNIQUE INDEX "ExpenseCategory_name_key" ON "ExpenseCategory"("name");

CREATE UNIQUE INDEX "ShipmentItem_shipmentId_variantId_key" ON "ShipmentItem"("shipmentId", "variantId");

CREATE UNIQUE INDEX "SharedCart_saleId_key" ON "SharedCart"("saleId");

CREATE INDEX "SharedCart_ownerId_status_idx" ON "SharedCart"("ownerId", "status");

CREATE INDEX "CartReservation_variantId_locationId_expiresAt_idx" ON "CartReservation"("variantId", "locationId", "expiresAt");

ALTER TABLE "ExpenseAttachment" ADD CONSTRAINT "ExpenseAttachment_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CartReservation" ADD CONSTRAINT "CartReservation_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "SharedCart"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "ExpenseCategory" (id,name) SELECT gen_random_uuid(),name FROM (SELECT DISTINCT category name FROM "Expense" UNION SELECT unnest(ARRAY['إيجار','كهرباء','إنترنت','رواتب','نقل','تغليف','صيانة','تسويق','أخرى'])) names ON CONFLICT(name) DO NOTHING;
INSERT INTO "Permission" (key) VALUES ('expenses.approve') ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId","permissionKey") SELECT id,'expenses.approve' FROM "Role" WHERE name='OWNER' ON CONFLICT DO NOTHING;
ALTER TABLE "Customer" ADD CONSTRAINT customer_discount_range CHECK ("discountPercent" BETWEEN 0 AND 100);
ALTER TABLE "Expense" ADD CONSTRAINT expense_status CHECK (status IN ('PENDING','APPROVED','REJECTED'));
ALTER TABLE "Expense" ADD FOREIGN KEY (category) REFERENCES "ExpenseCategory"(name), ADD FOREIGN KEY ("shiftId") REFERENCES "CashShift"(id), ADD FOREIGN KEY ("decidedBy") REFERENCES "User"(id);
ALTER TABLE "ExpenseAttachment" ADD FOREIGN KEY ("createdBy") REFERENCES "User"(id), ADD CHECK (octet_length(data) BETWEEN 32 AND 750000);
ALTER TABLE "Shipment" ADD FOREIGN KEY ("sourceId") REFERENCES "StockLocation"(id), ADD FOREIGN KEY ("destinationId") REFERENCES "StockLocation"(id), ADD FOREIGN KEY ("createdBy") REFERENCES "User"(id), ADD CHECK ("sourceId"<>"destinationId"), ADD CHECK(status IN ('SHIPPED','PARTIAL','RECEIVED'));
ALTER TABLE "ShipmentItem" ADD FOREIGN KEY ("variantId") REFERENCES "ProductVariant"(id), ADD CHECK(quantity>0 AND received>=0 AND received<=quantity AND "unitCost">=0);
ALTER TABLE "StockHold" ADD FOREIGN KEY ("locationId") REFERENCES "StockLocation"(id),ADD FOREIGN KEY ("variantId") REFERENCES "ProductVariant"(id),ADD FOREIGN KEY ("createdBy") REFERENCES "User"(id),ADD CHECK(quantity>0 AND released>=0 AND disposed>=0 AND released+disposed<=quantity AND "unitCost">=0);
ALTER TABLE "SharedCart" ADD FOREIGN KEY ("ownerId") REFERENCES "User"(id),ADD FOREIGN KEY ("leasedBy") REFERENCES "User"(id),ADD FOREIGN KEY ("locationId") REFERENCES "StockLocation"(id),ADD FOREIGN KEY ("saleId") REFERENCES "Sale"(id), ADD CHECK(status IN ('AVAILABLE','CLAIMED','CONSUMED','CANCELLED')),ADD CHECK(revision>0);
ALTER TABLE "CartReservation" ADD FOREIGN KEY ("variantId") REFERENCES "ProductVariant"(id),ADD FOREIGN KEY ("locationId") REFERENCES "StockLocation"(id),ADD CHECK(quantity>0);
CREATE INDEX expense_status_date ON "Expense"(status,date);
CREATE INDEX shipment_created_at ON "Shipment"("createdAt");
CREATE INDEX hold_created_at ON "StockHold"("createdAt");
CREATE INDEX attachment_expense ON "ExpenseAttachment"("expenseId");
ALTER TABLE "SharedCart" ADD COLUMN "syncStamp" BIGINT NOT NULL DEFAULT 0;
CREATE FUNCTION protect_operations_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-string_to_array(TG_ARGV[0],',')) IS DISTINCT FROM (to_jsonb(OLD)-string_to_array(TG_ARGV[0],',')) THEN RAISE EXCEPTION 'Immutable operations snapshot'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER shipment_snapshot BEFORE UPDATE OR DELETE ON "Shipment" FOR EACH ROW EXECUTE FUNCTION protect_operations_snapshot('status');
CREATE TRIGGER shipment_item_snapshot BEFORE UPDATE OR DELETE ON "ShipmentItem" FOR EACH ROW EXECUTE FUNCTION protect_operations_snapshot('received');
CREATE TRIGGER hold_snapshot BEFORE UPDATE OR DELETE ON "StockHold" FOR EACH ROW EXECUTE FUNCTION protect_operations_snapshot('released,disposed');
CREATE TRIGGER expense_attachment_immutable BEFORE UPDATE OR DELETE ON "ExpenseAttachment" FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
CREATE FUNCTION protect_expense_decision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.status<>'PENDING' THEN RAISE EXCEPTION 'Final expense is immutable'; END IF;
 IF (to_jsonb(NEW)-ARRAY['status','decidedAt','decidedBy','decisionNote','shiftId','date']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','decidedAt','decidedBy','decisionNote','shiftId','date']) OR NEW.status NOT IN ('APPROVED','REJECTED') OR NEW."decidedBy"=OLD."createdBy" OR NEW."decidedBy" IS NULL THEN RAISE EXCEPTION 'Invalid expense approval transition'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER expense_decision_immutable BEFORE UPDATE OR DELETE ON "Expense" FOR EACH ROW EXECUTE FUNCTION protect_expense_decision();
