-- CreateTable
CREATE TABLE "StockBatch" (
    "id" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "remaining" INTEGER NOT NULL,
    "unitCost" DECIMAL(18,4) NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reference" TEXT NOT NULL,
    "type" TEXT NOT NULL,

    CONSTRAINT "StockBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCostFlow" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockCostFlow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingClose" (
    "id" UUID NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountingClose_pkey" PRIMARY KEY ("id")
);


-- CreateIndex
CREATE INDEX "StockBatch_variantId_locationId_acquiredAt_idx" ON "StockBatch"("variantId", "locationId", "acquiredAt");

-- CreateIndex
CREATE INDEX "StockCostFlow_reference_type_variantId_idx" ON "StockCostFlow"("reference", "type", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingClose_startsAt_endsAt_key" ON "AccountingClose"("startsAt", "endsAt");

-- AddForeignKey
ALTER TABLE "StockCostFlow" ADD CONSTRAINT "StockCostFlow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "StockBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaleItem" ADD COLUMN "costTotal" DECIMAL(22,4);
ALTER TABLE "StockBatch" ADD CONSTRAINT fifo_batch_quantity CHECK (quantity > 0 AND remaining >= 0 AND remaining <= quantity AND "unitCost" >= 0);
ALTER TABLE "StockCostFlow" ADD CONSTRAINT fifo_flow_quantity CHECK (quantity <> 0);
ALTER TABLE "AccountingClose" ADD CONSTRAINT close_period_range CHECK ("startsAt" < "endsAt");
-- Opening stock is valued at the existing average. Historical profits are not rewritten.
INSERT INTO "StockBatch" (id,"variantId","locationId",quantity,remaining,"unitCost","acquiredAt","reference",type)
SELECT gen_random_uuid(),"variantId","locationId",quantity,quantity,"averageCost",CURRENT_TIMESTAMP,'FIFO-OPENING','OPENING' FROM "StockBalance" WHERE quantity>0;
CREATE TRIGGER fifo_flow_immutable BEFORE UPDATE OR DELETE ON "StockCostFlow" FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
CREATE TRIGGER close_immutable BEFORE UPDATE OR DELETE ON "AccountingClose" FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
CREATE FUNCTION guard_closed_period() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior jsonb; upcoming jsonb; olddate timestamptz; newdate timestamptz;
BEGIN
 PERFORM pg_advisory_xact_lock(98125731);
 IF TG_OP <> 'INSERT' THEN prior=to_jsonb(OLD); END IF;
 IF TG_OP <> 'DELETE' THEN upcoming=to_jsonb(NEW); END IF;
 -- Returns in a later open period only update operational counters, never the original price or cost.
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='Sale' AND (prior-'status')=(upcoming-'status') THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='SaleItem' AND (prior-'returned'-'refunded'-'refundedTax')=(upcoming-'returned'-'refunded'-'refundedTax') THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='Expense' THEN olddate=(prior->>'date')::timestamptz;newdate=(upcoming->>'date')::timestamptz;
 ELSIF TG_TABLE_NAME IN ('SaleItem','SalePayment') THEN
  SELECT "createdAt" INTO olddate FROM "Sale" WHERE id=(prior->>'saleId')::uuid;
  SELECT "createdAt" INTO newdate FROM "Sale" WHERE id=(upcoming->>'saleId')::uuid;
 ELSIF TG_TABLE_NAME='SaleReturnItem' THEN
  SELECT "createdAt" INTO olddate FROM "SaleReturn" WHERE id=(prior->>'returnId')::uuid;
  SELECT "createdAt" INTO newdate FROM "SaleReturn" WHERE id=(upcoming->>'returnId')::uuid;
 ELSIF TG_TABLE_NAME='PurchaseReturnItem' THEN
  SELECT "createdAt" INTO olddate FROM "PurchaseReturn" WHERE id=(prior->>'returnId')::uuid;
  SELECT "createdAt" INTO newdate FROM "PurchaseReturn" WHERE id=(upcoming->>'returnId')::uuid;
 ELSIF TG_TABLE_NAME='StockDocumentItem' THEN
  SELECT "createdAt" INTO olddate FROM "StockDocument" WHERE id=(prior->>'documentId')::uuid;
  SELECT "createdAt" INTO newdate FROM "StockDocument" WHERE id=(upcoming->>'documentId')::uuid;
 ELSE olddate=(prior->>'createdAt')::timestamptz;newdate=(upcoming->>'createdAt')::timestamptz;
 END IF;
 IF EXISTS(SELECT 1 FROM "AccountingClose" WHERE (olddate>="startsAt" AND olddate<"endsAt") OR (newdate>="startsAt" AND newdate<"endsAt")) THEN
 RAISE EXCEPTION 'ACCOUNTING_PERIOD_CLOSED' USING ERRCODE='P0001';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER closed_period_guard BEFORE INSERT OR UPDATE OR DELETE ON "Sale" FOR EACH ROW EXECUTE FUNCTION guard_closed_period();
CREATE TRIGGER closed_period_guard BEFORE INSERT OR UPDATE OR DELETE ON "SaleItem" FOR EACH ROW EXECUTE FUNCTION guard_closed_period();
CREATE TRIGGER closed_period_guard BEFORE INSERT OR UPDATE OR DELETE ON "SalePayment" FOR EACH ROW EXECUTE FUNCTION guard_closed_period();
CREATE TRIGGER closed_period_guard BEFORE INSERT OR UPDATE OR DELETE ON "SaleReturn" FOR EACH ROW EXECUTE FUNCTION guard_closed_period();
CREATE TRIGGER closed_period_guard BEFORE INSERT OR UPDATE OR DELETE ON "SaleReturnItem" FOR EACH ROW EXECUTE FUNCTION guard_closed_period();
CREATE TRIGGER closed_period_guard BEFORE INSERT OR UPDATE OR DELETE ON "Expense" FOR EACH ROW EXECUTE FUNCTION guard_closed_period();
CREATE TRIGGER closed_period_guard BEFORE INSERT OR UPDATE OR DELETE ON "PurchaseReturn" FOR EACH ROW EXECUTE FUNCTION guard_closed_period();
CREATE TRIGGER closed_period_guard BEFORE INSERT OR UPDATE OR DELETE ON "PurchaseReturnItem" FOR EACH ROW EXECUTE FUNCTION guard_closed_period();
CREATE TRIGGER closed_period_guard BEFORE INSERT OR UPDATE OR DELETE ON "StockDocument" FOR EACH ROW EXECUTE FUNCTION guard_closed_period();
CREATE TRIGGER closed_period_guard BEFORE INSERT OR UPDATE OR DELETE ON "StockDocumentItem" FOR EACH ROW EXECUTE FUNCTION guard_closed_period();
CREATE TRIGGER closed_period_guard BEFORE INSERT OR UPDATE OR DELETE ON "PurchaseReceipt" FOR EACH ROW EXECUTE FUNCTION guard_closed_period();
CREATE TRIGGER closed_period_guard BEFORE INSERT OR UPDATE OR DELETE ON "SupplierInvoice" FOR EACH ROW EXECUTE FUNCTION guard_closed_period();
CREATE TRIGGER closed_period_guard BEFORE INSERT OR UPDATE OR DELETE ON "StockMovement" FOR EACH ROW EXECUTE FUNCTION guard_closed_period();
CREATE FUNCTION guard_close_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(98125731);
 IF EXISTS(SELECT 1 FROM "AccountingClose" WHERE "startsAt"<NEW."endsAt" AND "endsAt">NEW."startsAt") THEN RAISE EXCEPTION 'ACCOUNTING_CLOSE_OVERLAP'; END IF;
 RETURN NEW; END $$;
 CREATE TRIGGER close_no_overlap BEFORE INSERT ON "AccountingClose" FOR EACH ROW EXECUTE FUNCTION guard_close_insert();

-- Preserve exact FIFO cost even while a period is still open.
CREATE FUNCTION protect_fifo_sale_cost() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW."costTotal" IS DISTINCT FROM OLD."costTotal" THEN RAISE EXCEPTION 'Posted FIFO cost is immutable'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER fifo_sale_cost_immutable BEFORE UPDATE ON "SaleItem" FOR EACH ROW EXECUTE FUNCTION protect_fifo_sale_cost();
ALTER TABLE "StockBatch" ADD CONSTRAINT fifo_batch_variant FOREIGN KEY ("variantId") REFERENCES "ProductVariant"(id);
ALTER TABLE "StockBatch" ADD CONSTRAINT fifo_batch_location FOREIGN KEY ("locationId") REFERENCES "StockLocation"(id);
CREATE FUNCTION protect_fifo_batch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-'remaining') IS DISTINCT FROM (to_jsonb(OLD)-'remaining') THEN RAISE EXCEPTION 'FIFO batch identity and cost are immutable'; END IF;RETURN NEW;
END $$;
CREATE TRIGGER fifo_batch_immutable BEFORE UPDATE OR DELETE ON "StockBatch" FOR EACH ROW EXECUTE FUNCTION protect_fifo_batch();
